const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const documentRoutes = require('./document.routes');
const userController = require('../controllers/user.controller');
const { authenticateToken } = require('../middlewares/auth.middleware');

/**
 * Main API Router
 */

// Mount Auth routes under /auth
router.use('/auth', authRoutes);

// Mount User routes under /users
router.use('/users', userRoutes);

// Mount Document routes under /documents
router.use('/documents', documentRoutes);

// Direct /profile aliases for developer convenience
router.get('/profile', authenticateToken, userController.getProfile.bind(userController));
router.put('/profile', authenticateToken, userController.updateProfile.bind(userController));
router.patch('/profile', authenticateToken, userController.updateProfile.bind(userController));

module.exports = router;
