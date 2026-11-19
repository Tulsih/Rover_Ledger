const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { env } = require('./configs/env');
const schema = require('./models');
const logger = require('./utils/logger.util');

/**
 * Configure PostgreSQL Connection Pool
 * Supports both full connection string (DATABASE_URL) and individual config variables
 */
const pool = new Pool({
  connectionString:
    env.databaseUrl ||
    `postgresql://${env.dbUser}:${env.dbPassword}@${env.dbHost}:${env.dbPort}/${env.dbName}`,
  max: env.dbPoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Event listener for unexpected database errors
pool.on('error', (err) => {
  logger.error({ err }, '[Database Pool Error]: ' + err.message);
});

/**
 * Initialize Drizzle ORM with connection pool and schema
 */
const db = drizzle(pool, { schema });

/**
 * Helper to test database connection health
 */
const testConnection = async () => {
  try {
    const client = await pool.connect();
    logger.info(`✅ PostgreSQL database connected successfully to: ${env.dbName}`);
    client.release();
    return true;
  } catch (error) {
    logger.error({ error }, `❌ Database connection failed: ${error.message}`);
    return false;
  }
};

module.exports = {
  db,
  pool,
  testConnection,
};
