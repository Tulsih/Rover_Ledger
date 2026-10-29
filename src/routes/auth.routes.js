const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyAccessToken } = require('../utils/jwt.util');

/**
 * Authentication Routes
 * Base prefix: /auth
 */

// Middleware to extract user from Authorization Bearer token if provided
const optionalOrBearerAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      try {
        req.user = verifyAccessToken(parts[1]);
      } catch (err) {
        return res.status(401).json({
          success: false,
          code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          message:
            err.name === 'TokenExpiredError'
              ? 'Authentication token has expired. Please refresh your token.'
              : 'Invalid authentication token.',
        });
      }
    }
  }
  next();
};

// API 1: Login with Microsoft (POST /auth/microsoft or /auth/microsoft/login)
router.post('/microsoft', authController.loginWithMicrosoft.bind(authController));
router.post('/microsoft/login', authController.loginWithMicrosoft.bind(authController));

// API 2: Refresh Access Token (POST /auth/refresh or /auth/token/refresh)
router.post('/refresh', authController.refreshToken.bind(authController));
router.post('/token/refresh', authController.refreshToken.bind(authController));

// API 3: Logout (POST /auth/logout)
router.post('/logout', optionalOrBearerAuth, authController.logout.bind(authController));

// Helper: Redirect to Microsoft Login consent page (GET /auth/microsoft)
router.get('/microsoft', authController.getMicrosoftLoginUrl.bind(authController));

// Microsoft OAuth redirect callback (GET /auth/microsoft/callback)
router.get('/microsoft/callback', authController.handleMicrosoftCallback.bind(authController));

module.exports = router;
