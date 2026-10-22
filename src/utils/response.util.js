/**
 * Standard API Response Helper
 * 
 * Ensures all API responses adhere to a consistent structure:
 * {
 *   success: true | false,
 *   message: string,
 *   data: any,
 *   error: any (optional)
 * }
 */

/**
 * Send a standardized success response
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {string} message - Human-readable success message
 * @param {any} data - Response payload
 */
const sendSuccess = (res, statusCode = 200, message = 'Success', data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send a standardized error response
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {string} message - Human-readable error message
 * @param {any} error - Detailed error information or validation errors
 */
const sendError = (res, statusCode = 500, message = 'Internal Server Error', error = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error || undefined,
  });
};

module.exports = {
  sendSuccess,
  sendError,
};
