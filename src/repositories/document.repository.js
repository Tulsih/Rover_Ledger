const { eq, and, or, ilike, gte, lte, desc, asc, sql, inArray } = require('drizzle-orm');
const { db } = require('../db');
const { DocumentDetails } = require('../models');

/**
 * Document Repository
 * 
 * Handles all database operations for the `document_details` table using Drizzle ORM.
 */
class DocumentRepository {
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
        pdfCreated: data.pdfCreated !== undefined ? Boolean(data.pdfCreated) : false,
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

    return result[0];
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

    return result[0] || null;
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

    // Filter by documentType (e.g. 'income' or 'expense')
    if (filters.documentType) {
      const typeStr = String(filters.documentType).trim().toLowerCase();
      conditions.push(ilike(DocumentDetails.documentType, typeStr));
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

    // Filter by pdfCreated status
    if (filters.pdfCreated !== undefined && filters.pdfCreated !== '') {
      const isPdfCreated = String(filters.pdfCreated).toLowerCase() === 'true';
      conditions.push(eq(DocumentDetails.pdfCreated, isPdfCreated));
    }

    // Filter by fileType (e.g., 'image/png', 'application/pdf', or 'pdf')
    if (filters.fileType) {
      conditions.push(ilike(DocumentDetails.fileType, `%${filters.fileType.trim()}%`));
    }

    // Filter by user ID if provided
    if (filters.uploadedBy) {
      conditions.push(eq(DocumentDetails.uploadedBy, filters.uploadedBy));
    }

    return conditions;
  }

  /**
   * Fetch all active documents for a specific authenticated user (or general),
   * along with total count, incomeInvoiceCount, and expenseInvoiceCount scoped to that user.
   * 
   * @param {object} options - Optional { uploadedBy, page, limit, sortBy, order }
   * @returns {Promise<{ rows: Array, total: number, page: number, limit: number, totalPages: number, incomeInvoiceCount: number, expenseInvoiceCount: number }>}
   */
  async getAllActiveDocuments(options = {}) {
    const sortColumnMap = {
      createdAt: DocumentDetails.createdAt,
      updatedAt: DocumentDetails.updatedAt,
      documentDate: DocumentDetails.documentDate,
      documentName: DocumentDetails.documentName,
      documentType: DocumentDetails.documentType,
      fileSize: DocumentDetails.fileSize,
    };

    const sortColumn = sortColumnMap[options.sortBy] || DocumentDetails.createdAt;
    const sortDirection = String(options.order || 'desc').toLowerCase() === 'asc' ? asc : desc;

    // Filter by softDelete = false and scope to authenticated user if uploadedBy is provided
    const conditions = [eq(DocumentDetails.softDelete, false)];
    if (options.uploadedBy) {
      conditions.push(eq(DocumentDetails.uploadedBy, options.uploadedBy));
    }

    const whereClause = and(...conditions);

    // Fetch aggregate statistics: total, incomeInvoiceCount, expenseInvoiceCount strictly for this user
    const statsResult = await db
      .select({
        total: sql`count(*)::int`,
        incomeInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = 'income')::int`,
        expenseInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = 'expense')::int`,
      })
      .from(DocumentDetails)
      .where(whereClause);

    const total = parseInt(statsResult[0]?.total || '0', 10);
    const incomeInvoiceCount = parseInt(statsResult[0]?.incomeInvoiceCount || '0', 10);
    const expenseInvoiceCount = parseInt(statsResult[0]?.expenseInvoiceCount || '0', 10);

    const hasLimit = options.limit !== undefined && options.limit !== null && options.limit !== '';
    const limit = hasLimit ? Math.max(1, parseInt(options.limit, 10)) : (total > 0 ? total : 10);
    const page = Math.max(1, parseInt(options.page || '1', 10));
    const offset = (page - 1) * limit;

    let query = db
      .select()
      .from(DocumentDetails)
      .where(whereClause)
      .orderBy(sortDirection(sortColumn));

    if (hasLimit || total > 0) {
      query = query.limit(limit).offset(offset);
    }

    const rows = await query;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

    return {
      rows,
      total,
      page,
      limit,
      totalPages: totalPages || 1,
      incomeInvoiceCount,
      expenseInvoiceCount,
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

    // Sorting column mapping
    const sortColumnMap = {
      createdAt: DocumentDetails.createdAt,
      updatedAt: DocumentDetails.updatedAt,
      documentDate: DocumentDetails.documentDate,
      documentName: DocumentDetails.documentName,
      documentType: DocumentDetails.documentType,
      fileSize: DocumentDetails.fileSize,
    };

    const sortColumn = sortColumnMap[options.sortBy] || DocumentDetails.createdAt;
    const sortDirection = String(options.order || 'desc').toLowerCase() === 'asc' ? asc : desc;

    // Execute queries for rows and total counts
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(DocumentDetails)
        .where(whereClause)
        .orderBy(sortDirection(sortColumn))
        .limit(limit)
        .offset(offset),
      db
        .select({
          total: sql`count(*)::int`,
          incomeInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = 'income')::int`,
          expenseInvoiceCount: sql`count(*) filter (where lower(${DocumentDetails.documentType}) = 'expense')::int`,
        })
        .from(DocumentDetails)
        .where(whereClause),
    ]);

    const total = parseInt(countResult[0]?.total || '0', 10);
    const incomeInvoiceCount = parseInt(countResult[0]?.incomeInvoiceCount || '0', 10);
    const expenseInvoiceCount = parseInt(countResult[0]?.expenseInvoiceCount || '0', 10);

    return {
      rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      incomeInvoiceCount,
      expenseInvoiceCount,
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

    return result[0] || null;
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

    return result;
  }
}

module.exports = new DocumentRepository();
