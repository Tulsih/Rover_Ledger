const { verifyAccessToken } = require('../utils/jwt.util');

/**
 * Extracts Bearer token from Authorization header or query param
 * Returns string token if valid, false if invalid Bearer format, or null if missing.
 */
const _extractToken = (req) => {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader) {
    const parts = authHeader.split(' ');
    return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : false;
  }
  return req.query?.token || req.query?.auth_token || null;
};

/**
 * Authentication Middleware
 * Verifies the JWT Bearer Access Token and attaches decoded payload to `req.user`.
 */
const authenticateToken = (req, res, next) => {
  const token = _extractToken(req);

  if (token === false) {
    return res.status(401).json({
      success: false,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Invalid authorization format. Format must be: Bearer <token>',
    });
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN_PROVIDED',
      message: 'Access denied. No authorization token provided.',
    });
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    const isExpired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      message: isExpired
        ? 'Authentication token has expired. Please refresh your token.'
        : 'Invalid authentication token.',
    });
  }
};

/**
 * Optional Authentication Middleware
 * Attaches user to req.user if a valid token is present, but does not block requests.
 */
const optionalAuth = (req, res, next) => {
  const token = _extractToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {}
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
};
