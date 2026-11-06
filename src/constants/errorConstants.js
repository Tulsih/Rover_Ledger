const errorConstants = {
  INVALID_TOKEN: 'Invalid authentication token.',
  INVALID_REFRESH_TOKEN: 'Invalid refresh token.',
  MISSING_AUTH_HEADER: 'Missing or invalid authorization header.',
  TOKEN_EXPIRED: 'Authentication token has expired. Please refresh your token.',
  REFRESH_TOKEN_EXPIRED: 'Refresh token has expired. Please login again.',
  TOKEN_REUSE_DETECTED: 'Security Alert: Refresh token has been reused. All active sessions have been terminated.',
  UNAUTHORIZED: 'Unauthorized access.',
};

module.exports = { errorConstants };

