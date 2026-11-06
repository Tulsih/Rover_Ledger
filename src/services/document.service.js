const documentRepository = require("../repositories/document.repository");
const documentCaShareRepository = require("../repositories/documentCaShare.repository");
const googleConfigRepository = require("../repositories/googleConfig.repository");
const onedriveService = require("./onedrive.service");
const googledriveService = require("./googledrive.service");

// Allowed document types specified by user
const ALLOWED_DOCUMENT_TYPES = ["income", "expense"];

// Standard UUID format validator (36-character hex with hyphens)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Document Service
 * Orchestrates business logic, validations, Microsoft OneDrive interactions, and database persistence.
 */
class DocumentService {
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
    // 3. Validation: documentType ('income', 'expense', or null/optional)
    let finalDocumentType = null;
    if (
      documentType !== undefined &&
      documentType !== null &&
      documentType !== ""
    ) {
      if (typeof documentType !== "string") {
        const err = new Error(
          "Invalid document type. Allowed values are 'income', 'expense', or null.",
        );
        err.statusCode = 400;
        throw err;
      }
      const normalizedType = documentType.trim().toLowerCase();
      if (
        normalizedType === "null" ||
        normalizedType === "none" ||
        normalizedType === "undefined" ||
        normalizedType === ""
      ) {
        finalDocumentType = null;
      } else if (normalizedType === "income") {
        finalDocumentType = "income";
      } else if (normalizedType === "expense" || normalizedType === "expence") {
        finalDocumentType = "expense";
      } else {
        const err = new Error(
          `Invalid document type '${documentType}'. Allowed values are 'income', 'expense', or null.`,
        );
        err.statusCode = 400;
        throw err;
      }
    }

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

    console.log(
      `📤 Uploading '${file.originalname}' (${file.size} bytes) to Microsoft OneDrive folder...`,
    );

    // 7. Upload to Microsoft OneDrive
    const onedriveResult = await onedriveService.uploadFileToOneDrive({
      fileName: oneDriveTargetFileName,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    console.log(
      `✅ File uploaded to OneDrive with item ID: ${onedriveResult.id}`,
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
  async getDocumentById(id, userId = null) {
    const doc = await documentRepository.findById(id);
    if (!doc) {
      const err = new Error(`Document with ID '${id}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    // If document is owned by a user and requesting user does not match, deny access
    if (userId && doc.uploadedBy && doc.uploadedBy !== userId) {
      const err = new Error(
        "Access denied. You do not have permission to view this document.",
      );
      err.statusCode = 403;
      throw err;
    }

    return doc;
  }
  async getDocumentFileStream(id, userId = null) {
    const doc = await this.getDocumentById(id, userId);

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
      console.error(
        `Failed to fetch file stream from OneDrive for document ${id}:`,
        error.message,
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
   * @returns {Promise<object>} Soft-deleted document record
   */
  async softDeleteDocument(id, userId = null) {
    // 1. Fetch document to verify existence and user ownership
    const doc = await this.getDocumentById(id, userId);

    // 2. Permanently remove physical file from Microsoft OneDrive
    if (doc.oneDriveItemId) {
      try {
        await onedriveService.deleteFileFromOneDrive(doc.oneDriveItemId);
        console.log(
          `🗑️ Deleted file from OneDrive: ${doc.oneDriveItemId} (${doc.originalFileName || doc.documentName})`,
        );
      } catch (oneDriveErr) {
        console.warn(
          `[OneDrive Warning]: Could not delete file ${doc.oneDriveItemId}:`,
          oneDriveErr.message,
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
   * @returns {Promise<object>} Summary of bulk soft deletion
   */
  async bulkSoftDeleteDocuments(inputIds, userId = null) {
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
      updatedDocuments = await documentRepository.bulkSoftDelete(
        validUuidIds,
        userId,
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
                console.log(
                  `🗑️ Deleted OneDrive file in bulk: ${doc.oneDriveItemId}`,
                );
              } catch (err) {
                console.warn(
                  `[OneDrive Warning]: Could not delete OneDrive item ${doc.oneDriveItemId}:`,
                  err.message,
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
   * @returns {Promise<object>} Share details with document object
   */
  async shareDocumentWithCa(documentId, userId = null) {
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
    const doc = await this.getDocumentById(documentId, userId);

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
    const { stream, contentType } = await this.getDocumentFileStream(documentId, userId);
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

    console.log(`📤 Uploaded invoice '${targetFileName}' to Google Drive (ID: ${uploadedFile.id})`);

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
