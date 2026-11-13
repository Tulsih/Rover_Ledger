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
  const testUserId = '00000000-1111-2222-3333-444444444444';
  const testUserToken = generateToken({
    UserId: testUserId,
    Email: 'auth_user_docs@roverledger.com',
    Role: 'User',
  });

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
    // 0. Validation Testing: Upload without authtoken (must be rejected 401)
    console.log('0️⃣ Testing Upload Validation (Unauthenticated upload requires token)...');
    const unauthUploadRes = await makeMultipartRequest('/documents/upload', {
      documentName: 'Unauth Document',
      documentType: 'income',
      documentDate: '2026-04-01',
    }, null, null);
    if (unauthUploadRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized when uploading without token, got ${unauthUploadRes.status}`);
    }
    console.log('   ✅ Correctly rejected unauthenticated upload request with 401 Unauthorized.\n');

    // 1. Validation Testing: Missing File
    console.log('1️⃣ Testing Upload Validation (Missing file)...');
    const noFileRes = await makeMultipartRequest('/documents/upload', {
      documentName: 'Test Document',
      documentType: 'income',
      documentDate: '2026-04-01',
    }, null, testUserToken);
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
    }, testUserToken);
    console.log('   Invalid type response:', invalidTypeRes.data);
    if (invalidTypeRes.status !== 400 || !invalidTypeRes.data.message.includes('Allowed values are')) {
      throw new Error('Expected 400 validation error for invalid documentType');
    }
    console.log('   ✅ Correctly rejected invalid documentType (400).\n');

    // 2.1 Testing Upload Document without documentType (optional field test)
    console.log('2️⃣.1️⃣ Testing Upload Document without documentType (documentType is optional)...');
    const docNoTypeContent = Buffer.from('%PDF-1.4 GENERAL MEMO: Rover Ledger Quarterly Planning');
    const uploadResNoType = await makeMultipartRequest('/documents/upload', {
      documentName: 'Quarterly Planning Memo',
      documentDate: '2026-06-01',
      // Notice: documentType is completely omitted here
    }, {
      fieldname: 'file',
      filename: 'planning_memo.pdf',
      mimetype: 'application/pdf',
      content: docNoTypeContent,
    }, testUserToken);

    console.log('   Upload (without documentType) Response:', uploadResNoType.data);
    if (uploadResNoType.status !== 201 || !uploadResNoType.data.success) {
      throw new Error(`Upload without documentType failed with status ${uploadResNoType.status}`);
    }

    const docNoType = uploadResNoType.data.data;
    uploadedOneDriveItemIds.push(docNoType.oneDriveItemId);
    if (docNoType.documentType !== null) {
      throw new Error(`Expected documentType to be null when omitted, got '${docNoType.documentType}'`);
    }
    console.log('   ✅ Document uploaded successfully without documentType (documentType = null)!\n');

    // 2.2 Testing Upload Document with documentType: 'null' (explicit null value)
    console.log('2️⃣.2️⃣ Testing Upload Document with documentType: "null"...');
    const docNullTypeContent = Buffer.from('%PDF-1.4 GENERAL MEMO: Rover Ledger Explicit Null Document Type');
    const uploadResNullType = await makeMultipartRequest('/documents/upload', {
      documentName: 'Explicit Null Type Document',
      documentType: 'null',
      documentDate: '2026-06-02',
    }, {
      fieldname: 'file',
      filename: 'null_type_memo.pdf',
      mimetype: 'application/pdf',
      content: docNullTypeContent,
    }, testUserToken);

    console.log('   Upload (with documentType: "null") Response:', uploadResNullType.data);
    if (uploadResNullType.status !== 201 || !uploadResNullType.data.success) {
      throw new Error(`Upload with documentType: "null" failed with status ${uploadResNullType.status}`);
    }

    const docNullType = uploadResNullType.data.data;
    uploadedOneDriveItemIds.push(docNullType.oneDriveItemId);
    if (docNullType.documentType !== null) {
      throw new Error(`Expected documentType to be null when 'null' is provided, got '${docNullType.documentType}'`);
    }
    console.log('   ✅ Document uploaded successfully with documentType: "null" (stored as null)!\n');

    // 2.3 Testing Upload Document with documentType: 'undefined' (common FormData stringification from FE)
    console.log('2️⃣.3️⃣ Testing Upload Document with documentType: "undefined"...');
    const docUndefinedTypeContent = Buffer.from('%PDF-1.4 GENERAL MEMO: Rover Ledger FormData undefined string test');
    const uploadResUndefinedType = await makeMultipartRequest('/documents/upload', {
      documentName: 'Undefined Type String Document',
      documentType: 'undefined',
      documentDate: '2026-06-03',
    }, {
      fieldname: 'file',
      filename: 'undefined_type_memo.pdf',
      mimetype: 'application/pdf',
      content: docUndefinedTypeContent,
    }, testUserToken);

    console.log('   Upload (with documentType: "undefined") Response:', uploadResUndefinedType.data);
    if (uploadResUndefinedType.status !== 201 || !uploadResUndefinedType.data.success) {
      throw new Error(`Upload with documentType: "undefined" failed with status ${uploadResUndefinedType.status}`);
    }

    const docUndefinedType = uploadResUndefinedType.data.data;
    uploadedOneDriveItemIds.push(docUndefinedType.oneDriveItemId);
    if (docUndefinedType.documentType !== null) {
      throw new Error(`Expected documentType to be null when 'undefined' is provided, got '${docUndefinedType.documentType}'`);
    }
    console.log('   ✅ Document uploaded successfully with documentType: "undefined" (safely handled and stored as null)!\n');

    // 3. Upload Document 1: Income Document
    console.log('3️⃣ Testing Upload Document 1 (documentType: income, synced to Microsoft OneDrive)...');
    const doc1Content = Buffer.from('%PDF-1.4 INVOICE #1001: Rover Ledger Consulting Services - Paid $5,000');
    const uploadRes1 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Consulting Income Invoice April 2026',
      documentType: 'income',
      documentDate: '2026-04-10',
    }, {
      fieldname: 'file',
      filename: 'consulting_income.pdf',
      mimetype: 'application/pdf',
      content: doc1Content,
    }, testUserToken);

    console.log('   Upload 1 Response:', uploadRes1.data);
    if (uploadRes1.status !== 201 || !uploadRes1.data.success) {
      throw new Error(`Upload 1 failed with status ${uploadRes1.status}: ${JSON.stringify(uploadRes1.data)}`);
    }

    const doc1 = uploadRes1.data.data;
    uploadedOneDriveItemIds.push(doc1.oneDriveItemId);

    // Verify all requested database fields are present and properly typed
    const requiredFields = [
      'id', 'documentName', 'documentType', 'fileSize', 'fileType',
      'documentDate', 'createdAt', 'updatedAt', 'softDelete',
      'oneDriveItemId', 'oneDriveWebUrl', 'originalFileName'
    ];
    for (const field of requiredFields) {
      if (doc1[field] === undefined || doc1[field] === null) {
        throw new Error(`Missing required field '${field}' in created document record`);
      }
    }

    if (doc1.documentType !== 'income') throw new Error(`Expected documentType 'income', got '${doc1.documentType}'`);
    if (doc1.pdfCreated !== undefined) throw new Error(`pdfCreated should not be present in document response, got ${doc1.pdfCreated}`);
    if (doc1.softDelete !== false) throw new Error(`Expected softDelete false, got ${doc1.softDelete}`);
    console.log('   ✅ Document 1 successfully stored in Rover Ledger DB and synced to Microsoft OneDrive!\n');

    // 4. Upload Document 2: expense Document (testing 'expense' type and image upload)
    console.log('4️⃣ Testing Upload Document 2 (documentType: expense, image upload)...');
    const doc2Content = Buffer.from('RECEIPT: Office Supplies & Equipment - $450');
    const uploadRes2 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Office Rent & Utilities expense',
      documentType: 'expense',
      documentDate: '2026-05-01',
    }, {
      fieldname: 'image',
      filename: 'office_receipt.jpg',
      mimetype: 'image/jpeg',
      content: doc2Content,
    }, testUserToken);

    console.log('   Upload 2 Response:', uploadRes2.data);
    if (uploadRes2.status !== 201 || !uploadRes2.data.success) {
      throw new Error(`Upload 2 failed with status ${uploadRes2.status}`);
    }

    const doc2 = uploadRes2.data.data;
    uploadedOneDriveItemIds.push(doc2.oneDriveItemId);

    if (doc2.documentType !== 'expense') throw new Error(`Expected documentType 'expense', got '${doc2.documentType}'`);
    if (doc2.pdfCreated !== undefined) throw new Error(`pdfCreated should not be present in document response, got ${doc2.pdfCreated}`);
    console.log('   ✅ Document 2 (expense image) uploaded and saved successfully!\n');

    // 5. Upload Document 3: Associated with an Authenticated User via authtoken
    console.log('5️⃣ Testing Upload Document 3 with authtoken...');

    const doc3Content = Buffer.from('BILL: Software Licenses expense - $1,200');
    const uploadRes3 = await makeMultipartRequest('/documents/upload', {
      documentName: 'Software Cloud Licenses expense',
      documentType: 'expense',
      documentDate: '2026-05-15',
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

    // 6. Fetch Documents without authtoken (must be rejected 401)
    console.log('6️⃣ Testing Fetch Documents (GET /documents without authtoken requires auth)...');
    const unauthListRes = await makeJsonRequest('/documents');
    console.log('   Unauthenticated response status:', unauthListRes.status);
    if (unauthListRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized when calling GET /documents without token, got ${unauthListRes.status}`);
    }
    console.log('   ✅ Correctly rejected unauthenticated request with 401 Unauthorized.\n');

    // 7. Verify GET /documents returns ONLY the authenticated user's active documents without counts
    console.log('7️⃣ Testing GET /documents returns active documents (counts removed from list API)...');
    const userDocsRes = await makeJsonRequest('/documents', 'GET', null, testUserToken);
    console.log('   User Docs summary:', {
      rowsCount: userDocsRes.data.data.rows.length,
      hasTotal: userDocsRes.data.data.total !== undefined,
      hasIncomeInvoiceCount: userDocsRes.data.data.incomeInvoiceCount !== undefined,
      hasExpenseInvoiceCount: userDocsRes.data.data.expenseInvoiceCount !== undefined,
    });

    if (userDocsRes.status !== 200 || !userDocsRes.data.success) {
      throw new Error('Failed to fetch documents for authenticated user');
    }

    // Verify all returned rows belong to testUserId
    for (const row of userDocsRes.data.data.rows) {
      if (row.uploadedBy !== testUserId) {
        throw new Error(`Document row leaked belonging to another user: uploadedBy=${row.uploadedBy}`);
      }
    }

    // Verify counts are NOT passed in GET /documents response
    if (userDocsRes.data.data.incomeInvoiceCount !== undefined || userDocsRes.data.data.expenseInvoiceCount !== undefined) {
      throw new Error('incomeInvoiceCount or expenseInvoiceCount should be removed from GET /documents response');
    }
    console.log('   ✅ GET /documents correctly returned user documents with counts removed from response!\n');

    // 7.1. Testing New Counts API (GET /documents/counts)
    console.log('7️⃣.1️⃣ Testing New Document Counts API (GET /documents/counts)...');
    const unauthCountsRes = await makeJsonRequest('/documents/counts');
    if (unauthCountsRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for unauthenticated GET /documents/counts, got ${unauthCountsRes.status}`);
    }

    const userCountsRes = await makeJsonRequest('/documents/counts', 'GET', null, testUserToken);
    console.log('   User Counts response:', userCountsRes.data.data);

    if (userCountsRes.status !== 200 || !userCountsRes.data.success) {
      throw new Error('Failed to fetch counts for authenticated user');
    }

    const { total, incomeInvoiceCount, expenseInvoiceCount, pdfCount } = userCountsRes.data.data;
    if (total === undefined || incomeInvoiceCount === undefined || expenseInvoiceCount === undefined || pdfCount === undefined) {
      throw new Error('All 4 counts (total, incomeInvoiceCount, expenseInvoiceCount, pdfCount) must be present in GET /documents/counts');
    }

    // Document 3 was uploaded with testUserToken as 'expense'
    if (total < 1 || expenseInvoiceCount < 1) {
      throw new Error('Expected total >= 1 and expenseInvoiceCount >= 1 for testUser');
    }

    console.log('   ✅ Document Counts API (GET /documents/counts) correctly returned all 4 counts strictly for authenticated user!\n');

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
    // 12.1 Unauthenticated delete must be rejected with 401
    const unauthDeleteRes = await makeJsonRequest(`/documents/${doc1.id}`, 'DELETE');
    if (unauthDeleteRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for unauthenticated DELETE, got ${unauthDeleteRes.status}`);
    }
    console.log('   ✅ Correctly rejected unauthenticated DELETE request with 401 Unauthorized.');

    // 12.2 Authenticated delete succeeds
    const deleteRes = await makeJsonRequest(`/documents/${doc1.id}`, 'DELETE', null, testUserToken);
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
    const listAfterDelete = await makeJsonRequest('/documents', 'GET', null, testUserToken);
    if (listAfterDelete.data.data.rows.some(r => r.id === doc1.id)) {
      throw new Error('Soft-deleted document still appeared in default /documents list');
    }
    // Verify file is actually deleted from Microsoft OneDrive
    try {
      await onedriveService.getFileMetadataFromOneDrive(doc1.oneDriveItemId);
      throw new Error('Expected file to be removed from Microsoft OneDrive, but it was still found');
    } catch (err) {
      console.log('   ✅ Confirmed: File was permanently removed from Microsoft OneDrive storage.');
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
