const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'rover_ledger_super_secret_jwt_key_2026';

// Access Token configuration (Short-lived: default 15m)
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || JWT_SECRET;
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';

// Refresh Token configuration (Long-lived: default 7d)
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'rover_ledger_refresh_secret_key_2026';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Helper to parse time string (e.g. '15m', '7d', '1h', '900s') into seconds
 */
const parseExpiresInSeconds = (durationStr) => {
  if (typeof durationStr === 'number') return durationStr;
  const match = String(durationStr).match(/^(\d+)([smhd])$/);
  if (!match) return 900;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return val;
    case 'm': return val * 60;
    case 'h': return val * 3600;
    case 'd': return val * 86400;
    default: return 900;
  }
};

/**
 * Generate a short-lived Access Token for API authorization
 * Embeds unique `jti` to ensure unique signatures across rapid calls
 * @param {object} payload - { UserId, Email, Role }
 * @returns {string} Signed JWT Access Token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(
    {
      ...payload,
      jti: crypto.randomUUID(),
    },
    JWT_ACCESS_SECRET,
    {
      expiresIn: JWT_ACCESS_EXPIRES_IN,
    }
  );
};

/**
 * Generate a long-lived Refresh Token for obtaining new Access Tokens
 * Embeds unique `jti` to guarantee uniqueness for database hashing
 * @param {object} payload - { UserId, Email, Role }
 * @returns {string} Signed JWT Refresh Token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(
    {
      ...payload,
      jti: crypto.randomUUID(),
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
    }
  );
};

/**
 * Verify and decode an Access Token
 * @param {string} token
 * @returns {object} Decoded token payload
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_ACCESS_SECRET);
};

/**
 * Verify and decode a Refresh Token
 * @param {string} token
 * @returns {object} Decoded token payload
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_REFRESH_SECRET);
};

/**
 * Cryptographically hash a refresh token using SHA-256 before database storage
 * @param {string} token
 * @returns {string} Hex-encoded SHA-256 hash
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(String(token).trim()).digest('hex');
};

/**
 * Backward compatibility aliases
 */
const generateToken = (payload) => generateAccessToken(payload);
const verifyToken = (token) => verifyAccessToken(token);

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  generateToken,
  verifyToken,
  parseExpiresInSeconds,
  JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN,
};
