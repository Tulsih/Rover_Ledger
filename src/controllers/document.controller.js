const documentService = require('../services/document.service');
const { sendSuccess, sendError } = require('../utils/response.util');

/**
 * Document Controller
 * Handles HTTP requests for uploading, fetching, filtering, downloading, and soft-deleting documents.
 */
class DocumentController {
  /**
   * Upload Document & Sync to Microsoft OneDrive
   * POST /documents/upload (or POST /documents)
   */
  async uploadDocument(req, res, next) {
    try {
      const file = req.file;
      const { documentName, documentType, documentDate } = req.body || {};
      const user = req.user || null;

      const createdDocument = await documentService.uploadDocument({
        file,
        documentName,
        documentType,
        documentDate,
        user,
      });

      return sendSuccess(
        res,
        201,
        'Document uploaded and synced to Microsoft OneDrive successfully',
        createdDocument
      );
    } catch (error) {
      console.error('[DocumentController.uploadDocument Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Fetch All Active Documents for the Authenticated User
   * GET /documents
   * Returns active documents list for the authenticated user without counts.
   */
  async getAllDocuments(req, res, next) {
    try {
      const userId = req.user?.UserId;
      if (!userId) {
        return sendError(res, 401, 'Access denied. Please provide a valid Authorization Bearer token.');
      }

      const options = {
        uploadedBy: userId,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        order: req.query?.order,
      };

      const result = await documentService.getAllDocuments(options);
      return sendSuccess(res, 200, 'Documents fetched successfully', result);
    } catch (error) {
      console.error('[DocumentController.getAllDocuments Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Fetch All 4 Document Counts for the Authenticated User
   * GET /documents/counts (or GET /documents/count)
   * 
   * Returns:
   * {
   *   "total": number,
   *   "incomeInvoiceCount": number,
   *   "expenseInvoiceCount": number,
   *   "pdfCount": number
   * }
   */
  async getDocumentCounts(req, res, next) {
    try {
      const userId = req.user?.UserId;
      if (!userId) {
        return sendError(res, 401, 'Access denied. Please provide a valid Authorization Bearer token.');
      }

      const counts = await documentService.getDocumentCounts(userId);
      return sendSuccess(res, 200, 'Document counts fetched successfully', counts);
    } catch (error) {
      console.error('[DocumentController.getDocumentCounts Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Filter Documents
   * POST /documents/filter
   * Must contain only req body not query, and can scope based on authtoken
   */
  async filterDocuments(req, res, next) {
    try {
      // Must contain only req body not query
      const filterParams = { ...(req.body || {}) };

      // If authtoken is present, scope filter to this authenticated user
      if (req.user?.UserId) {
        filterParams.uploadedBy = req.user.UserId;
      }

      const result = await documentService.filterDocuments(filterParams);
      return sendSuccess(res, 200, 'Filtered documents fetched successfully', result);
    } catch (error) {
      console.error('[DocumentController.filterDocuments Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Get Single Document Details by ID
   * GET /documents/:id
   * Can fetch based on authtoken
   */
  async getDocumentById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.UserId || null;
      const doc = await documentService.getDocumentById(id, userId);
      return sendSuccess(res, 200, 'Document details fetched successfully', doc);
    } catch (error) {
      console.error('[DocumentController.getDocumentById Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Stream Document / Image Content directly (Raw Binary Stream for PDF Generators & Image Viewers)
   * GET /documents/:id/content
   * Headers: Authorization: Bearer <token> (also supports query param ?token=)
   * Streams image/document bytes with Content-Disposition: inline and accurate MIME Content-Type
   */
  async getDocumentContent(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.UserId || null;

      const { stream, doc, contentType, contentLength } = await documentService.getDocumentFileStream(id, userId);

      const filename = doc.originalFileName || `${doc.documentName}.bin`;

      res.setHeader('Content-Type', contentType || doc.fileType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(filename)}"`
      );
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');

      // Handle stream errors
      stream.on('error', (streamErr) => {
        console.error('[DocumentController.getDocumentContent Stream Error]:', streamErr.message);
        if (!res.headersSent) {
          sendError(res, 502, 'Failed streaming file content from Microsoft OneDrive');
        }
      });

      // Pipe OneDrive stream directly into HTTP response
      stream.pipe(res);
    } catch (error) {
      console.error('[DocumentController.getDocumentContent Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Download / Stream Document File Content from OneDrive
   * GET /documents/:id/download (and GET /documents/:id/file)
   * Can fetch based on authtoken
   */
  async downloadDocument(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.UserId || null;
      const isInline = String(req.query.inline || '').toLowerCase() === 'true';

      const { stream, doc, contentType, contentLength } = await documentService.getDocumentFileStream(id, userId);

      const filename = doc.originalFileName || `${doc.documentName}.bin`;
      const dispositionType = isInline ? 'inline' : 'attachment';

      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `${dispositionType}; filename="${encodeURIComponent(filename)}"`
      );
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // Handle stream errors
      stream.on('error', (streamErr) => {
        console.error('[File Stream Error]:', streamErr.message);
        if (!res.headersSent) {
          sendError(res, 502, 'Failed streaming file from Microsoft OneDrive');
        }
      });

      // Pipe OneDrive stream directly into HTTP response
      stream.pipe(res);
    } catch (error) {
      console.error('[DocumentController.downloadDocument Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Soft Delete Document
   * DELETE /documents/:id
   */
  async softDeleteDocument(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.UserId || null;
      const deletedDoc = await documentService.softDeleteDocument(id, userId);
      return sendSuccess(res, 200, 'Document soft deleted successfully', deletedDoc);
    } catch (error) {
      console.error('[DocumentController.softDeleteDocument Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Bulk Soft Delete Documents
   * DELETE /documents/bulk (or POST /documents/bulk-delete)
   * Accepts { ids: ["id1", "id2"] } or { documentIds: ["id1", "id2"] } or raw array ["id1", "id2"]
   */
  async bulkSoftDeleteDocuments(req, res, next) {
    try {
      let ids = req.body?.ids || req.body?.documentIds;
      if (!ids && Array.isArray(req.body)) {
        ids = req.body;
      }

      if (!ids || !Array.isArray(ids)) {
        return sendError(
          res,
          400,
          'Validation Error: Please provide an array of document IDs to delete in request body (e.g. { "ids": ["uuid1", "uuid2"] }).'
        );
      }

      const userId = req.user?.UserId || null;
      const result = await documentService.bulkSoftDeleteDocuments(ids, userId);

      return sendSuccess(
        res,
        200,
        `Bulk soft delete completed. Successfully soft deleted ${result.deletedCount} document(s).`,
        result
      );
    } catch (error) {
      console.error('[DocumentController.bulkSoftDeleteDocuments Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }

  /**
   * Share a single document with the CA via Google Drive
   * POST /documents/:id/share-to-ca
   */
  async shareToCa(req, res, next) {
    try {
      const documentId = req.params?.id;
      const userId = req.user?.UserId || null;

      const result = await documentService.shareDocumentWithCa(documentId, userId);

      return sendSuccess(
        res,
        result.alreadyShared ? 200 : 201,
        result.message,
        result
      );
    } catch (error) {
      console.error('[DocumentController.shareToCa Error]:', error.message);
      const statusCode = error.statusCode || 500;
      return sendError(res, statusCode, error.message);
    }
  }
}

module.exports = new DocumentController();
