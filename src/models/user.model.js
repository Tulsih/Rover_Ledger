const { pgTable, uuid, varchar, boolean, timestamp } = require('drizzle-orm/pg-core');

const RoverLedgers = pgTable('Rover_ledgers', {
  UserId: uuid('UserId').defaultRandom().primaryKey(),
  FirstName: varchar('FirstName', { length: 255 }),
  LastName: varchar('LastName', { length: 255 }),
  Email: varchar('Email', { length: 255 }).notNull().unique(),
  Gender: varchar('Gender', { length: 50 }),
  Role: varchar('Role', { length: 100 }).default('User').notNull(),
  CreatedAt: timestamp('CreatedAt').defaultNow().notNull(),
  UpdatedAt: timestamp('UpdatedAt').defaultNow().notNull(),
  Designation: varchar('Designation', { length: 255 }),
  FullName: varchar('FullName', { length: 255 }),
  isActive: boolean('isActive').default(true).notNull(),
  SoftDelete: boolean('SoftDelete').default(false).notNull(),
});

module.exports = {
  RoverLedgers,
};
