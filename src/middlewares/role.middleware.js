const { Role } = require('../enums');
const { sendError } = require('../utils/response.util');

/**
 * Middleware to restrict route access to specific user roles
 * @param {...string} allowedRoles - Array of roles permitted to access route
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.Role) {
      return sendError(res, 401, 'Authentication required. No user credentials found on request.');
    }

    if (!allowedRoles.includes(req.user.Role)) {
      return sendError(
        res,
        403,
        `Access denied. Only ${allowedRoles.join(' or ')} accounts are authorized to perform this action.`
      );
    }

    next();
  };
};

// Convenient shorthand for Admin-only routes
const requireAdmin = requireRole(Role.ADMIN);

module.exports = {
  requireRole,
  requireAdmin,
};

