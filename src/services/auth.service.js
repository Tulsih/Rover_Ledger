const userRepository = require('../repositories/user.repository');
const refreshTokenRepository = require('../repositories/refreshToken.repository');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
  parseExpiresInSeconds,
  JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
} = require('../utils/jwt.util');
const {
  getMicrosoftAuthUrl,
  exchangeCodeForTokens,
  fetchUserProfileFromGraph,
} = require('../utils/microsoft.util');

/**
 * Authentication Service
 * 
 * Handles business logic for Microsoft OAuth authentication,
 * Access & Refresh token issuance, token rotation, and logout.
 */
class AuthService {
  /**
   * Get the Microsoft OAuth 2.0 Login URL
   * @param {string} state - State string for CSRF mitigation
   * @param {string} redirectUri - Optional custom redirect URI (defaults to roverledger://auth)
   * @returns {string} URL to redirect user to Microsoft login
   */
  getLoginUrl(state, redirectUri = null) {
    return getMicrosoftAuthUrl(state, redirectUri);
  }

  /**
   * Authenticate user with Microsoft and issue Access Token + Refresh Token
   * 
   * @param {object} params - { code, accessToken, redirectUri, codeVerifier, deviceInfo, ipAddress }
   * @returns {Promise<object>} Authenticated user and dual JWT tokens
   */
  async loginWithMicrosoft({ code, accessToken, redirectUri, codeVerifier, deviceInfo, ipAddress }) {
    let msProfile;
    console.log('[Login with Microsoft] Request Body:', { code, accessToken, redirectUri, codeVerifier });

    // Check if a dummy testing code is provided (e.g. for Swagger UI testing without a live Microsoft account)
    const isDummyCode =
      code &&
      ['dummy_code', 'dummy', 'shraddha', 'shraddha_chauhan', 'test_code', 'demo'].includes(
        code.trim().toLowerCase()
      );

    if (isDummyCode) {
      console.log('🧪 Using Dummy Microsoft Login for Testing (User: Shraddha Chauhan)');
      msProfile = {
        firstName: 'Shraddha',
        lastName: 'Chauhan',
        fullName: 'Shraddha Chauhan',
        email: 'shraddha.chauhan@roverledger.com',
        designation: 'Software Engineer',
        gender: 'Female',
      };
    } else {
      let token = accessToken;

      // Step 1: If authorization code is provided, exchange it for Microsoft access token (with optional PKCE codeVerifier)
      if (!token && code) {
        const tokenResponse = await exchangeCodeForTokens(code, redirectUri, codeVerifier);
        token = tokenResponse.access_token;
      }

      if (!token) {
        const err = new Error('Either authorization code or Microsoft access token must be provided');
        err.statusCode = 400;
        throw err;
      }

      // Step 2: Fetch user profile from Microsoft Graph API
      msProfile = await fetchUserProfileFromGraph(token);
    }

    if (!msProfile.email) {
      const err = new Error('Unable to retrieve email from Microsoft account. Please ensure email permissions are granted.');
      err.statusCode = 400;
      throw err;
    }

    const email = msProfile.email.toLowerCase();

    // Step 3: Check if user already exists in Rover_ledgers table
    let user = await userRepository.findAnyByEmail(email);

    if (user) {
      // Validate that account has not been soft-deleted
      if (user.SoftDelete) {
        const err = new Error('Account has been deleted. Please contact your system administrator.');
        err.statusCode = 403;
        throw err;
      }

      // Existing user found: reactivate if previously logged out
      const updatePayload = {
        isActive: true,
      };

      // Preserve existing profile details edited by user in Rover Ledger.
      // Only backfill missing/empty fields from Microsoft if not already set.
      if ((!user.FirstName || !user.FirstName.trim()) && msProfile.firstName) updatePayload.FirstName = msProfile.firstName;
      if ((!user.LastName || !user.LastName.trim()) && msProfile.lastName) updatePayload.LastName = msProfile.lastName;
      if ((!user.FullName || !user.FullName.trim()) && msProfile.fullName) updatePayload.FullName = msProfile.fullName;
      if ((!user.Designation || !user.Designation.trim()) && msProfile.designation) updatePayload.Designation = msProfile.designation;
      if ((!user.Gender || !user.Gender.trim()) && msProfile.gender) updatePayload.Gender = msProfile.gender;

      user = await userRepository.updateUser(user.UserId, updatePayload);
    } else {
      // Step 4: First-time login: create new user in Rover_ledgers
      user = await userRepository.createUser({
        FirstName: msProfile.firstName || null,
        LastName: msProfile.lastName || null,
        Email: email,
        FullName: msProfile.fullName || null,
        Designation: msProfile.designation || null,
        Gender: msProfile.gender || null,
        Role: 'User',
        isActive: true,
        SoftDelete: false,
      });
    }

    // Step 5: Issue dual tokens: Access Token (15m) + Refresh Token (7d)
    const tokenPayload = {
      UserId: user.UserId,
      Email: user.Email,
      Role: user.Role,
    };

    const appAccessToken = generateAccessToken(tokenPayload);
    const appRefreshToken = generateRefreshToken(tokenPayload);

    // Step 6: Hash and store the refresh token in PostgreSQL
    const tokenHash = hashToken(appRefreshToken);
    const refreshDurationSec = parseExpiresInSeconds(JWT_REFRESH_EXPIRES_IN);
    const refreshExpiresAt = new Date(Date.now() + refreshDurationSec * 1000);

    await refreshTokenRepository.createRefreshToken({
      userId: user.UserId,
      tokenHash,
      deviceInfo,
      ipAddress,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken: appAccessToken,
      refreshToken: appRefreshToken,
      tokenType: 'Bearer',
      expiresIn: parseExpiresInSeconds(JWT_ACCESS_EXPIRES_IN),
      user: {
        UserId: user.UserId,
        FirstName: user.FirstName,
        LastName: user.LastName,
        FullName: user.FullName,
        Email: user.Email,
        Gender: user.Gender,
        Role: user.Role,
        Designation: user.Designation,
        isActive: user.isActive,
        CreatedAt: user.CreatedAt,
        UpdatedAt: user.UpdatedAt,
      },
    };
  }

  /**
   * Refresh Access Token using Refresh Token with Token Rotation
   * 
   * @param {object} params - { refreshToken, deviceInfo, ipAddress }
   * @returns {Promise<object>} New access and refresh token pair
   */
  async refreshToken({ refreshToken, deviceInfo, ipAddress }) {
    if (!refreshToken || typeof refreshToken !== 'string' || !refreshToken.trim()) {
      const err = new Error('Validation Error: "refreshToken" is required.');
      err.statusCode = 400;
      throw err;
    }

    const cleanRefreshToken = refreshToken.trim();

    // 1. Verify token signature and expiration
    let decoded;
    try {
      decoded = verifyRefreshToken(cleanRefreshToken);
    } catch (err) {
      const error = new Error(
        err.name === 'TokenExpiredError'
          ? 'Refresh token has expired. Please login again.'
          : 'Invalid refresh token.'
      );
      error.statusCode = 401;
      error.code = 'REFRESH_TOKEN_EXPIRED';
      throw error;
    }

    // 2. Query hashed token in database
    const tokenHash = hashToken(cleanRefreshToken);
    const tokenRecord = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!tokenRecord) {
      const err = new Error('Refresh token not recognized or already revoked. Please login again.');
      err.statusCode = 401;
      err.code = 'INVALID_REFRESH_TOKEN';
      throw err;
    }

    // 3. Security Replay Detection: If token is already revoked, revoke all tokens for this user
    if (tokenRecord.isRevoked) {
      console.warn(`⚠️ [Security Alert] Reused refresh token detected for userId: ${tokenRecord.userId}. Revoking all sessions.`);
      await refreshTokenRepository.revokeAllUserTokens(tokenRecord.userId);
      const err = new Error('Security Alert: Refresh token has been reused. All active sessions have been terminated. Please login again.');
      err.statusCode = 401;
      err.code = 'TOKEN_REUSE_DETECTED';
      throw err;
    }

    // 4. Check if token expired according to database record
    if (new Date() > new Date(tokenRecord.expiresAt)) {
      await refreshTokenRepository.revokeToken(tokenHash);
      const err = new Error('Refresh token has expired. Please login again.');
      err.statusCode = 401;
      err.code = 'REFRESH_TOKEN_EXPIRED';
      throw err;
    }

    // 5. Ensure the user still exists and is active
    const user = await userRepository.findById(tokenRecord.userId);
    if (!user) {
      const err = new Error('User account not found or has been deleted.');
      err.statusCode = 401;
      throw err;
    }

    if (!user.isActive) {
      const err = new Error('Account is inactive. Please login again to reactivate your session.');
      err.statusCode = 401;
      throw err;
    }

    // 6. Token Rotation: Invalidate the current refresh token
    await refreshTokenRepository.revokeToken(tokenHash);

    // 7. Issue new Access Token and rotated Refresh Token
    const tokenPayload = {
      UserId: user.UserId,
      Email: user.Email,
      Role: user.Role,
    };

    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);
    const newHash = hashToken(newRefreshToken);
    const refreshDurationSec = parseExpiresInSeconds(JWT_REFRESH_EXPIRES_IN);
    const newExpiresAt = new Date(Date.now() + refreshDurationSec * 1000);

