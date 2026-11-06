const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const googleAuthRoutes = require('./googleAuth.routes');
const userRoutes = require('./user.routes');
const documentRoutes = require('./document.routes');

/**
 * Main API Router
 */

// Mount Auth routes under /auth
router.use('/auth', authRoutes);

// Mount Google Auth & Drive routes under /auth/google and /api/google alias
router.use('/auth/google', googleAuthRoutes);
router.use('/api/google', googleAuthRoutes);

// Mount User routes under /users
router.use('/users', userRoutes);

// Mount Document routes under /documents
router.use('/documents', documentRoutes);

module.exports = router;
