const path = require("path");
const documentRepository = require("../repositories/document.repository");
const documentCaShareRepository = require("../repositories/documentCaShare.repository");
const googleConfigRepository = require("../repositories/googleConfig.repository");
const onedriveService = require("./onedrive.service");
const googledriveService = require("./googledrive.service");
const { Role, DocumentType, DOCUMENT_TYPES, isValidDocumentType } = require("../enums");
const logger = require("../utils/logger.util");

// Standard UUID format validator (36-character hex with hyphens)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Document Service
 * Orchestrates business logic, validations, Microsoft OneDrive interactions, and database persistence.
 */
class DocumentService {
  /**
   * Helper to validate and normalize documentType ('income', 'expense', or null)
   */
  _parseDocumentType(type) {
    if (type === undefined || type === null || type === '') return null;
    if (typeof type !== 'string') {
      const err = new Error(`Invalid document type. Allowed values are '${DocumentType.INCOME}', '${DocumentType.EXPENSE}', or null.`);
      err.statusCode = 400;
      throw err;
    }
    const normalized = type.trim().toLowerCase();
    if (['null', 'none', 'undefined', ''].includes(normalized)) return null;
    if (normalized === DocumentType.INCOME) return DocumentType.INCOME;
    if (normalized === DocumentType.EXPENSE || normalized === 'expence') return DocumentType.EXPENSE;

    const err = new Error(`Invalid document type '${type}'. Allowed values are '${DocumentType.INCOME}', '${DocumentType.EXPENSE}', or null.`);
    err.statusCode = 400;
    throw err;
  }

