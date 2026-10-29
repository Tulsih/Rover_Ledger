const { eq, and } = require('drizzle-orm');
const { db } = require('../db');
const { RefreshTokens } = require('../models');

/**
 * Refresh Token Repository
 * 
 * Handles all database operations for the `refresh_tokens` table using Drizzle ORM.
 */
class RefreshTokenRepository {
  /**
   * Save a new hashed refresh token in the database
   * @param {object} data
   * @returns {Promise<object>} Created record
   */
  async createRefreshToken(data) {
    const result = await db
      .insert(RefreshTokens)
      .values({
        userId: data.userId,
        tokenHash: data.tokenHash,
        deviceInfo: data.deviceInfo || null,
        ipAddress: data.ipAddress || null,
        isRevoked: false,
        expiresAt: new Date(data.expiresAt),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  }

  /**
   * Find a refresh token record by its SHA-256 hash
   * @param {string} tokenHash
   * @returns {Promise<object|null>}
   */
  async findByTokenHash(tokenHash) {
    const result = await db
      .select()
      .from(RefreshTokens)
      .where(eq(RefreshTokens.tokenHash, tokenHash))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Mark a single refresh token as revoked
   * @param {string} tokenHash
   * @returns {Promise<object|null>}
   */
  async revokeToken(tokenHash) {
    const result = await db
      .update(RefreshTokens)
      .set({
        isRevoked: true,
        updatedAt: new Date(),
      })
      .where(eq(RefreshTokens.tokenHash, tokenHash))
      .returning();

    return result[0] || null;
  }

  /**
   * Revoke all active refresh tokens for a specific user (e.g. on logout or replay attack)
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async revokeAllUserTokens(userId) {
    const result = await db
      .update(RefreshTokens)
      .set({
        isRevoked: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(RefreshTokens.userId, userId),
          eq(RefreshTokens.isRevoked, false)
        )
      )
      .returning();

    return result;
  }
}

module.exports = new RefreshTokenRepository();

