const crypto = require('crypto');
const { env } = require('../configs/env');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from the configured encryption key or JWT secret
 */
function getEncryptionKey() {
  const secret = env.googleTokenEncryptionKey || env.jwtSecret || 'rover_ledger_google_token_key_32';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypts sensitive string (e.g. Google refresh token) using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Hex-encoded string (iv:tag:ciphertext)
 */
function encryptToken(text) {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted string
 * @param {string} encryptedText - Hex-encoded string (iv:tag:ciphertext)
 * @returns {string} Plain text
 */
function decryptToken(encryptedText) {
  if (!encryptedText) return null;
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // If not in iv:tag:ciphertext format, return as-is (fallback)
    return encryptedText;
  }

  const [ivHex, tagHex, cipherHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = {
  encryptToken,
  decryptToken,
};

