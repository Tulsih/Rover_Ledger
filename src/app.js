const express = require('express');
const cors = require('cors');
require('dotenv').config();

const path = require('path');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const { testConnection } = require('./db');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Load Swagger document
const swaggerDocument = YAML.load(path.join(__dirname, '../swagger.yaml'));

// ==========================================
// Middleware Configuration
// ==========================================
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger for development
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// ==========================================
// Swagger API Documentation UI
// ==========================================
const swaggerOptions = {
  customSiteTitle: 'Rover Ledger API Docs',
  customCss: '.swagger-ui .topbar { display: block; }',
};

// Mount Swagger UI on multiple friendly aliases
const swaggerPaths = [
  '/api-docs',
  '/swagger-ui',
  '/swagger',
  '/docs',
  '/rover-ledger/api-docs',
  '/rover-ledger/swagger-ui',
  '/rover-ledger/swagger',
  '/rover-ledger/docs',
];

swaggerPaths.forEach((routePath) => {
  app.use(routePath, swaggerUi.serve, (req, res, next) => {
    const isRoverLedger = req.originalUrl.includes('/rover-ledger');
    const dynamicDoc = {
      ...swaggerDocument,
      servers: isRoverLedger
        ? [
            { url: '/rover-ledger', description: 'Zrok Public Tunnel (/rover-ledger)' },
            { url: '/', description: 'Current Host (/)' },
            { url: `http://localhost:${PORT}`, description: `Localhost (Port ${PORT})` },
          ]
        : [
            { url: '/', description: 'Current Host (/)' },
            { url: `http://localhost:${PORT}`, description: `Localhost (Port ${PORT})` },
            { url: '/rover-ledger', description: 'Zrok Public Tunnel (/rover-ledger)' },
          ],
    };
    return swaggerUi.setup(dynamicDoc, swaggerOptions)(req, res, next);
  });
});

// Redirect /rover-ledger root to swagger documentation
app.get('/rover-ledger', (req, res) => {
  res.redirect('/rover-ledger/api-docs/');
});

// Serve raw YAML specification
app.get(['/swagger.yaml', '/rover-ledger/swagger.yaml'], (req, res) => {
  res.sendFile(path.join(__dirname, '../swagger.yaml'));
});

// ==========================================
// Health & Information Endpoints
// ==========================================
const rootHandler = (req, res) => {
  res.json({
    project: 'Rover Ledger API',
    status: 'Running',
    version: '1.0.0',
    documentation: {
      swaggerUI: '/docs (or /swagger-ui, /rover-ledger/docs)',
      loginWithMicrosoft: 'POST /auth/microsoft',
      getLoginUrl: 'GET /auth/microsoft',
      oauthCallback: 'GET /auth/microsoft/callback',
      profileFetch: 'GET /users/profile (Headers: Authorization: Bearer <token>)',
      profileUpdate: 'PUT /users/profile (Headers: Authorization: Bearer <token>)',
      logout: 'POST /auth/logout (Headers: Authorization: Bearer <token>)',
      uploadDocument: 'POST /documents/upload (multipart/form-data: file, documentName, documentType, documentDate, pdfCreated)',
      fetchAllDocuments: 'GET /documents (Query: page, limit, sortBy, order)',
      filterDocuments: 'GET /documents/filter (Query: documentType, documentName, startDate, endDate, pdfCreated)',
      getDocumentById: 'GET /documents/:id',
      downloadDocument: 'GET /documents/:id/download (Streams file content from OneDrive)',
      deleteDocument: 'DELETE /documents/:id (Soft delete)',
    },
  });
};

app.get('/', rootHandler);
app.get('/rover-ledger/info', rootHandler);

app.get(['/health', '/rover-ledger/health'], (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// ==========================================
// Mount API Routes (Directly at root and under /rover-ledger prefix)
// ==========================================
app.use('/', routes);
app.use('/rover-ledger', routes);

// ==========================================
// 404 and Error Handling Middlewares
// ==========================================
app.use(notFoundHandler);
app.use(errorHandler);

// ==========================================
// Server Initialization
// ==========================================
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`🚀 Rover Ledger Server running on http://localhost:${PORT}`);
    // Check PostgreSQL connection on startup
    await testConnection();
  });
}

module.exports = app;
