const multer = require('multer');
const { sendError } = require('../utils/response.util');

// Use MemoryStorage so the file buffer is streamed directly to OneDrive without disk I/O
const storage = multer.memoryStorage();

// Max file size: 50 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

/**
 * Flexible file upload middleware supporting field names: 'file', 'document', or 'image'
 */
const uploadDocumentFile = (req, res, next) => {
  // Support 'file', 'document', or 'image' as the upload field name
  const uploadHandler = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);

  uploadHandler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 400, `File size exceeds the 50MB limit.`);
      }
      return sendError(res, 400, `File upload error: ${err.message}`);
    } else if (err) {
      return sendError(res, 400, `Upload failed: ${err.message}`);
    }

    // Normalize attached file to `req.file`
    if (req.files) {
      if (req.files['file'] && req.files['file'][0]) {
        req.file = req.files['file'][0];
      } else if (req.files['document'] && req.files['document'][0]) {
        req.file = req.files['document'][0];
      } else if (req.files['image'] && req.files['image'][0]) {
        req.file = req.files['image'][0];
      }
    }

    next();
  });
};

module.exports = {
  uploadDocumentFile,
};