  async uploadDocument({
    file,
    documentName,
    documentType,
    documentDate,
    user,
  }) {
    // 1. Validation: File presence
    if (!file || !file.buffer) {
      const err = new Error(
        "No file provided. Please attach a document or image file.",
      );
      err.statusCode = 400;
      throw err;
    }
    // 2. Validation: documentName
    if (
      !documentName ||
      typeof documentName !== "string" ||
      !documentName.trim()
    ) {
      const err = new Error("Document name is required.");
      err.statusCode = 400;
      throw err;
    }
    // 3. Validation & normalization: documentType
    const finalDocumentType = this._parseDocumentType(documentType);

    // 4. Validation: Date of document
    if (!documentDate) {
      const err = new Error("Date of document is required.");
      err.statusCode = 400;
      throw err;
    }

    const parsedDate = new Date(documentDate);
    if (isNaN(parsedDate.getTime())) {
      const err = new Error(
        "Invalid Date of document format. Please provide a valid date string (e.g. YYYY-MM-DD).",
      );
      err.statusCode = 400;
      throw err;
    }

    // 5. Generate collision-resistant unique filename for OneDrive storage
    const timestampPrefix = Date.now();
    const sanitizedOriginalName = (file.originalname || "document.bin").replace(
      /\s+/g,
      "_",
    );
    const oneDriveTargetFileName = `${timestampPrefix}_${sanitizedOriginalName}`;

    logger.info(
      `📤 Uploading '${file.originalname}' (${file.size} bytes) to Microsoft OneDrive folder...`
    );

    // 7. Upload to Microsoft OneDrive
    const onedriveResult = await onedriveService.uploadFileToOneDrive({
      fileName: oneDriveTargetFileName,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    logger.info(
      `✅ File uploaded to OneDrive with item ID: ${onedriveResult.id}`
    );

    // 8. Persist metadata to PostgreSQL document_details table
    const documentRecord = await documentRepository.createDocument({
      documentName: documentName.trim(),
      documentType: finalDocumentType,
      fileSize: file.size,
      fileType: file.mimetype || "application/octet-stream",
      documentDate: parsedDate,
      oneDriveItemId: onedriveResult.id,
      oneDriveWebUrl: onedriveResult.webUrl,
      oneDriveDownloadUrl: onedriveResult.downloadUrl,
      originalFileName: file.originalname,
      uploadedBy: user?.UserId || null,
    });

    return documentRecord;
  }
  async getAllDocuments(options = {}) {
    return documentRepository.getAllActiveDocuments(options);
  }
  async getDocumentCounts(userId) {
    return documentRepository.getDocumentCounts({ uploadedBy: userId });
  }
  async filterDocuments(query = {}) {
    return documentRepository.findWithFilters(query);
  }
  async getDocumentById(id, userId = null, userRole = null) {
    const doc = await documentRepository.findById(id);
    if (!doc) {
      const err = new Error(`Document with ID '${id}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    // If user is Admin, they have full access to view any active document
    // If user is regular User, ensure they can only view documents they uploaded
    if (userRole !== Role.ADMIN && userId && doc.uploadedBy && doc.uploadedBy !== userId) {
      const err = new Error(
        "Access denied. You do not have permission to view this document.",
      );
      err.statusCode = 403;
      throw err;
    }

    return doc;
  }
  async getDocumentFileStream(id, userId = null, userRole = null) {
    const doc = await this.getDocumentById(id, userId, userRole);

    try {
      const { stream, contentType, contentLength } =
        await onedriveService.getFileStreamFromOneDrive(doc.oneDriveItemId);

      return {
        stream,
        doc,
        contentType: contentType || doc.fileType,
        contentLength: contentLength || doc.fileSize,
      };
    } catch (error) {
      if (error.statusCode) throw error;
      logger.error(
        `Failed to fetch file stream from OneDrive for document ${id}: ${error.message}`
      );
      const err = new Error(
        "Unable to retrieve file content from Microsoft OneDrive.",
      );
      err.statusCode = 502;
      throw err;
    }
  }

  /**
   * Soft delete a document and remove its physical file from Microsoft OneDrive
   * @param {string} id - Document UUID
   * @param {string|null} userId - Optional authenticated user ID to verify ownership
   * @param {string|null} userRole - Optional role (Admin can delete any document)
   * @returns {Promise<object>} Soft-deleted document record
   */
  async softDeleteDocument(id, userId = null, userRole = null) {
    // 1. Fetch document to verify existence and user ownership (Admin bypasses ownership restriction)
    const doc = await this.getDocumentById(id, userId, userRole);

    // 2. Permanently remove physical file from Microsoft OneDrive
    if (doc.oneDriveItemId) {
      try {
        await onedriveService.deleteFileFromOneDrive(doc.oneDriveItemId);
        logger.info(
          `🗑️ Deleted file from OneDrive: ${doc.oneDriveItemId} (${doc.originalFileName || doc.documentName})`
        );
      } catch (oneDriveErr) {
        logger.warn(
          `[OneDrive Warning]: Could not delete file ${doc.oneDriveItemId}: ${oneDriveErr.message}`
        );
      }
    }

    // 3. Mark document as soft-deleted in database
    const deleted = await documentRepository.softDelete(id);
    if (!deleted) {
      const err = new Error(
        `Document with ID '${id}' not found or already deleted.`,
      );
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
   * @param {string|null} userRole - Optional authenticated user role
   * @returns {Promise<object>} Summary of bulk soft deletion
   */
  async bulkSoftDeleteDocuments(inputIds, userId = null, userRole = null) {
    if (!inputIds || !Array.isArray(inputIds) || inputIds.length === 0) {
      const err = new Error(
        'Please provide a non-empty array of document IDs to delete (e.g. { "ids": ["id1", "id2"] }).',
      );
      err.statusCode = 400;
      throw err;
    }

    // Clean, trim, and deduplicate IDs
    const cleanedIds = [
      ...new Set(
        inputIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter((id) => Boolean(id)),
      ),
    ];

    if (cleanedIds.length === 0) {
      const err = new Error("No valid document IDs provided in array.");
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
      // If user is Admin, allow deleting across any document by passing null as owner filter
      const targetOwnerId = userRole === Role.ADMIN ? null : userId;
      updatedDocuments = await documentRepository.bulkSoftDelete(
        validUuidIds,
        targetOwnerId,
      );

      // Permanently remove physical files from Microsoft OneDrive for successfully soft-deleted documents
      if (updatedDocuments.length > 0) {
        await Promise.allSettled(
          updatedDocuments.map(async (doc) => {
            console.log("DOCUMENT DATA===", doc);

            if (doc.oneDriveItemId) {
              try {
                await onedriveService.deleteFileFromOneDrive(
                  doc.oneDriveItemId,
                );
                logger.info(
                  `🗑️ Deleted OneDrive file in bulk: ${doc.oneDriveItemId}`
                );
              } catch (err) {
                logger.warn(
                  `[OneDrive Warning]: Could not delete OneDrive item ${doc.oneDriveItemId}: ${err.message}`
                );
              }
            }
          }),
        );
      }
    }

    const deletedIds = updatedDocuments.map((doc) => doc.id);
    const deletedIdSet = new Set(deletedIds);

    // Any ID that was requested but not returned in updated records was either:
    // 1) Not in DB, 2) Already soft-deleted (softDelete = true), or 3) Invalid UUID format
    const notFoundOrAlreadyDeleted = cleanedIds.filter(
      (id) => !deletedIdSet.has(id),
    );

    return {
      totalRequested: cleanedIds.length,
      deletedCount: deletedIds.length,
      deletedIds,
      notFoundOrAlreadyDeleted,
      documents: updatedDocuments,
    };
  }

  /**
   * Share an individual document with the CA via Google Drive
   * 
   * 1. Validates document exists and requesting user has access
   * 2. Checks if document is already shared with CA (idempotent)
   * 3. Ensures company Google Drive is connected
   * 4. Ensures CA shared folder exists in Google Drive
   * 5. Streams document content from Microsoft OneDrive
   * 6. Uploads invoice PDF directly to Google Drive CA folder
   * 7. Records share event in database
   * 
   * @param {string} documentId - Document UUID
   * @param {string|null} userId - Authenticated user ID
   * @param {string|null} userRole - Authenticated user role
   * @returns {Promise<object>} Share details with document object
   */
  async shareDocumentWithCa(documentId, userId = null, userRole = null) {
    if (!documentId) {
      const err = new Error("Document ID is required.");
      err.statusCode = 400;
      throw err;
    }

    if (!UUID_REGEX.test(documentId)) {
      const err = new Error(`Invalid document ID format '${documentId}'. Must be a valid UUID.`);
      err.statusCode = 400;
      throw err;
    }

    // 1. Fetch document and verify user access
    const doc = await this.getDocumentById(documentId, userId, userRole);

    // 2. Check if already shared with CA (Idempotent return)
    const existingShare = await documentCaShareRepository.findByDocumentId(documentId);
    if (existingShare) {
      return {
        alreadyShared: true,
        message: "This document has already been shared with the CA.",
        share: existingShare,
        document: {
          ...doc,
          isSharedWithCa: true,
          sharedWithCaAt: existingShare.sharedAt,
          googleDriveFileId: existingShare.googleDriveFileId,
          googleDriveViewUrl: existingShare.googleDriveWebViewLink,
        },
      };
    }

    // 3. Verify company Google Drive connection
    const googleConfig = await googleConfigRepository.getActiveConfig();
    if (!googleConfig || !googleConfig.isConnected) {
      const err = new Error("Company Google Drive is not connected. Please connect Google Drive in the Profile screen first.");
      err.statusCode = 400;
      throw err;
    }

    // 4. Obtain valid Google access token
    const accessToken = await googledriveService.getValidAccessToken();

    // 5. Ensure CA folder exists and is shared with CA
    const folderId = await googledriveService.ensureCaFolderExists({
      accessToken,
      existingFolderId: googleConfig.targetFolderId,
      caEmail: googleConfig.caEmail,
    });

    if (folderId && folderId !== googleConfig.targetFolderId) {
      await googleConfigRepository.updateFolderId(googleConfig.id, folderId);
    }

    // 6. Fetch file stream from Microsoft OneDrive
    const { stream, contentType } = await this.getDocumentFileStream(documentId, userId, userRole);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    // 7. Sanitize and prepare file name
    let targetFileName = doc.originalFileName || `${doc.documentName || 'invoice'}.pdf`;
    if (
      !targetFileName.toLowerCase().endsWith('.pdf') &&
      (contentType === 'application/pdf' || (doc.fileType && doc.fileType.includes('pdf')))
    ) {
      targetFileName = `${targetFileName}.pdf`;
    }

    // 8. Upload PDF to target Google Drive folder
    const uploadedFile = await googledriveService.uploadFileToFolder({
      accessToken,
      folderId,
      fileName: targetFileName,
      mimeType: contentType || 'application/pdf',
      buffer: fileBuffer,
    });

    logger.info(`📤 Uploaded invoice '${targetFileName}' to Google Drive (ID: ${uploadedFile.id})`);

    // 9. Record share in database
    const shareRecord = await documentCaShareRepository.createShare({
      documentId: doc.id,
      googleDriveFileId: uploadedFile.id,
      googleDriveWebViewLink: uploadedFile.webViewLink,
      caEmail: googleConfig.caEmail,
      sharedByUserId: userId || null,
    });

    return {
      alreadyShared: false,
      message: "Document shared with CA successfully.",
      share: shareRecord,
      document: {
        ...doc,
        isSharedWithCa: true,
        sharedWithCaAt: shareRecord.sharedAt,
        googleDriveFileId: shareRecord.googleDriveFileId,
        googleDriveViewUrl: shareRecord.googleDriveWebViewLink,
      },
    };
  }
}

module.exports = new DocumentService();
