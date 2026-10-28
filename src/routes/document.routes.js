const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { uploadDocumentFile } = require('../middlewares/upload.middleware');
const { optionalAuth } = require('../middlewares/auth.middleware');

/**
 * Document Management Routes
 * Base mount point: /documents
 */

// 1. Upload document / image to Microsoft OneDrive and save details to DB
router.post(
  '/upload',
  optionalAuth,
  uploadDocumentFile,
  documentController.uploadDocument.bind(documentController)
);

// Alias: POST /documents
router.post(
  '/',
  optionalAuth,
  uploadDocumentFile,
  documentController.uploadDocument.bind(documentController)
);

// 2. Filter documents (accepts only req.body, supports authtoken scoping)
router.post(
  '/filter',
  optionalAuth,
  documentController.filterDocuments.bind(documentController)
);

// GET /filter alias reading req.body
router.get(
  '/filter',
  optionalAuth,
  documentController.filterDocuments.bind(documentController)
);

// 3. Fetch all documents (supports query filters, pagination, and authtoken scoping)
router.get(
  '/',
  optionalAuth,
  documentController.getAllDocuments.bind(documentController)
);

// 4. Download / stream document binary file content from OneDrive
router.get(
  '/:id/download',
  optionalAuth,
  documentController.downloadDocument.bind(documentController)
);

// Alias: GET /documents/:id/file
router.get(
  '/:id/file',
  optionalAuth,
  documentController.downloadDocument.bind(documentController)
);

// 5. Fetch single document details by ID (supports authtoken check)
router.get(
  '/:id',
  optionalAuth,
  documentController.getDocumentById.bind(documentController)
);

// 6. Bulk soft delete documents (mounted before /:id to prevent route shadowing)
router.delete(
  '/bulk',
  optionalAuth,
  documentController.bulkSoftDeleteDocuments.bind(documentController)
);

// Alias: POST /documents/bulk-delete (for clients/environments where DELETE does not carry a body)
router.post(
  '/bulk-delete',
  optionalAuth,
  documentController.bulkSoftDeleteDocuments.bind(documentController)
);

// Alias: DELETE /documents (with request body)
router.delete(
  '/',
  optionalAuth,
  documentController.bulkSoftDeleteDocuments.bind(documentController)
);

// 7. Soft delete single document by ID (supports authtoken check)
router.delete(
  '/:id',
  optionalAuth,
  documentController.softDeleteDocument.bind(documentController)
);

module.exports = router;
