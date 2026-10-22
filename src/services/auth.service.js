const { log } = require('node:console');
const userRepository = require('../repositories/user.repository');
const { generateToken } = require('../utils/jwt.util');
const {
  getMicrosoftAuthUrl,
  exchangeCodeForTokens,
  fetchUserProfileFromGraph,
} = require('../utils/microsoft.util');

/**
 * Authentication Service
 * 
 * Contains business logic for Microsoft OAuth authentication,
 * user registration, and JWT token issuance.
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
   * Authenticate user with Microsoft
   * Supports:
   * 1. Authorization Code flow: passes { code, redirectUri }
   * 2. Direct Microsoft Access Token: passes { accessToken }
   * 
   * @param {object} params - { code, accessToken, redirectUri, codeVerifier }
   * @returns {Promise<object>} Authenticated user and JWT token
   */
  async loginWithMicrosoft({ code, accessToken, redirectUri, codeVerifier }) {
    let msProfile;
    console.log("[Login with Microsoft] Request Body:", { code, accessToken, redirectUri, codeVerifier });

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
        throw new Error('Either authorization code or Microsoft access token must be provided');
      }

      // Step 2: Fetch user profile from Microsoft Graph API
      msProfile = await fetchUserProfileFromGraph(token);
    }

    if (!msProfile.email) {
      throw new Error('Unable to retrieve email from Microsoft account. Please ensure email permissions are granted.');
    }

    const email = msProfile.email.toLowerCase();

    // Step 3: Check if user already exists in Rover_ledgers table
    let user = await userRepository.findAnyByEmail(email);

    if (user) {
      // Validate that account has not been deleted
      if (user.SoftDelete) {
        throw new Error('Account has been deleted. Please contact your system administrator.');
      }

      // Existing user found:
      // When user logs in, if they previously logged out (isActive: false), set isActive back to true
      const updatePayload = {
        isActive: true,
      };

      // Sync latest profile information from Microsoft
      if (msProfile.firstName && msProfile.firstName !== user.FirstName) updatePayload.FirstName = msProfile.firstName;
      if (msProfile.lastName && msProfile.lastName !== user.LastName) updatePayload.LastName = msProfile.lastName;
      if (msProfile.fullName && msProfile.fullName !== user.FullName) updatePayload.FullName = msProfile.fullName;
      if (msProfile.designation && msProfile.designation !== user.Designation) updatePayload.Designation = msProfile.designation;
      if (msProfile.gender && msProfile.gender !== user.Gender) updatePayload.Gender = msProfile.gender;

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

    // Step 5: Generate JWT Token for application session
    const appToken = generateToken({
      UserId: user.UserId,
      Email: user.Email,
      Role: user.Role,
    });

    return {
      token: appToken,
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
   * Logout user and mark isActive as false in database
   * @param {object} params - { userId, email }
   * @returns {Promise<object>} Result with updated user status
   */
  async logout({ userId, email }) {
    let user = null;

    if (userId) {
      user = await userRepository.findById(userId);
    } else if (email) {
      user = await userRepository.findByEmail(email.toLowerCase().trim());
    }

    if (!user) {
      throw new Error('User not found or account has been deleted.');
    }

    // Set user's isActive status to false in database
    const updatedUser = await userRepository.updateUser(user.UserId, {
      isActive: false,
    });

    return {
      UserId: updatedUser.UserId,
      Email: updatedUser.Email,
      FullName: updatedUser.FullName,
      isActive: updatedUser.isActive,
    };
  }
}

module.exports = new AuthService();
