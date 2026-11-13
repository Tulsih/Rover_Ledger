const { sendError } = require('../utils/response.util');
const logger = require('../utils/logger.util');

/**
 * Global Error Handling Middleware
 * 
 * Catches any unhandled exceptions throughout the application lifecycle
 * and returns a standard JSON error response instead of crashing.
 */
const errorHandler = (err, req, res, next) => {
  logger.error({ err }, '[Unhandled Error]: ' + err.message);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  return sendError(res, statusCode, message, process.env.NODE_ENV === 'development' ? err.stack : undefined);
};

/**
 * 404 Route Not Found Middleware
 */
const notFoundHandler = (req, res) => {
  return sendError(res, 404, `Route ${req.method} ${req.originalUrl} not found`);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
