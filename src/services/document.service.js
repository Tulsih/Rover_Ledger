const documentRepository = require('../repositories/document.repository');
const onedriveService = require('./onedrive.service');

// Allowed document types specified by user
const ALLOWED_DOCUMENT_TYPES = ['income', 'expense'];

// Standard UUID format validator (36-character hex with hyphens)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Document Service
 * Orchestrates business logic, validations, Microsoft OneDrive interactions, and database persistence.
 */
class DocumentService {
  /**
   * Upload an image/document to OneDrive and store metadata in Rover Ledger DB
   * 
   * @param {object} params
   * @param {object} params.file - Multer file object ({ originalname, mimetype, buffer, size })
   * @param {string} params.documentName - User-provided name for the document
   * @param {string} params.documentType - 'income' or 'expense'
   * @param {string|Date} params.documentDate - Date of document
   * @param {boolean|string} params.pdfCreated - Whether PDF is created
   * @param {object} params.user - Optional authenticated user context
   * @returns {Promise<object>} Created document record
   */
  async uploadDocument({ file, documentName, documentType, documentDate, pdfCreated, user }) {
    // 1. Validation: File presence
    if (!file || !file.buffer) {
      const err = new Error('No file provided. Please attach a document or image file.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Validation: documentName
    if (!documentName || typeof documentName !== 'string' || !documentName.trim()) {
      const err = new Error('Document name is required.');
      err.statusCode = 400;
      throw err;
    }

    // 3. Validation: documentType ('income' or 'expense')
    if (!documentType || typeof documentType !== 'string') {
      const err = new Error("Document type is required. Allowed values are 'income' or 'expense'.");
      err.statusCode = 400;
      throw err;
    }

    const normalizedType = documentType.trim().toLowerCase();
    if (!ALLOWED_DOCUMENT_TYPES.includes(normalizedType)) {
      const err = new Error(
        `Invalid document type '${documentType}'. Allowed values are 'income' or 'expense'.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Standardize 'expense' spelling to 'expense' as requested in schema, or keep 'income'
    const finalDocumentType = normalizedType === 'income' ? 'income' : 'expense';

    // 4. Validation: Date of document
    if (!documentDate) {
      const err = new Error('Date of document is required.');
      err.statusCode = 400;
      throw err;
    }

    const parsedDate = new Date(documentDate);
    if (isNaN(parsedDate.getTime())) {
      const err = new Error('Invalid Date of document format. Please provide a valid date string (e.g. YYYY-MM-DD).');
      err.statusCode = 400;
      throw err;
    }

    // 5. Parse pdfCreated boolean
    let isPdfCreated = false;
    if (pdfCreated !== undefined && pdfCreated !== null) {
      isPdfCreated = String(pdfCreated).toLowerCase() === 'true';
    }

    // 6. Generate collision-resistant unique filename for OneDrive storage
    const timestampPrefix = Date.now();
    const sanitizedOriginalName = (file.originalname || 'document.bin').replace(/\s+/g, '_');
    const oneDriveTargetFileName = `${timestampPrefix}_${sanitizedOriginalName}`;

    console.log(`📤 Uploading '${file.originalname}' (${file.size} bytes) to Microsoft OneDrive folder...`);

    // 7. Upload to Microsoft OneDrive
    const onedriveResult = await onedriveService.uploadFileToOneDrive({
      fileName: oneDriveTargetFileName,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    console.log(`✅ File uploaded to OneDrive with item ID: ${onedriveResult.id}`);

    // 8. Persist metadata to PostgreSQL document_details table
    const documentRecord = await documentRepository.createDocument({
      documentName: documentName.trim(),
      documentType: finalDocumentType,
      fileSize: file.size,
      fileType: file.mimetype || 'application/octet-stream',
      documentDate: parsedDate,
      pdfCreated: isPdfCreated,
      oneDriveItemId: onedriveResult.id,
      oneDriveWebUrl: onedriveResult.webUrl,
      oneDriveDownloadUrl: onedriveResult.downloadUrl,
      originalFileName: file.originalname,
      uploadedBy: user?.UserId || null,
    });

    return documentRecord;
  }

  /**
   * Fetch all active documents across all users (softDelete = false)
   * with counts of income and expense invoices
   * @param {object} options - Options { page, limit, sortBy, order }
   * @returns {Promise<object>} Paginated documents and counts
   */
  async getAllDocuments(options = {}) {
    return documentRepository.getAllActiveDocuments(options);
  }

  /**
   * Filter documents by documentType, date range, documentName, pdfCreated, etc.
   * @param {object} query - Filter parameters
   * @returns {Promise<object>} Filtered paginated documents
   */
  async filterDocuments(query = {}) {
    return documentRepository.findWithFilters(query);
  }

  /**
   * Get single document details by ID
   * @param {string} id - Document UUID
   * @param {string|null} userId - Optional authenticated user ID to verify ownership
   * @returns {Promise<object>} Document details
   */
  async getDocumentById(id, userId = null) {
    const doc = await documentRepository.findById(id);
    if (!doc) {
      const err = new Error(`Document with ID '${id}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    // If document is owned by a user and requesting user does not match, deny access
    if (userId && doc.uploadedBy && doc.uploadedBy !== userId) {
      const err = new Error('Access denied. You do not have permission to view this document.');
      err.statusCode = 403;
      throw err;
    }

    return doc;
  }

  /**
   * Fetch file stream directly from OneDrive for downloading/viewing
   * @param {string} id - Document UUID
   * @param {string|null} userId - Optional authenticated user ID to verify ownership
   * @returns {Promise<object>} Stream, doc info, contentType, contentLength
   */
  async getDocumentFileStream(id, userId = null) {
    const doc = await this.getDocumentById(id, userId);

    try {
      const { stream, contentType, contentLength } = await onedriveService.getFileStreamFromOneDrive(
        doc.oneDriveItemId
      );

      return {
        stream,
        doc,
        contentType: contentType || doc.fileType,
        contentLength: contentLength || doc.fileSize,
      };
    } catch (error) {
      if (error.statusCode) throw error;
      console.error(`Failed to fetch file stream from OneDrive for document ${id}:`, error.message);
      const err = new Error('Unable to retrieve file content from Microsoft OneDrive.');
      err.statusCode = 502;
      throw err;
    }
  }

  /**
   * Soft delete a document
   * @param {string} id - Document UUID
   * @param {string|null} userId - Optional authenticated user ID to verify ownership
   * @returns {Promise<object>} Soft-deleted document record
   */
  async softDeleteDocument(id, userId = null) {
    // Check permission first if userId is provided
    if (userId) {
      await this.getDocumentById(id, userId);
    }

    const deleted = await documentRepository.softDelete(id);
    if (!deleted) {
      const err = new Error(`Document with ID '${id}' not found or already deleted.`);
      err.statusCode = 404;
      throw err;
    }
    return deleted;
  }

  /**
   * Bulk soft delete documents by array of IDs.
   * If an ID exists in DB and softDelete is false, updates softDelete to true.
   * 
   * @param {string[]} inputIds - Array of document UUIDs
   * @param {string|null} userId - Optional authenticated user ID to verify ownership
   * @returns {Promise<object>} Summary of bulk soft deletion
   */
  async bulkSoftDeleteDocuments(inputIds, userId = null) {
    if (!inputIds || !Array.isArray(inputIds) || inputIds.length === 0) {
      const err = new Error('Please provide a non-empty array of document IDs to delete (e.g. { "ids": ["id1", "id2"] }).');
      err.statusCode = 400;
      throw err;
    }

    // Clean, trim, and deduplicate IDs
    const cleanedIds = [...new Set(
      inputIds
        .map(id => (typeof id === 'string' ? id.trim() : ''))
        .filter(id => Boolean(id))
    )];

    if (cleanedIds.length === 0) {
      const err = new Error('No valid document IDs provided in array.');
      err.statusCode = 400;
      throw err;
    }

    // Separate valid UUIDs to prevent database syntax errors
    const validUuidIds = [];
    for (const id of cleanedIds) {
      if (UUID_REGEX.test(id)) {
        validUuidIds.push(id);
      }
    }

    let updatedDocuments = [];
    if (validUuidIds.length > 0) {
      updatedDocuments = await documentRepository.bulkSoftDelete(validUuidIds, userId);
    }

    const deletedIds = updatedDocuments.map(doc => doc.id);
    const deletedIdSet = new Set(deletedIds);

    // Any ID that was requested but not returned in updated records was either:
    // 1) Not in DB, 2) Already soft-deleted (softDelete = true), or 3) Invalid UUID format
    const notFoundOrAlreadyDeleted = cleanedIds.filter(id => !deletedIdSet.has(id));

    return {
      totalRequested: cleanedIds.length,
      deletedCount: deletedIds.length,
      deletedIds,
      notFoundOrAlreadyDeleted,
      documents: updatedDocuments,
    };
  }
}

module.exports = new DocumentService();
