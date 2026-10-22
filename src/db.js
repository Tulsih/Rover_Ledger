const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
require('dotenv').config();

const schema = require('./models');

/**
 * Configure PostgreSQL Connection Pool
 * Supports both full connection string (DATABASE_URL) and individual config variables
 */
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || '12345'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'rover_ledger'}`,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Event listener for unexpected database errors
pool.on('error', (err) => {
  console.error('[Database Pool Error]:', err.message);
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
    console.log('✅ PostgreSQL database connected successfully to:', process.env.DB_NAME || 'rover_ledger');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

module.exports = {
  db,
  pool,
  testConnection,
};
