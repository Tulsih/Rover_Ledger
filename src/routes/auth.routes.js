const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { optionalAuth } = require('../middlewares/auth.middleware');

/**
 * Authentication Routes
 * Base prefix: /auth
 */

// API 1: Login with Microsoft
router.post('/microsoft', authController.loginWithMicrosoft);

// API 2: Refresh Access Token
router.post('/refresh', authController.refreshToken);

// API 3: Logout
router.post('/logout', optionalAuth, authController.logout);

// Helper: Redirect to Microsoft Login consent page
router.get('/microsoft', authController.getMicrosoftLoginUrl);

// Microsoft OAuth redirect callback (Browser flow)
router.get('/microsoft/callback', authController.handleMicrosoftCallback);

module.exports = router;
