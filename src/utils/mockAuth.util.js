/**
 * Mock Authentication Utility
 * 
 * Provides mock profiles for local development and automated integration tests
 * (e.g. Swagger UI testing and end-to-end test suites without a live Microsoft Azure session).
 * Strictly gated behind `env.enableMockLogin` to prevent unauthorized access in production.
 */

const MOCK_CODES = ['dummy_code', 'dummy', 'shraddha', 'shraddha_chauhan', 'test_code', 'demo'];

/**
 * Check if the provided code matches a recognized development mock code
 * @param {string} code
 * @returns {boolean}
 */
const isMockAuthCode = (code) => {
  if (!code || typeof code !== 'string') return false;
  return MOCK_CODES.includes(code.trim().toLowerCase());
};

/**
 * Generate mock user profile for testing
 * @param {string} code
 * @returns {object} Mock profile
 */
const getMockUserProfile = (code) => {
  return {
    firstName: 'Shraddha',
    lastName: 'Chauhan',
    fullName: 'Shraddha Chauhan',
    email: 'shraddha.chauhan@roverledger.com',
    designation: 'Software Engineer',
    gender: 'Female',
  };
};

module.exports = {
  isMockAuthCode,
  getMockUserProfile,
};

