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
router.get('/profile', authenticateToken, userController.getProfile.bind(userController));

// API 3: Update current authenticated user's profile
router.put('/profile', authenticateToken, userController.updateProfile.bind(userController));
router.patch('/profile', authenticateToken, userController.updateProfile.bind(userController));

module.exports = router;
