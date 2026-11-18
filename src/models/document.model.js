const { pgTable, uuid, varchar, boolean, timestamp, text, bigint, index } = require('drizzle-orm/pg-core');
const { RoverLedgers } = require('./user.model');

/**
 * DocumentDetails Table Schema
 * Stores metadata of all documents and invoices uploaded to Rover Ledger and synced to Microsoft OneDrive
 */
const DocumentDetails = pgTable('document_details', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentName: varchar('documentName', { length: 255 }).notNull(),
  documentType: varchar('documentType', { length: 50 }), // optional: 'income', 'expense', or null
  fileSize: bigint('fileSize', { mode: 'number' }).notNull(), // size in bytes
  fileType: varchar('fileType', { length: 100 }).notNull(), // MIME type (application/pdf)
  documentDate: timestamp('documentDate').notNull(), // Date of document entered by user
  softDelete: boolean('softDelete').default(false).notNull(), // soft delete flag
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),

  // Microsoft OneDrive / SharePoint tracking fields
  oneDriveItemId: varchar('oneDriveItemId', { length: 255 }).notNull(),
  oneDriveWebUrl: text('oneDriveWebUrl'),
  oneDriveDownloadUrl: text('oneDriveDownloadUrl'),
  originalFileName: varchar('originalFileName', { length: 255 }).notNull(),

  // User association (authenticated user who uploaded) with database-level CASCADE deletion
  uploadedBy: uuid('uploadedBy').references(() => RoverLedgers.UserId, { onDelete: 'cascade' }),
}, (table) => [
  index('idx_document_details_uploaded_by').on(table.uploadedBy),
  index('idx_document_details_soft_delete_uploaded_by').on(table.softDelete, table.uploadedBy),
  index('idx_document_details_soft_delete_created_at').on(table.softDelete, table.createdAt),
  index('idx_document_details_document_date').on(table.documentDate),
]);

module.exports = {
  DocumentDetails,
};
