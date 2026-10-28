const http = require('http');
const app = require('./src/app');
const onedriveService = require('./src/services/onedrive.service');
const { generateToken } = require('./src/utils/jwt.util');
const { pool } = require('./src/db');

/**
 * Builds a multipart/form-data body buffer with boundary
 */
function createMultipartBody(boundary, fields, file) {
  const crlf = '\r\n';
  const chunks = [];

  // Add text fields
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${key}"${crlf}${crlf}` +
      `${value}${crlf}`
    ));
  }

  // Add file field
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${file.fieldname || 'file'}"; filename="${file.filename || 'test.jpg'}"${crlf}` +
      `Content-Type: ${file.mimetype || 'image/jpeg'}${crlf}${crlf}`
    ));
    chunks.push(file.content);
    chunks.push(Buffer.from(crlf));
  }

  // Closing boundary
  chunks.push(Buffer.from(`--${boundary}--${crlf}`));

  return Buffer.concat(chunks);
}

async function runDocumentTests() {
  console.log('🧪 Starting Rover Ledger Document & Microsoft OneDrive End-to-End Test Suite...\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5006, resolve));
  const baseUrl = 'http://localhost:5006';

  const uploadedOneDriveItemIds = [];

  const makeJsonRequest = (path, method = 'GET', body = null, token = null) => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request(url, { method, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  const makeMultipartRequest = (path, fields, file, token = null) => {
    return new Promise((resolve, reject) => {
      const boundary = `----RoverLedgerBoundary${Date.now()}`;
      const bodyBuffer = createMultipartBody(boundary, fields, file);
      const url = new URL(path, baseUrl);

      const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length,
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request(url, { method: 'POST', headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });
      req.on('error', reject);
      req.write(bodyBuffer);
      req.end();
    });
  };

  const makeStreamDownloadRequest = (path, token = null) => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const req = http.request(url, { method: 'GET', headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  };

  try {
    // 1. Validation Testing: Missing File
    console.log('1️⃣ Testing Upload Validation (Missing file)...');
    const noFileRes = await makeMultipartRequest('/documents/upload', {
      documentName: 'Test Document',
      documentType: 'income',
      documentDate: '2026-04-01',
    }, null);
    console.log('   Missing file response:', noFileRes.data);
    if (noFileRes.status !== 400 || noFileRes.data.success !== false) {
      throw new Error('Expected 400 validation error for missing file');
    }
    console.log('   ✅ Correctly rejected request without file (400).\n');

    // 2. Validation Testing: Invalid Document Type
    console.log('2️⃣ Testing Upload Validation (Invalid documentType)...');
    const invalidTypeRes = await makeMultipartRequest('/documents/upload', {
      documentName: 'Test Invoice',
      documentType: 'invalid_category',
      documentDate: '2026-04-01',
    }, {
      fieldname: 'file',
      filename: 'receipt.png',
      mimetype: 'image/png',
      content: Buffer.from('dummy image content'),
    });
    console.log('   Invalid type response:', invalidTypeRes.data);
    if (invalidTypeRes.status !== 400 || !invalidTypeRes.data.message.includes('Allowed values are')) {
      throw new Error('Expected 400 validation error for invalid documentType');
    }
    console.log('   ✅ Correctly rejected invalid documentType (400).\n');

    // 3. Upload Document 1: Income Document (without token)
    console.log('3️⃣ Testing Upload Document 1 (documentType: income, synced to Microsoft OneDrive)...');
    const doc1Content = Buffer.from('INVOICE #1001: Rover Ledger Consulting Services - Paid $5,000');
    const uploadRes1 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Consulting Income Invoice April 2026',
      documentType: 'income',
      documentDate: '2026-04-10',
      pdfCreated: 'true',
    }, {
      fieldname: 'file',
      filename: 'consulting_income.pdf',
      mimetype: 'application/pdf',
      content: doc1Content,
    });

    console.log('   Upload 1 Response:', uploadRes1.data);
    if (uploadRes1.status !== 201 || !uploadRes1.data.success) {
      throw new Error(`Upload 1 failed with status ${uploadRes1.status}: ${JSON.stringify(uploadRes1.data)}`);
    }

    const doc1 = uploadRes1.data.data;
    uploadedOneDriveItemIds.push(doc1.oneDriveItemId);

    // Verify all requested database fields are present and properly typed
    const requiredFields = [
      'id', 'documentName', 'documentType', 'fileSize', 'fileType',
      'documentDate', 'createdAt', 'updatedAt', 'softDelete', 'pdfCreated',
      'oneDriveItemId', 'oneDriveWebUrl', 'originalFileName'
    ];
    for (const field of requiredFields) {
      if (doc1[field] === undefined || doc1[field] === null) {
        throw new Error(`Missing required field '${field}' in created document record`);
      }
    }

    if (doc1.documentType !== 'income') throw new Error(`Expected documentType 'income', got '${doc1.documentType}'`);
    if (doc1.pdfCreated !== true) throw new Error(`Expected pdfCreated true, got ${doc1.pdfCreated}`);
    if (doc1.softDelete !== false) throw new Error(`Expected softDelete false, got ${doc1.softDelete}`);
    console.log('   ✅ Document 1 successfully stored in Rover Ledger DB and synced to Microsoft OneDrive!\n');

    // 4. Upload Document 2: expense Document (testing 'expense' type)
    console.log('4️⃣ Testing Upload Document 2 (documentType: expense, image upload)...');
    const doc2Content = Buffer.from('RECEIPT: Office Supplies & Equipment - $450');
    const uploadRes2 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Office Rent & Utilities expense',
      documentType: 'expense',
      documentDate: '2026-05-01',
      pdfCreated: 'false',
    }, {
      fieldname: 'image',
      filename: 'office_receipt.jpg',
      mimetype: 'image/jpeg',
      content: doc2Content,
    });

    console.log('   Upload 2 Response:', uploadRes2.data);
    if (uploadRes2.status !== 201 || !uploadRes2.data.success) {
      throw new Error(`Upload 2 failed with status ${uploadRes2.status}`);
    }

    const doc2 = uploadRes2.data.data;
    uploadedOneDriveItemIds.push(doc2.oneDriveItemId);

    if (doc2.documentType !== 'expense') throw new Error(`Expected documentType 'expense', got '${doc2.documentType}'`);
    if (doc2.pdfCreated !== false) throw new Error(`Expected pdfCreated false, got ${doc2.pdfCreated}`);
    console.log('   ✅ Document 2 (expense image) uploaded and saved successfully!\n');

    // 5. Upload Document 3: Associated with an Authenticated User via authtoken
    console.log('5️⃣ Testing Upload Document 3 with authtoken...');
    const testUserId = '00000000-1111-2222-3333-444444444444';
    const testUserToken = generateToken({
      UserId: testUserId,
      Email: 'auth_user_docs@roverledger.com',
      Role: 'User',
    });

    const doc3Content = Buffer.from('BILL: Software Licenses expense - $1,200');
    const uploadRes3 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Software Cloud Licenses expense',
      documentType: 'expense',
      documentDate: '2026-05-15',
      pdfCreated: 'true',
    }, {
      fieldname: 'file',
      filename: 'cloud_bill.pdf',
      mimetype: 'application/pdf',
      content: doc3Content,
    }, testUserToken);

    console.log('   Upload 3 Response (with authtoken):', uploadRes3.data);
    if (uploadRes3.status !== 201 || !uploadRes3.data.success) {
      throw new Error(`Upload 3 with authtoken failed with status ${uploadRes3.status}`);
    }

    const doc3 = uploadRes3.data.data;
    uploadedOneDriveItemIds.push(doc3.oneDriveItemId);
    if (doc3.uploadedBy !== testUserId) {
      throw new Error(`Expected uploadedBy to be '${testUserId}', got '${doc3.uploadedBy}'`);
    }
    console.log('   ✅ Document 3 saved with uploadedBy linked to authtoken UserId!\n');

    // 6. Fetch All Documents API (without authtoken)
    console.log('6️⃣ Testing Fetch All Documents (GET /documents without authtoken)...');
    const listRes = await makeJsonRequest('/documents');
    console.log('   Fetch All Documents summary:', {
      total: listRes.data.data.total,
      rowsCount: listRes.data.data.rows.length,
      page: listRes.data.data.page,
    });

    if (listRes.status !== 200 || !listRes.data.success || listRes.data.data.rows.length < 3) {
      throw new Error('Failed to fetch all documents');
    }
    console.log('   ✅ GET /documents returned all documents.\n');

    // 7. Fetch Documents based on authtoken (GET /documents with authtoken)
    console.log('7️⃣ Testing Fetch Documents based on authtoken (GET /documents with Bearer token)...');
    const userDocListRes = await makeJsonRequest('/documents', 'GET', null, testUserToken);
    console.log('   User Doc List summary:', {
      total: userDocListRes.data.data.total,
      rowsCount: userDocListRes.data.data.rows.length,
    });

    if (userDocListRes.status !== 200 || !userDocListRes.data.success) {
      throw new Error('Failed to fetch documents based on authtoken');
    }
    // All returned rows MUST belong to the authenticated user
    for (const row of userDocListRes.data.data.rows) {
      if (row.uploadedBy !== testUserId) {
        throw new Error(`Authtoken fetch leaked document belonging to another user: uploadedBy=${row.uploadedBy}`);
      }
    }
    if (!userDocListRes.data.data.rows.some(r => r.id === doc3.id)) {
      throw new Error('Expected to find Document 3 uploaded by this authenticated user');
    }
    console.log('   ✅ GET /documents correctly fetched ONLY documents for the authenticated user based on authtoken!\n');

    // 8. Filter Documents: Must contain only req body not query
    console.log('8️⃣ Testing Filter Documents using ONLY req.body (POST /documents/filter)...');

    // Filter by documentType: income (in req.body)
    const filterIncomeBodyRes = await makeJsonRequest('/documents/filter', 'POST', {
      documentType: 'income',
    });
    console.log(`   POST /documents/filter with body { documentType: 'income' } returned: ${filterIncomeBodyRes.data.data.total} records`);
    for (const row of filterIncomeBodyRes.data.data.rows) {
      if (row.documentType !== 'income') throw new Error(`Filter leaked non-income document: ${row.documentType}`);
    }

    // Verify req.body takes precedence and query string is ignored
    const filterQueryIgnoredRes = await makeJsonRequest('/documents/filter?documentType=income', 'POST', {
      documentType: 'expense',
    });
    console.log(`   Query parameter ignored check: URL had documentType=income but body had documentType=expense`);
    for (const row of filterQueryIgnoredRes.data.data.rows) {
      if (row.documentType !== 'expense') {
        throw new Error(`BUG: Filter used query string instead of req.body! Found type: ${row.documentType}`);
      }
    }
    console.log('   ✅ Filter verified: strictly operates on req.body and ignores query string!\n');

    // 9. Filter Documents based on authtoken
    console.log('9️⃣ Testing Filter Documents based on authtoken (POST /documents/filter with authtoken)...');
    const userFilterRes = await makeJsonRequest('/documents/filter', 'POST', {
      documentType: 'expense',
    }, testUserToken);

    console.log(`   User authtoken filter returned: ${userFilterRes.data.data.total} records`);
    for (const row of userFilterRes.data.data.rows) {
      if (row.uploadedBy !== testUserId) {
        throw new Error(`User filter leaked another user's document! uploadedBy: ${row.uploadedBy}`);
      }
    }
    if (!userFilterRes.data.data.rows.some(r => r.id === doc3.id)) {
      throw new Error("Expected to find User's Document 3 in filtered results");
    }
    console.log('   ✅ Filter documents correctly scoped to authtoken authenticated user!\n');

    // 10. Fetch Single Document Details by ID
    console.log('🔟 Testing Fetch Single Document Details (GET /documents/:id)...');
    const singleRes = await makeJsonRequest(`/documents/${doc1.id}`);
    console.log('   Single Document details:', {
      id: singleRes.data.data.id,
      documentName: singleRes.data.data.documentName,
      documentType: singleRes.data.data.documentType,
      oneDriveItemId: singleRes.data.data.oneDriveItemId,
    });
    if (singleRes.status !== 200 || singleRes.data.data.id !== doc1.id) {
      throw new Error('Fetch single document failed');
    }
    console.log('   ✅ Single document details fetched successfully.\n');

    // 11. Download / Stream Document directly from Microsoft OneDrive
    console.log('1️⃣1️⃣ Testing Download / Stream Document from Microsoft OneDrive (GET /documents/:id/download)...');
    const downloadRes = await makeStreamDownloadRequest(`/documents/${doc1.id}/download`);
    console.log('   Download status:', downloadRes.status);
    console.log('   Download Content-Type:', downloadRes.headers['content-type']);
    console.log('   Downloaded bytes length:', downloadRes.buffer.length);
    console.log('   Original bytes length:', doc1Content.length);

    if (downloadRes.status !== 200) {
      throw new Error(`Download failed with status ${downloadRes.status}`);
    }
    if (downloadRes.buffer.toString() !== doc1Content.toString()) {
      throw new Error('Downloaded file content does not match original uploaded content!');
    }
    console.log('   ✅ File content downloaded directly from Microsoft OneDrive matched original content bit-for-bit!\n');

    // 12. Soft Delete Document
    console.log('1️⃣2️⃣ Testing Soft Delete Document (DELETE /documents/:id)...');
    const deleteRes = await makeJsonRequest(`/documents/${doc1.id}`, 'DELETE');
    console.log('   Soft delete response:', deleteRes.data);
    if (deleteRes.status !== 200 || deleteRes.data.data.softDelete !== true) {
      throw new Error('Soft delete failed or softDelete flag was not true');
    }

    // Verify GET /documents/:id now returns 404
    const getDeletedRes = await makeJsonRequest(`/documents/${doc1.id}`);
    if (getDeletedRes.status !== 404) {
      throw new Error(`Expected 404 for soft-deleted document, got ${getDeletedRes.status}`);
    }

    // Verify GET /documents list excludes soft-deleted document
    const listAfterDelete = await makeJsonRequest('/documents');
    if (listAfterDelete.data.data.rows.some(r => r.id === doc1.id)) {
      throw new Error('Soft-deleted document still appeared in default /documents list');
    }
    console.log('   ✅ Soft delete verified: softDelete = true, excluded from active queries.\n');

    console.log('🎉 ALL DOCUMENT & MICROSOFT ONEDRIVE TESTS PASSED SUCCESSFULLY! 🚀\n');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exitCode = 1;
  } finally {
    // Clean up uploaded test files from Microsoft OneDrive
    console.log('🧹 Cleaning up uploaded test files from Microsoft OneDrive...');
    for (const itemId of uploadedOneDriveItemIds) {
      try {
        await onedriveService.deleteFileFromOneDrive(itemId);
        console.log(`   Deleted OneDrive test item: ${itemId}`);
      } catch (cleanupErr) {
        console.warn(`   Could not delete test item ${itemId}:`, cleanupErr.message);
      }
    }

    server.close();
    await pool.end();
  }
}

runDocumentTests();
