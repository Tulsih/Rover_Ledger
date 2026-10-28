const { pgTable, uuid, varchar, boolean, timestamp, text, bigint } = require('drizzle-orm/pg-core');

/**
 * DocumentDetails Table Schema
 * Stores metadata of all documents and images uploaded to Rover Ledger and synced to Microsoft OneDrive
 */
const DocumentDetails = pgTable('document_details', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentName: varchar('documentName', { length: 255 }).notNull(),
  documentType: varchar('documentType', { length: 50 }).notNull(), // 'income' or 'expense'
  fileSize: bigint('fileSize', { mode: 'number' }).notNull(), // size in bytes
  fileType: varchar('fileType', { length: 100 }).notNull(), // MIME type (e.g. image/jpeg, application/pdf)
  documentDate: timestamp('documentDate').notNull(), // Date of document entered by user
  pdfCreated: boolean('pdfCreated').default(false).notNull(), // boolean: true or false
  softDelete: boolean('softDelete').default(false).notNull(), // soft delete flag
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),

  // Microsoft OneDrive / SharePoint tracking fields
  oneDriveItemId: varchar('oneDriveItemId', { length: 255 }).notNull(),
  oneDriveWebUrl: text('oneDriveWebUrl'),
  oneDriveDownloadUrl: text('oneDriveDownloadUrl'),
  originalFileName: varchar('originalFileName', { length: 255 }).notNull(),

  // Optional user association (if uploaded in authenticated session)
  uploadedBy: uuid('uploadedBy'),
});

module.exports = {
  DocumentDetails,
};
