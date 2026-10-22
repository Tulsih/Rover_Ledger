const { verifyToken } = require('../utils/jwt.util');
const { sendError } = require('../utils/response.util');

/**
 * Authentication Middleware
 * 
 * Verifies the JWT Bearer token from the incoming request Authorization header.
 * Attaches the authenticated user payload to `req.user`.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader) {
    return sendError(res, 401, 'Access denied. No authorization token provided.');
  }

  // Expecting format: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return sendError(res, 401, 'Invalid authorization format. Format must be: Bearer <token>');
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token);
    // Attach decoded user info ({ UserId, Email, Role, iat, exp }) to request object
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return sendError(res, 401, 'Authentication token has expired. Please login again.');
    }
    return sendError(res, 401, 'Invalid authentication token.');
  }
};

module.exports = {
  authenticateToken,
};
