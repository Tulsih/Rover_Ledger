const express = require('express');
const router = express.Router();
const googleAuthController = require('../controllers/googleAuth.controller');
const { optionalAuth } = require('../middlewares/auth.middleware');

/**
 * Google Drive OAuth & Status Routes
 * Base mount point: /auth/google
 */

// 1. Initiate Google OAuth connection flow
router.get('/connect', googleAuthController.connect.bind(googleAuthController));

// 2. Google OAuth callback handler (GET only, as required by Google OAuth 2.0)
router.get('/callback', googleAuthController.callback.bind(googleAuthController));

// 3. Connection status (for Profile menu)
router.get('/status', googleAuthController.getStatus.bind(googleAuthController));

// 4. Disconnect Google Drive
router.post('/disconnect', optionalAuth, googleAuthController.disconnect.bind(googleAuthController));

module.exports = router;
