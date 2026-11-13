const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');

/**
 * User Routes
 * Base prefix: /users
 * 
 * All routes below require valid JWT Bearer token in the Authorization header:
 * Authorization: Bearer <token>
 */

// API 2: Fetch current authenticated user's profile
router.get('/profile', authenticateToken, userController.getProfile);

// API 3: Update current authenticated user's profile
router.put('/profile', authenticateToken, userController.updateProfile);
router.patch('/profile', authenticateToken, userController.updateProfile);

// Permanent Account Deletion: Delete user, uploaded OneDrive files, and all DB records
router.delete('/profile', authenticateToken, userController.deleteProfile);

module.exports = router;
