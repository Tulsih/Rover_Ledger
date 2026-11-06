const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { env } = require('./configs/env');
const schema = require('./models');

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
  console.error('[Database Pool Error]:', err.message);
});

/**
 * Initialize Drizzle ORM with connection pool and schema
 */
const db = drizzle(pool, { schema });

/**
 * Automatically ensures company_google_configs and document_ca_shares tables exist in PostgreSQL
 */
const ensureGoogleTablesExist = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_google_configs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "googleEmail" VARCHAR(255) NOT NULL,
        "encryptedRefreshToken" TEXT NOT NULL,
        "targetFolderId" VARCHAR(255),
        "caEmail" VARCHAR(255) NOT NULL,
        "isConnected" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS document_ca_shares (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "documentId" UUID NOT NULL REFERENCES document_details(id) ON DELETE CASCADE,
        "googleDriveFileId" VARCHAR(255) NOT NULL,
        "googleDriveWebViewLink" TEXT,
        "caEmail" VARCHAR(255) NOT NULL,
        "sharedByUserId" UUID,
        "sharedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE document_ca_shares ALTER COLUMN "sharedByUserId" DROP NOT NULL;
    `);
    console.log('✅ Google Drive integration tables verified in PostgreSQL.');
  } catch (error) {
    console.error('[Google Tables Init Error]:', error.message);
  }
};

/**
 * Helper to test database connection health
 */
const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL database connected successfully to:', env.dbName);
    client.release();
    await ensureGoogleTablesExist();
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
  ensureGoogleTablesExist,
};
