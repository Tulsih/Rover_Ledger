/**
 * Mock Authentication Utility
 * 
 * Provides mock profiles for local development and automated integration tests
 * (e.g. Swagger UI testing and end-to-end test suites without a live Microsoft Azure session).
 * Strictly gated behind `env.enableMockLogin` to prevent unauthorized access in production.
 */

const MOCK_CODES = [
  'dummy_code',
  'dummy',
  'shraddha',
  'shraddha_chauhan',
  'test_code',
  'demo',
  'admin',
  'admin_code',
  'user',
  'employee',
  'regular_user',
];

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
  const normalized = (code || '').trim().toLowerCase();

  if (normalized === 'admin' || normalized === 'admin_code') {
    return {
      firstName: 'Rover',
      lastName: 'Admin',
      fullName: 'Rover Ledger Admin',
      email: 'admin@roverledger.com',
      designation: 'System Administrator',
      gender: 'Other',
    };
  }

  if (normalized === 'user' || normalized === 'employee' || normalized === 'regular_user') {
    return {
      firstName: 'Standard',
      lastName: 'Employee',
      fullName: 'Standard Employee',
      email: 'employee@roverledger.com',
      designation: 'Staff Accountant',
      gender: 'Other',
    };
  }

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

