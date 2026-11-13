const { eq, and, or, ilike, gte, lte, desc, asc, sql, inArray, isNull } = require('drizzle-orm');
const { db } = require('../db');
const { DocumentDetails } = require('../models');
const documentCaShareRepository = require('./documentCaShare.repository');
const { DocumentType } = require('../enums');

const SORT_COLUMNS = {
  createdAt: DocumentDetails.createdAt,
  updatedAt: DocumentDetails.updatedAt,
  documentDate: DocumentDetails.documentDate,
  documentName: DocumentDetails.documentName,
  documentType: DocumentDetails.documentType,
  fileSize: DocumentDetails.fileSize,
};

const getSortOrder = (sortBy, order) => {
  const column = SORT_COLUMNS[sortBy] || DocumentDetails.createdAt;
  return String(order || 'desc').toLowerCase() === 'asc' ? asc(column) : desc(column);
};

/**
 * Document Repository
 * 
 * Handles all database operations for the `document_details` table using Drizzle ORM.
 */
class DocumentRepository {
  /**
   * Helper to attach direct streaming and download URLs to document objects
   * @param {object} doc
   * @param {object|null} caShare
   * @returns {object}
   */
  _enrichDocument(doc, caShare = null) {
    if (!doc) return null;
    const { pdfCreated, ...cleanDoc } = doc;
    return {
      ...cleanDoc,
      contentUrl: `/documents/${doc.id}/content`,
      downloadUrl: `/documents/${doc.id}/download`,
      isSharedWithCa: Boolean(caShare),
      sharedWithCaAt: caShare?.sharedAt || null,
      googleDriveFileId: caShare?.googleDriveFileId || null,
      googleDriveViewUrl: caShare?.googleDriveWebViewLink || null,
    };
  }

  /**
   * Helper to batch enrich document rows with CA share details
   * @param {Array} rows
   * @returns {Promise<Array>}
   */
  async _enrichDocumentsWithShares(rows) {
    if (!rows || rows.length === 0) return [];
    let shareMap = new Map();
    try {
      shareMap = await documentCaShareRepository.findByDocumentIds(rows.map((r) => r.id));
    } catch {}
    return rows.map((r) => this._enrichDocument(r, shareMap.get(r.id)));
  }

  /**
   * Insert a new document record into `document_details` table
   * @param {object} data
   * @returns {Promise<object>} Created document record
   */
  async createDocument(data) {
    const result = await db
      .insert(DocumentDetails)
      .values({
        documentName: data.documentName,
        documentType: data.documentType,
        fileSize: data.fileSize,
        fileType: data.fileType,
        documentDate: new Date(data.documentDate),
        softDelete: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        oneDriveItemId: data.oneDriveItemId,
        oneDriveWebUrl: data.oneDriveWebUrl || null,
        oneDriveDownloadUrl: data.oneDriveDownloadUrl || null,
        originalFileName: data.originalFileName,
        uploadedBy: data.uploadedBy || null,
      })
      .returning();

    return this._enrichDocument(result[0]);
  }

  /**
   * Find document by primary key (id)
   * @param {string} id - UUID
   * @param {boolean} includeDeleted - Whether to include soft-deleted records
   * @returns {Promise<object|null>} Document record or null
   */
  async findById(id, includeDeleted = false) {
    const conditions = [eq(DocumentDetails.id, id)];
    if (!includeDeleted) {
      conditions.push(eq(DocumentDetails.softDelete, false));
    }

    const result = await db
      .select()
      .from(DocumentDetails)
      .where(and(...conditions))
      .limit(1);

    if (!result[0]) return null;

    let caShare = null;
    try {
      caShare = await documentCaShareRepository.findByDocumentId(id);
    } catch {
      // Graceful fallback if table not yet populated or error occurs
    }

    return this._enrichDocument(result[0], caShare);
  }

