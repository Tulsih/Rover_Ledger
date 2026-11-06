const { eq, desc } = require('drizzle-orm');
const { db } = require('../db');
const { CompanyGoogleConfigs } = require('../models');

/**
 * Repository for managing company_google_configs table
 */
class GoogleConfigRepository {
  /**
   * Fetches the currently active Google Drive configuration
   * @returns {Promise<object|null>}
   */
  async getActiveConfig() {
    const results = await db
      .select()
      .from(CompanyGoogleConfigs)
      .where(eq(CompanyGoogleConfigs.isConnected, true))
      .orderBy(desc(CompanyGoogleConfigs.updatedAt))
      .limit(1);

    return results[0] || null;
  }

  /**
   * Saves or replaces company Google Drive connection
   * @param {object} params
   * @returns {Promise<object>}
   */
  async saveConfig({ googleEmail, encryptedRefreshToken, targetFolderId, caEmail }) {
    // If an existing config exists, update it; otherwise insert
    const existing = await this.getActiveConfig();

    if (existing) {
      const updated = await db
        .update(CompanyGoogleConfigs)
        .set({
          googleEmail,
          encryptedRefreshToken,
          targetFolderId: targetFolderId || existing.targetFolderId,
          caEmail: caEmail || existing.caEmail,
          isConnected: true,
          updatedAt: new Date(),
        })
        .where(eq(CompanyGoogleConfigs.id, existing.id))
        .returning();

      return updated[0];
    }

    const inserted = await db
      .insert(CompanyGoogleConfigs)
      .values({
        googleEmail,
        encryptedRefreshToken,
        targetFolderId: targetFolderId || null,
        caEmail,
        isConnected: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return inserted[0];
  }

  /**
   * Updates target Google Drive folder ID
   * @param {string} id - Config ID
   * @param {string} targetFolderId - Google Drive Folder ID
   * @returns {Promise<object>}
   */
  async updateFolderId(id, targetFolderId) {
    const updated = await db
      .update(CompanyGoogleConfigs)
      .set({
        targetFolderId,
        updatedAt: new Date(),
      })
      .where(eq(CompanyGoogleConfigs.id, id))
      .returning();

    return updated[0];
  }

  /**
   * Disconnects active Google connection
   * @returns {Promise<boolean>}
   */
  async disconnect() {
    await db
      .update(CompanyGoogleConfigs)
      .set({
        isConnected: false,
        updatedAt: new Date(),
      });
    return true;
  }
}

module.exports = new GoogleConfigRepository();

