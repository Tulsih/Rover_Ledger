const { pgTable, uuid, varchar, text, timestamp, boolean } = require('drizzle-orm/pg-core');

/**
 * CompanyGoogleConfigs Table Schema
 * Stores the single company-wide Google Drive OAuth connection,
 * encrypted refresh token, CA email, and shared target folder ID.
 */
const CompanyGoogleConfigs = pgTable('company_google_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleEmail: varchar('googleEmail', { length: 255 }).notNull(),
  encryptedRefreshToken: text('encryptedRefreshToken').notNull(),
  targetFolderId: varchar('targetFolderId', { length: 255 }),
  caEmail: varchar('caEmail', { length: 255 }).notNull(),
  isConnected: boolean('isConnected').default(true).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

module.exports = {
  CompanyGoogleConfigs,
};

