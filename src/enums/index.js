const {
  Role,
  ROLES,
  isValidRole,
  DEFAULT_ADMIN_EMAILS,
  determineUserRole,
} = require('./role.enum');
const { DocumentType, DOCUMENT_TYPES, isValidDocumentType } = require('./documentType.enum');

module.exports = {
  Role,
  ROLES,
  isValidRole,
  DEFAULT_ADMIN_EMAILS,
  determineUserRole,
  DocumentType,
  DOCUMENT_TYPES,
  isValidDocumentType,
};
