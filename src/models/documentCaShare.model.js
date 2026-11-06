const { pgTable, uuid, varchar, text, timestamp } = require('drizzle-orm/pg-core');
const { DocumentDetails } = require('./document.model');

/**
 * DocumentCaShares Table Schema
 * Tracks invoices shared to Chartered Accountant (CA) Google Drive folder,
 * preventing duplicate uploads and providing share history.
 */
const DocumentCaShares = pgTable('document_ca_shares', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('documentId')
    .references(() => DocumentDetails.id, { onDelete: 'cascade' })
    .notNull(),
  googleDriveFileId: varchar('googleDriveFileId', { length: 255 }).notNull(),
  googleDriveWebViewLink: text('googleDriveWebViewLink'),
  caEmail: varchar('caEmail', { length: 255 }).notNull(),
  sharedByUserId: uuid('sharedByUserId'),
  sharedAt: timestamp('sharedAt').defaultNow().notNull(),
});

module.exports = {
  DocumentCaShares,
};
