const documentService = require('../services/document.service');
const { sendSuccess, sendError } = require('../utils/response.util');
const { Role } = require('../enums');

/**
 * Document Controller
 * Handles HTTP requests for uploading, fetching, filtering, downloading, and soft-deleting documents.
 */
/**
 * Helper to pipe file stream to HTTP response with standard headers
 */
const pipeFileStream = (res, { stream, doc, contentType, contentLength, inline = false }) => {
  const filename = doc.originalFileName || `${doc.documentName}.bin`;
  const disposition = inline ? 'inline' : 'attachment';

  res.setHeader('Content-Type', contentType || doc.fileType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);
  if (contentLength) res.setHeader('Content-Length', contentLength);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  stream.on('error', (streamErr) => {
    console.error('[Document Stream Error]:', streamErr.message);
    if (!res.headersSent) sendError(res, 502, 'Failed streaming file content from Microsoft OneDrive');
  });

  return stream.pipe(res);
};

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
   * Fetch All Active Documents
   * GET /documents
   * - Role.USER: Returns only active documents uploaded by the authenticated user.
   * - Role.ADMIN: Returns all active documents across all users (softDelete = false).
   *               Admin can optionally pass ?uploadedBy=<userId> to filter by a specific user.
   */
  async getAllDocuments(req, res, next) {
    try {
      const user = req.user;
      if (!user?.UserId) {
        return sendError(res, 401, 'Access denied. Please provide a valid Authorization Bearer token.');
      }

      const isAdmin = user.Role === Role.ADMIN;
      // Admin sees all active documents across all users by default; User sees only their own
      const uploadedBy = isAdmin ? (req.query?.uploadedBy || null) : user.UserId;

      const options = {
        uploadedBy,
        page: req.query?.page,
        limit: req.query?.limit,
        sortBy: req.query?.sortBy,
        order: req.query?.order,
        isSharedWithCa: req.query?.isSharedWithCa ?? req.query?.isShareWithCa,
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
   * Fetch Document Counts
   * GET /documents/counts (or GET /documents/count)
   * - Role.USER: Scoped to the authenticated user's uploaded documents.
   * - Role.ADMIN: Returns global counts across all users (or for specific user if ?uploadedBy is provided).
   */
  async getDocumentCounts(req, res, next) {
    try {
      const user = req.user;
      if (!user?.UserId) {
        return sendError(res, 401, 'Access denied. Please provide a valid Authorization Bearer token.');
      }

      const isAdmin = user.Role === Role.ADMIN;
      const targetUserId = isAdmin ? (req.query?.uploadedBy || null) : user.UserId;

      const counts = await documentService.getDocumentCounts(targetUserId);
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
   * - Role.USER: Filter is strictly restricted to documents uploaded by this user.
   * - Role.ADMIN: Admin can query across all users' documents (where softDelete = false),
   *               or filter by a specific uploadedBy if provided in body.
   */
  async filterDocuments(req, res, next) {
    try {
      // Must contain only req body not query
      const filterParams = { ...(req.body || {}) };
      const user = req.user;

      if (user?.Role === Role.ADMIN) {
        // Admin: allow querying across all active documents unless explicitly filtered by uploadedBy
        if (!filterParams.uploadedBy) {
          delete filterParams.uploadedBy;
        }
      } else {
        // Regular User: strictly restrict filter to this authenticated user
        if (user?.UserId) {
          filterParams.uploadedBy = user.UserId;
        }
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
   * Admin can view any document; regular User can only view their own
   */
  async getDocumentById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.UserId || null;
      const userRole = req.user?.Role || null;
      const doc = await documentService.getDocumentById(id, userId, userRole);
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
      const fileData = await documentService.getDocumentFileStream(req.params.id, req.user?.UserId, req.user?.Role);
      return pipeFileStream(res, { ...fileData, inline: true });
    } catch (error) {
      console.error('[DocumentController.getDocumentContent Error]:', error.message);
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  /**
   * Download / Stream Document File Content from OneDrive
   * GET /documents/:id/download (and GET /documents/:id/file)
   * Can fetch based on authtoken
   */
  async downloadDocument(req, res, next) {
    try {
      const isInline = String(req.query.inline || '').toLowerCase() === 'true';
      const fileData = await documentService.getDocumentFileStream(req.params.id, req.user?.UserId, req.user?.Role);
      return pipeFileStream(res, { ...fileData, inline: isInline });
    } catch (error) {
      console.error('[DocumentController.downloadDocument Error]:', error.message);
      return sendError(res, error.statusCode || 500, error.message);
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
      const userRole = req.user?.Role || null;
      const deletedDoc = await documentService.softDeleteDocument(id, userId, userRole);
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
      const userRole = req.user?.Role || null;
      const result = await documentService.bulkSoftDeleteDocuments(ids, userId, userRole);

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
      const userRole = req.user?.Role || null;

      const result = await documentService.shareDocumentWithCa(documentId, userId, userRole);

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
