const { pgTable, uuid, varchar, boolean, timestamp } = require('drizzle-orm/pg-core');
const { RoverLedgers } = require('./user.model');

/**
 * RefreshTokens Table Schema
 * Stores hashed refresh tokens to enable secure token rotation and session revocation
 */
const RefreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('userId')
    .references(() => RoverLedgers.UserId, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: varchar('tokenHash', { length: 255 }).notNull().unique(),
  deviceInfo: varchar('deviceInfo', { length: 255 }),
  ipAddress: varchar('ipAddress', { length: 100 }),
  isRevoked: boolean('isRevoked').default(false).notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
});

module.exports = {
  RefreshTokens,
};

