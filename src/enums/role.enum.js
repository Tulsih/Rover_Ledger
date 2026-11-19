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

/**
 * Default fallback admin emails for company employees.
 * Can be augmented or overridden via ADMIN_EMAILS in .env (comma-separated).
 */
const DEFAULT_ADMIN_EMAILS = Object.freeze([
  'admin@roverledger.com',
]);

/**
 * Determine the user role based on email and configured admin emails.
 * Normalizes email comparison (case-insensitive, trimmed).
 *
 * @param {string} email - The user's email address
 * @param {string[]|string} [configuredAdminEmails=[]] - List or comma-separated string of admin emails from config/env
 * @returns {string} Role.ADMIN or Role.USER
 */
const determineUserRole = (email, configuredAdminEmails = []) => {
  if (!email || typeof email !== 'string') return Role.USER;

  const normalizedEmail = email.trim().toLowerCase();

  let adminList = [];
  if (Array.isArray(configuredAdminEmails)) {
    adminList = configuredAdminEmails;
  } else if (typeof configuredAdminEmails === 'string') {
    adminList = configuredAdminEmails.split(',');
  }

  const allAdminEmails = new Set([
    ...DEFAULT_ADMIN_EMAILS.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')),
    ...adminList.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')),
  ]);
  allAdminEmails.delete('');

  return allAdminEmails.has(normalizedEmail) ? Role.ADMIN : Role.USER;
};

module.exports = {
  Role,
  ROLES,
  isValidRole,
  DEFAULT_ADMIN_EMAILS,
  determineUserRole,
};


