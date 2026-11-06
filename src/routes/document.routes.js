const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { uploadDocumentFile } = require('../middlewares/upload.middleware');
const { authenticateToken, optionalAuth } = require('../middlewares/auth.middleware');

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

// 2. Filter documents (accepts only req.body, supports authtoken scoping)
router.post(
  '/filter',
  optionalAuth,
  documentController.filterDocuments.bind(documentController)
);

// 3. Document Counts API: Fetch all 4 counts (total, incomeInvoiceCount, expenseInvoiceCount, pdfCount)
router.get(
  '/counts',
  authenticateToken,
  documentController.getDocumentCounts.bind(documentController)
);

// 4. Fetch all active documents for authenticated user based on access token
router.get(
  '/',
  authenticateToken,
  documentController.getAllDocuments.bind(documentController)
);

// 5. Stream raw document / image content directly for PDF generator & image renderers (inline)
router.get(
  '/:id/content',
  optionalAuth,
  documentController.getDocumentContent.bind(documentController)
);

// 6. Download / stream document binary file content from OneDrive (attachment)
router.get(
  '/:id/download',
  optionalAuth,
  documentController.downloadDocument.bind(documentController)
);

// 7. Bulk soft delete documents (mounted before /:id to prevent route shadowing)
router.delete(
  '/bulk',
  optionalAuth,
  documentController.bulkSoftDeleteDocuments.bind(documentController)
);

// 8. Fetch single document details by ID (supports authtoken check)
router.get(
  '/:id',
  optionalAuth,
  documentController.getDocumentById.bind(documentController)
);

// 9. Soft delete single document by ID (supports authtoken check)
router.delete(
  '/:id',
  optionalAuth,
  documentController.softDeleteDocument.bind(documentController)
);

// 10. Share single document with CA via Google Drive
router.post(
  '/:id/share-to-ca',
  optionalAuth,
  documentController.shareToCa.bind(documentController)
);

module.exports = router;
