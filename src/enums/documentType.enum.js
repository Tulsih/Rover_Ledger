/**
 * Application Document Type Enum
 * Standard document types allowed in Rover Ledger: INCOME = 'income', EXPENSE = 'expense'
 */
const DocumentType = Object.freeze({
  INCOME: 'income',
  EXPENSE: 'expense',
});

/**
 * Valid document types array extracted dynamically via Object.values()
 */
const DOCUMENT_TYPES = Object.freeze(Object.values(DocumentType));

const isValidDocumentType = (type) => {
  if (typeof type !== 'string') return false;
  return DOCUMENT_TYPES.includes(type.trim().toLowerCase());
};

module.exports = {
  DocumentType,
  DOCUMENT_TYPES,
  isValidDocumentType,
};

