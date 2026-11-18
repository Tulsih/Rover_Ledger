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
 * Automatically ensures company_google_configs and document_ca_shares tables and unique indexes exist
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_document_ca_shares_unique_doc ON document_ca_shares ("documentId");
    `);
    logger.info('✅ Google Drive integration tables & unique index verified in PostgreSQL.');
  } catch (error) {
    logger.error({ error }, '[Google Tables Init Error]: ' + error.message);
  }
};

/**
 * Automatically ensures performance indexes exist on document_details table
 */
const ensurePerformanceIndexesExist = async () => {
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_document_details_uploaded_by ON document_details ("uploadedBy");
      CREATE INDEX IF NOT EXISTS idx_document_details_soft_delete_uploaded_by ON document_details ("softDelete", "uploadedBy");
      CREATE INDEX IF NOT EXISTS idx_document_details_soft_delete_created_at ON document_details ("softDelete", "createdAt");
      CREATE INDEX IF NOT EXISTS idx_document_details_document_date ON document_details ("documentDate");
    `);
    logger.info('✅ Performance indexes on document_details verified in PostgreSQL.');
  } catch (error) {
    logger.error({ error }, '[Performance Indexes Init Error]: ' + error.message);
  }
};

/**
 * Automatically ensures database-level foreign key constraints exist with CASCADE deletion
 */
const ensureForeignKeyConstraintsExist = async () => {
  try {
    const checkRes = await pool.query(`
      SELECT conname FROM pg_constraint 
      WHERE conname = 'fk_document_details_uploaded_by';
    `);

    if (checkRes.rows.length === 0) {
      // Clean up any potential orphaned records before adding foreign key constraint
      await pool.query(`
        UPDATE document_details 
        SET "uploadedBy" = NULL 
        WHERE "uploadedBy" IS NOT NULL 
          AND "uploadedBy" NOT IN (SELECT "UserId" FROM "Rover_ledgers");
      `);

      // Add foreign key constraint with ON DELETE CASCADE
      await pool.query(`
        ALTER TABLE document_details
        ADD CONSTRAINT fk_document_details_uploaded_by
        FOREIGN KEY ("uploadedBy")
        REFERENCES "Rover_ledgers"("UserId")
        ON DELETE CASCADE;
      `);
      logger.info('✅ Foreign key constraint fk_document_details_uploaded_by (ON DELETE CASCADE) added to PostgreSQL.');
    } else {
      logger.info('✅ Foreign key constraint fk_document_details_uploaded_by (ON DELETE CASCADE) verified in PostgreSQL.');
    }
  } catch (error) {
    logger.error({ error }, '[Foreign Key Init Error]: ' + error.message);
  }
};

/**
 * Helper to test database connection health
 */
const testConnection = async () => {
  try {
    const client = await pool.connect();
    logger.info(`✅ PostgreSQL database connected successfully to: ${env.dbName}`);
    client.release();
    await ensureGoogleTablesExist();
    await ensurePerformanceIndexesExist();
    await ensureForeignKeyConstraintsExist();
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
  ensureGoogleTablesExist,
  ensurePerformanceIndexesExist,
  ensureForeignKeyConstraintsExist,
};
