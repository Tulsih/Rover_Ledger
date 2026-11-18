/**
 * Application Document Type Enum
 * Standard document types allowed in Rover Ledger:
 * INCOME = 'Income', EXPENSE = 'Expense', COMBINED = 'Combined'
 */
const DocumentType = Object.freeze({
  INCOME: 'Income',
  EXPENSE: 'Expense',
  COMBINED: 'Combined',
});

/**
 * Valid document types array extracted dynamically via Object.values()
 * Returns ['Income', 'Expense', 'Combined']
 */
const DOCUMENT_TYPES = Object.freeze(Object.values(DocumentType));

/**
 * Validates if a document type string matches any supported DocumentType (case-insensitive)
 * @param {string} type
 * @returns {boolean}
 */
const isValidDocumentType = (type) => {
  if (!type || typeof type !== 'string') return false;
  const normalized = type.trim().toLowerCase();
  return DOCUMENT_TYPES.some((val) => val.toLowerCase() === normalized);
};

module.exports = {
  DocumentType,
  DOCUMENT_TYPES,
  isValidDocumentType,
};
