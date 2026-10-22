const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

/**
 * Authentication Routes
 * Base prefix: /auth
 */

const { verifyToken } = require('../utils/jwt.util');

// Middleware to extract user from Authorization Bearer token if provided
const optionalOrBearerAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      try {
        req.user = verifyToken(parts[1]);
      } catch (err) {
        return res.status(401).json({
          success: false,
          message:
            err.name === 'TokenExpiredError'
              ? 'Authentication token has expired. Please login again.'
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

// API 4: Logout (POST /auth/logout)
router.post('/logout', optionalOrBearerAuth, authController.logout.bind(authController));

// Helper: Redirect to Microsoft Login consent page (GET /auth/microsoft)
router.get('/microsoft', authController.getMicrosoftLoginUrl.bind(authController));

// Microsoft OAuth redirect callback (GET /auth/microsoft/callback)
router.get('/microsoft/callback', authController.handleMicrosoftCallback.bind(authController));

module.exports = router;
