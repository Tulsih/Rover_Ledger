require('dotenv').config();
const { defineConfig } = require('drizzle-kit');

/**
 * Drizzle Kit Configuration
 * Used for migration generation (`npm run Db:generate`)
 * and direct schema push to database (`npm run db:push`)
 */
module.exports = defineConfig({
  schema: './src/models/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  },
  verbose: true,
  strict: false,
});