    await refreshTokenRepository.createRefreshToken({
      userId: user.UserId,
      tokenHash: newHash,
      deviceInfo: deviceInfo || tokenRecord.deviceInfo,
      ipAddress: ipAddress || tokenRecord.ipAddress,
      expiresAt: newExpiresAt,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: parseExpiresInSeconds(JWT_ACCESS_EXPIRES_IN),
      user: {
        UserId: user.UserId,
        FirstName: user.FirstName,
        LastName: user.LastName,
        FullName: user.FullName,
        Email: user.Email,
        Gender: user.Gender,
        Role: user.Role,
        Designation: user.Designation,
        isActive: user.isActive,
        CreatedAt: user.CreatedAt,
        UpdatedAt: user.UpdatedAt,
      },
    };
  }

  /**
   * Logout user, revoke refresh token(s), and mark isActive as false in database
   * @param {object} params - { userId, email, refreshToken }
   * @returns {Promise<object>} Result with updated user status
   */
  async logout({ userId, email, refreshToken }) {
    let user = null;

    if (userId) {
      user = await userRepository.findById(userId);
    } else if (email) {
      user = await userRepository.findByEmail(email.toLowerCase().trim());
    }

    // If a specific refreshToken was provided, revoke it
    if (refreshToken && typeof refreshToken === 'string') {
      const tokenHash = hashToken(refreshToken.trim());
      await refreshTokenRepository.revokeToken(tokenHash);
    }

    if (user) {
      // Invalidate all active sessions in refresh_tokens table
      await refreshTokenRepository.revokeAllUserTokens(user.UserId);

      // Set user's isActive status to false in database
      const updatedUser = await userRepository.updateUser(user.UserId, {
        isActive: false,
      });

      return {
        UserId: updatedUser.UserId,
        Email: updatedUser.Email,
        FullName: updatedUser.FullName,
        isActive: updatedUser.isActive,
        sessionsTerminated: true,
      };
    }

    return {
      success: true,
      sessionsTerminated: true,
    };
  }
}

module.exports = new AuthService();
