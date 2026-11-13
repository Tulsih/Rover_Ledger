const express = require('express');
const router = express.Router();
const googleAuthController = require('../controllers/googleAuth.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');
const { requireAdmin } = require('../middlewares/role.middleware');

/**
 * Google Drive OAuth & Status Routes
 * Base mount point: /auth/google
 */

// 1. Initiate Google OAuth connection flow (Admin Only)
router.get('/connect', authenticateToken, requireAdmin, googleAuthController.connect);

// 2. Google OAuth callback handler (GET only, as required by Google OAuth 2.0)
router.get('/callback', googleAuthController.callback);

// 3. Connection status (for Profile menu)
router.get('/status', googleAuthController.getStatus);

// 4. Disconnect Google Drive (Admin Only)
router.post('/disconnect', authenticateToken, requireAdmin, googleAuthController.disconnect);

module.exports = router;
