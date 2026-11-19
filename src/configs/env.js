require('dotenv').config();

const env = {
  port: parseInt(process.env.PORT, 10) || 3003,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database configuration (PostgreSQL)
  databaseUrl: process.env.DATABASE_URL,
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: parseInt(process.env.DB_PORT, 10) || 5432,
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD || '12345',
  dbName: process.env.DB_NAME || 'rover_ledger',
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),

  // JWT configuration
  jwtSecret: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'rover_ledger_super_secret_jwt_key_2026',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'rover_ledger_access_secret_key_2026',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'rover_ledger_refresh_secret_key_2026',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  jwtIssuer: process.env.JWT_ISSUER || undefined,
  jwtAudience: process.env.JWT_AUDIENCE || undefined,

  // Microsoft OAuth configuration (Entra ID)
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  microsoftRedirectUri: process.env.MICROSOFT_REDIRECT_URI || 'roverledger://auth',

  // Microsoft OneDrive / SharePoint storage configuration
  microsoftDriveId: process.env.MICROSOFT_DRIVE_ID,
  microsoftFolderId: process.env.MICROSOFT_FOLDER_ID,

  // Testing & Development Mock Authentication
  enableMockLogin: process.env.ENABLE_MOCK_LOGIN === 'true' || (process.env.NODE_ENV !== 'production'),

  // Designated company admin emails (comma-separated string in .env: ADMIN_EMAILS="email1,email2")
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Google OAuth & Google Drive configuration
  googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.GoogleClientId,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.googleClientSecret,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || process.env.GoogleRedirectURIs || 'http://localhost:3003/auth/google/callback',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env['Google service account email'],
  caEmailDefault: process.env.CA_EMAIL_DEFAULT || 'shraddhac734@gmail.com',
  googleTokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'rover_ledger_google_token_key_32',
};

module.exports = { env };
