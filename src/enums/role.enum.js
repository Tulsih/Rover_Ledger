/**
 * Application User Roles Enum
 * Key and value: ADMIN = 'Admin', USER = 'User'
 */
const Role = Object.freeze({
  ADMIN: 'Admin',
  USER: 'User',
});

/**
 * Valid roles list dynamically extracted via Object.values()
 */
const ROLES = Object.freeze(Object.values(Role));

/**
 * Validate if a role string matches any valid Role
 * @param {string} role
 * @returns {boolean}
 */
const isValidRole = (role) => typeof role === 'string' && ROLES.includes(role);

module.exports = {
  Role,
  ROLES,
  isValidRole,
};

