const authService = require('../services/auth.service');
const { sendSuccess, sendError } = require('../utils/response.util');

/**
 * Authentication Controller
 * 
 * Handles HTTP requests for Microsoft OAuth login and token callbacks.
 */
class AuthController {
  /**
   * API 1: Login with Microsoft
   * 
   * Endpoint: POST /auth/microsoft
   * 
   * Accepts either:
   * 1. { "code": "..." } -> Authorization code from OAuth redirect flow
   * 2. { "accessToken": "..." } -> Access token from frontend MSAL library
   */
  async loginWithMicrosoft(req, res, next) {
    try {
      const { code, accessToken, redirectUri, codeVerifier, code_verifier } = req.body;
      const verifier = (codeVerifier || code_verifier || req.query.code_verifier || req.query.codeVerifier)?.trim();

      console.log('📥 [Auth Request Received]:', {
        bodyKeys: Object.keys(req.body || {}),
        hasCode: !!code,
        codeLength: code?.length,
        hasCodeVerifier: !!verifier,
        codeVerifierLength: verifier?.length,
        redirectUri: redirectUri || 'default (roverledger://auth)',
      });

      // Ensure at least one authentication credential is provided
      if (!code && !accessToken) {
        return sendError(
          res,
          400,
          'Validation Error: Please provide either "code" (authorization code) or "accessToken" (Microsoft access token) in request body.'
        );
      }

      // Delegate authentication and user sync to AuthService
      const result = await authService.loginWithMicrosoft({
        code: code?.trim(),
        accessToken: accessToken?.trim(),
        redirectUri: redirectUri ? redirectUri.trim() : null,
        codeVerifier: verifier,
      });

      return sendSuccess(res, 200, 'Login with Microsoft successful', result);
    } catch (error) {
      console.error('❌ [AuthController.loginWithMicrosoft Error]:', error.message);
      return sendError(res, 400, error.message);
    }
  }

  /**
   * Helper Endpoint: Get Microsoft OAuth Login URL
   * 
   * Endpoint: GET /auth/microsoft
   * 
   * Usage:
   * - Browser navigation: Redirects user straight to Microsoft sign-in page
   * - API client / Frontend: Pass `?redirect=false` to get JSON with the authorization URL
   */
  async getMicrosoftLoginUrl(req, res, next) {
    try {
      const state = req.query.state || 'rover_ledger_auth';
      const redirectUri = req.query.redirect_uri || req.query.redirectUri;
      const loginUrl = authService.getLoginUrl(state, redirectUri);

      // If requested via browser or without explicit redirect=false, redirect user
      if (req.query.redirect === 'false' || req.xhr || req.headers.accept?.includes('application/json')) {
        return sendSuccess(res, 200, 'Microsoft login URL generated', { loginUrl });
      }

      return res.redirect(loginUrl);
    } catch (error) {
      return sendError(res, 500, error.message);
    }
  }

  /**
   * OAuth Redirect Callback Handler
   * 
   * Endpoint: GET /auth/microsoft/callback
   * 
   * Microsoft redirects the browser here with `?code=...` after user approves permissions.
   */
  async handleMicrosoftCallback(req, res, next) {
    try {
      const { code, error, error_description } = req.query;

      if (error) {
        return sendError(res, 400, `Microsoft authentication failed: ${error}`, error_description);
      }

      if (!code) {
        return sendError(res, 400, 'Missing authorization code from Microsoft callback');
      }

      // Complete login flow with the received code
      const result = await authService.loginWithMicrosoft({ code });

      return sendSuccess(res, 200, 'Microsoft authentication successful via callback', result);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  /**
   * API: Logout User
   * 
   * Endpoint: POST /auth/logout
   * 
   * Marks the user's isActive status as false in the database.
   * Can identify user via:
   * 1. Authorization Bearer JWT token (req.user.UserId)
   * 2. Request body { UserId } or { email }
   */
  async logout(req, res, next) {
    try {
      const userId = req.user?.UserId || req.body?.UserId || req.body?.userId;
      const email = req.user?.Email || req.body?.Email || req.body?.email;

      if (!userId && !email) {
        return sendError(
          res,
          400,
          'Validation Error: Please provide an Authorization Bearer token or "UserId" / "email" in request body.'
        );
      }

      const result = await authService.logout({ userId, email });

      return sendSuccess(res, 200, 'User logged out successfully', result);
    } catch (error) {
      console.error('❌ [AuthController.logout Error]:', error.message);
      return sendError(res, 400, error.message);
    }
  }
}

module.exports = new AuthController();
