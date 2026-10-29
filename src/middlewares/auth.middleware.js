const { verifyAccessToken } = require('../utils/jwt.util');

/**
 * Authentication Middleware
 * 
 * Verifies the JWT Bearer Access Token from incoming Authorization header.
 * Attaches the authenticated user payload to `req.user`.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN_PROVIDED',
      message: 'Access denied. No authorization token provided.',
    });
  }

  // Expecting format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Invalid authorization format. Format must be: Bearer <token>',
    });
  }

  const token = parts[1];

  try {
    const decoded = verifyAccessToken(token);
    // Attach decoded user info ({ UserId, Email, Role, iat, exp }) to request object
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired. Please refresh your token.',
      });
    }
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN',
      message: 'Invalid authentication token.',
    });
  }
};

/**
 * Optional Authentication Middleware
 * 
 * Attaches user to req.user if a valid token is present, but does not block requests without token.
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) {
    return next();
  }

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    try {
      const decoded = verifyAccessToken(parts[1]);
      req.user = decoded;
    } catch (e) {
      // For optional auth, continue even if token is invalid or expired
    }
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
};