  /**
   * Build condition array for filtering queries
   * @param {object} filters
   * @returns {Array} Drizzle conditions
   */
  _buildConditions(filters = {}) {
    const conditions = [];

    // Filter soft deleted records unless explicitly requested
    if (filters.includeDeleted !== true && filters.includeDeleted !== 'true') {
      conditions.push(eq(DocumentDetails.softDelete, false));
    }

    // Filter by documentType (e.g. 'income', 'expense', or 'null')
    if (filters.documentType !== undefined && filters.documentType !== '') {
      const typeStr = String(filters.documentType).trim().toLowerCase();
      if (typeStr === 'undefined') {
        // Ignore "undefined" string if sent from FE
      } else if (typeStr === 'null' || filters.documentType === null) {
        conditions.push(isNull(DocumentDetails.documentType));
      } else {
        conditions.push(ilike(DocumentDetails.documentType, typeStr));
      }
    }

    // Filter by documentName (partial case-insensitive match)
    if (filters.documentName) {
      conditions.push(ilike(DocumentDetails.documentName, `%${filters.documentName.trim()}%`));
    }

    // Filter by general search string (matches documentName or originalFileName)
    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(DocumentDetails.documentName, term),
          ilike(DocumentDetails.originalFileName, term)
        )
      );
    }

    // Filter by documentDate range
    if (filters.startDate) {
      conditions.push(gte(DocumentDetails.documentDate, new Date(filters.startDate)));
    }
    if (filters.endDate) {
      conditions.push(lte(DocumentDetails.documentDate, new Date(filters.endDate)));
    }



    // Filter by fileType (e.g., 'image/png', 'application/pdf', or 'pdf')
    if (filters.fileType) {
      conditions.push(ilike(DocumentDetails.fileType, `%${filters.fileType.trim()}%`));
    }

    // Filter by user ID if provided
    if (filters.uploadedBy) {
      conditions.push(eq(DocumentDetails.uploadedBy, filters.uploadedBy));
    }

    // Filter by isSharedWithCa (boolean: true or false)
    const shareFilter = filters.isSharedWithCa !== undefined ? filters.isSharedWithCa : filters.isShareWithCa;
    if (shareFilter !== undefined && shareFilter !== null && shareFilter !== '') {
      const isShared = String(shareFilter).trim().toLowerCase() === 'true' || shareFilter === true;
      if (isShared) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM document_ca_shares WHERE document_ca_shares."documentId" = ${DocumentDetails.id})`
        );
      } else {
        conditions.push(
          sql`NOT EXISTS (SELECT 1 FROM document_ca_shares WHERE document_ca_shares."documentId" = ${DocumentDetails.id})`
        );
      }
    }

    return conditions;
  }

  /**
   * Fetch all active documents for a specific authenticated user,
   * without aggregate count calculation (counts moved to dedicated getDocumentCounts API).
   * 
   * @param {object} options - Optional { uploadedBy, page, limit, sortBy, order }
   * @returns {Promise<{ rows: Array, page?: number, limit?: number, totalPages?: number }>}
   */
  async getAllActiveDocuments(options = {}) {
    const conditions = this._buildConditions(options);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const hasLimit = options.limit !== undefined && options.limit !== null && options.limit !== '';
    const limit = hasLimit ? Math.max(1, parseInt(options.limit, 10)) : null;
    const page = Math.max(1, parseInt(options.page || '1', 10));

    let query = db
      .select()
      .from(DocumentDetails)
      .where(whereClause)
      .orderBy(getSortOrder(options.sortBy, options.order));

    if (limit) {
      query = query.limit(limit).offset((page - 1) * limit);
    }

    const rows = await query;
    const enrichedRows = await this._enrichDocumentsWithShares(rows);

    const response = { rows: enrichedRows };

    if (hasLimit || options.page) {
      response.page = page;
      response.limit = limit || enrichedRows.length;
      response.totalPages = limit ? Math.max(1, Math.ceil(enrichedRows.length / limit)) : 1;
    }

    return response;
  }

  /**
   * Fetch aggregate statistics and 4 counts strictly for the authenticated user:
   * 1. total - Total active documents
   * 2. incomeInvoiceCount - Total active income documents
   * 3. expenseInvoiceCount - Total active expense documents
   * 4. pdfCount - Total active PDF documents (fileType or fileName contains PDF)
   * 
   * @param {object} options - Optional { uploadedBy }
   * @returns {Promise<{ total: number, incomeInvoiceCount: number, expenseInvoiceCount: number, pdfCount: number }>}
   */
  async getDocumentCounts(options = {}) {
    const conditions = [eq(DocumentDetails.softDelete, false)];
    if (options.uploadedBy) {
      conditions.push(eq(DocumentDetails.uploadedBy, options.uploadedBy));
    }

    const whereClause = and(...conditions);

    const statsResult = await db
      .select({
        total: sql`count(*)::int`,
        incomeInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = ${DocumentType.INCOME})::int`,
        expenseInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = ${DocumentType.EXPENSE})::int`,
        pdfCount: sql`count(*) filter (where lower(${DocumentDetails.fileType}) like '%pdf%' or lower(${DocumentDetails.originalFileName}) like '%.pdf')::int`,
      })
      .from(DocumentDetails)
      .where(whereClause);

    const total = parseInt(statsResult[0]?.total || '0', 10);
    const incomeInvoiceCount = parseInt(statsResult[0]?.incomeInvoiceCount || '0', 10);
    const expenseInvoiceCount = parseInt(statsResult[0]?.expenseInvoiceCount || '0', 10);
    const pdfCount = parseInt(statsResult[0]?.pdfCount || '0', 10);

    return {
      total,
      incomeInvoiceCount,
      expenseInvoiceCount,
      pdfCount,
    };
  }

  /**
   * Find documents with filters, pagination, and sorting
   * @param {object} options
   * @returns {Promise<{ rows: Array, total: number, page: number, limit: number, totalPages: number, incomeInvoiceCount: number, expenseInvoiceCount: number }>}
   */
  async findWithFilters(options = {}) {
    const page = Math.max(1, parseInt(options.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(options.limit || '10', 10)));
    const offset = (page - 1) * limit;

    const conditions = this._buildConditions(options);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Execute queries for rows and total counts
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(DocumentDetails)
        .where(whereClause)
        .orderBy(getSortOrder(options.sortBy, options.order))
        .limit(limit)
        .offset(offset),
      db
        .select({
          total: sql`count(*)::int`,
          incomeInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = ${DocumentType.INCOME})::int`,
          expenseInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = ${DocumentType.EXPENSE})::int`,
        })
        .from(DocumentDetails)
        .where(whereClause),
    ]);

    const total = parseInt(countResult[0]?.total || '0', 10);
    const enrichedRows = await this._enrichDocumentsWithShares(rows);

    return {
      rows: enrichedRows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      incomeInvoiceCount: parseInt(countResult[0]?.incomeInvoiceCount || '0', 10),
      expenseInvoiceCount: parseInt(countResult[0]?.expenseInvoiceCount || '0', 10),
    };
  }

  /**
   * Update document details by ID
   * @param {string} id - UUID
   * @param {object} updateData
   * @returns {Promise<object|null>}
   */
  async updateDocument(id, updateData) {
    const dataToUpdate = {
      ...updateData,
      updatedAt: new Date(),
    };

    const result = await db
      .update(DocumentDetails)
      .set(dataToUpdate)
      .where(
        and(
          eq(DocumentDetails.id, id),
          eq(DocumentDetails.softDelete, false)
        )
      )
      .returning();

    return result[0] || null;
  }

  /**
   * Soft delete document by setting softDelete = true
   * @param {string} id - UUID
   * @returns {Promise<object|null>}
   */
  async softDelete(id) {
    const result = await db
      .update(DocumentDetails)
      .set({
        softDelete: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(DocumentDetails.id, id),
          eq(DocumentDetails.softDelete, false)
        )
      )
      .returning();

    return this._enrichDocument(result[0]) || null;
  }

  /**
   * Bulk soft delete documents
   * @param {string[]} ids
   * @param {string|null} userId
   * @returns {Promise<Array>}
   */
  async bulkSoftDelete(ids, userId = null) {
    if (!ids || ids.length === 0) {
      return [];
    }

    const conditions = [
      inArray(DocumentDetails.id, ids),
      eq(DocumentDetails.softDelete, false),
    ];

    if (userId) {
      conditions.push(
        or(
          eq(DocumentDetails.uploadedBy, userId),
          sql`${DocumentDetails.uploadedBy} IS NULL`
        )
      );
    }

    const result = await db
      .update(DocumentDetails)
      .set({
        softDelete: true,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();

    return result.map((r) => this._enrichDocument(r));
  }

  /**
   * Fetch all documents uploaded by a specific user (including soft-deleted)
   * Used for cascading cleanup to delete physical files from Microsoft OneDrive
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async findAllByUploadedBy(userId) {
    if (!userId) return [];
    const results = await db
      .select()
      .from(DocumentDetails)
      .where(eq(DocumentDetails.uploadedBy, userId));
    return results.map((r) => this._enrichDocument(r));
  }

  /**
   * Permanently hard-delete all document records uploaded by a user
   * @param {string} userId
   * @param {object|null} tx - Optional transaction handle
   * @returns {Promise<number>} Count of deleted document rows
   */
  async deleteByUploadedBy(userId, tx = null) {
    if (!userId) return 0;
    const executor = tx || db;
    const deleted = await executor
      .delete(DocumentDetails)
      .where(eq(DocumentDetails.uploadedBy, userId))
      .returning({ id: DocumentDetails.id });
    return deleted.length;
  }
}

module.exports = new DocumentRepository();
