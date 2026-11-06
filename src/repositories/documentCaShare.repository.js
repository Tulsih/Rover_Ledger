const { eq, inArray } = require('drizzle-orm');
const { db } = require('../db');
const { DocumentCaShares } = require('../models');

/**
 * Repository for managing document_ca_shares table
 */
class DocumentCaShareRepository {
  /**
   * Find sharing record by document ID
   * @param {string} documentId
   * @returns {Promise<object|null>}
   */
  async findByDocumentId(documentId) {
    if (!documentId) return null;
    const results = await db
      .select()
      .from(DocumentCaShares)
      .where(eq(DocumentCaShares.documentId, documentId))
      .limit(1);

    return results[0] || null;
  }

  /**
   * Find sharing records for multiple document IDs (batch lookup)
   * @param {string[]} documentIds
   * @returns {Promise<Map<string, object>>}
   */
  async findByDocumentIds(documentIds) {
    if (!documentIds || documentIds.length === 0) return new Map();

    const results = await db
      .select()
      .from(DocumentCaShares)
      .where(inArray(DocumentCaShares.documentId, documentIds));

    const map = new Map();
    for (const r of results) {
      map.set(r.documentId, r);
    }
    return map;
  }

  /**
   * Record a document share to CA
   * @param {object} params
   * @returns {Promise<object>}
   */
  async createShare({ documentId, googleDriveFileId, googleDriveWebViewLink, caEmail, sharedByUserId }) {
    const inserted = await db
      .insert(DocumentCaShares)
      .values({
        documentId,
        googleDriveFileId,
        googleDriveWebViewLink: googleDriveWebViewLink || null,
        caEmail,
        sharedByUserId,
        sharedAt: new Date(),
      })
      .returning();

    return inserted[0];
  }
}

module.exports = new DocumentCaShareRepository();

