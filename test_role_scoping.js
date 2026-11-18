const http = require('http');
const app = require('./src/app');
const { Role, ROLES, isValidRole, DocumentType, DOCUMENT_TYPES, isValidDocumentType } = require('./src/enums');
const { generateAccessToken } = require('./src/utils/jwt.util');
const userRepository = require('./src/repositories/user.repository');
const documentRepository = require('./src/repositories/document.repository');
const { pool, db } = require('./src/db');
const { DocumentDetails, RoverLedgers } = require('./src/models');
const { eq, inArray } = require('drizzle-orm');

async function runRoleScopingTests() {
  console.log('🧪 Starting Role Enum & Scoping Test Suite...\n');

  // ==========================================
  // Test 1: Enum Verification
  // ==========================================
  console.log('1️⃣ Verifying Role & DocumentType Enums & Helpers...');
  if (Role.ADMIN !== 'Admin') throw new Error(`Role.ADMIN expected 'Admin', got '${Role.ADMIN}'`);
  if (Role.USER !== 'User') throw new Error(`Role.USER expected 'User', got '${Role.USER}'`);
  if (!ROLES.includes('Admin') || !ROLES.includes('User')) throw new Error('ROLES array missing Admin or User');
  if (ROLES.length !== 2) throw new Error(`ROLES length expected 2, got ${ROLES.length}`);
  if (!Object.isFrozen(Role)) throw new Error('Role enum object should be frozen');
  if (!isValidRole('Admin') || !isValidRole('User')) throw new Error('isValidRole failed on valid roles');
  if (isValidRole('Superadmin') || isValidRole('')) throw new Error('isValidRole failed on invalid roles');

  // DocumentType Enum Verification
  if (DocumentType.INCOME !== 'Income') throw new Error(`DocumentType.INCOME expected 'Income', got '${DocumentType.INCOME}'`);
  if (DocumentType.EXPENSE !== 'Expense') throw new Error(`DocumentType.EXPENSE expected 'Expense', got '${DocumentType.EXPENSE}'`);
  if (DocumentType.COMBINED !== 'Combined') throw new Error(`DocumentType.COMBINED expected 'Combined', got '${DocumentType.COMBINED}'`);
  if (!DOCUMENT_TYPES.includes('Income') || !DOCUMENT_TYPES.includes('Expense') || !DOCUMENT_TYPES.includes('Combined')) throw new Error('DOCUMENT_TYPES array missing Income, Expense, or Combined');
  if (DOCUMENT_TYPES.length !== 3) throw new Error(`DOCUMENT_TYPES length expected 3, got ${DOCUMENT_TYPES.length}`);
  if (!Object.isFrozen(DocumentType)) throw new Error('DocumentType enum object should be frozen');
  if (!isValidDocumentType('income') || !isValidDocumentType('Expense') || !isValidDocumentType('COMBINED')) throw new Error('isValidDocumentType failed on valid types');
  if (isValidDocumentType('memo') || isValidDocumentType('')) throw new Error('isValidDocumentType failed on invalid types');
  console.log('   ✅ Role & DocumentType Enums & Helpers validated successfully.\n');

  // Start HTTP test server on an isolated port
  const server = http.createServer(app);
  const testPort = 5006;
  await new Promise((resolve) => server.listen(testPort, resolve));
  const baseUrl = `http://localhost:${testPort}`;

  const makeRequest = (path, method = 'GET', body = null, token = null) => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request(url, { method, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  const createdUserIds = [];
  const createdDocIds = [];

  try {
    // ==========================================
    // Seed 2 Regular Users + 1 Admin
    // ==========================================
    console.log('2️⃣ Seeding Test Users in Database...');
    const userA = await userRepository.createUser({
      FirstName: 'Alice',
      LastName: 'Tester',
      Email: `alice.test.${Date.now()}@roverledger.com`,
      Role: Role.USER,
      isActive: true,
    });
    createdUserIds.push(userA.UserId);

    const userB = await userRepository.createUser({
      FirstName: 'Bob',
      LastName: 'Tester',
      Email: `bob.test.${Date.now()}@roverledger.com`,
      Role: Role.USER,
      isActive: true,
    });
    createdUserIds.push(userB.UserId);

    const adminUser = await userRepository.createUser({
      FirstName: 'Admin',
      LastName: 'Supervisor',
      Email: `admin.test.${Date.now()}@roverledger.com`,
      Role: Role.ADMIN,
      isActive: true,
    });
    createdUserIds.push(adminUser.UserId);

    console.log(`   User A (USER): ${userA.Email} [${userA.UserId}]`);
    console.log(`   User B (USER): ${userB.Email} [${userB.UserId}]`);
    console.log(`   Admin  (ADMIN): ${adminUser.Email} [${adminUser.UserId}]`);

    // Generate JWT access tokens
    const tokenA = generateAccessToken({ UserId: userA.UserId, Email: userA.Email, Role: userA.Role });
    const tokenB = generateAccessToken({ UserId: userB.UserId, Email: userB.Email, Role: userB.Role });
    const tokenAdmin = generateAccessToken({ UserId: adminUser.UserId, Email: adminUser.Email, Role: adminUser.Role });

    // Seed test documents
    console.log('\n3️⃣ Seeding Test Documents for User A and User B...');
    const docA = await documentRepository.createDocument({
      documentName: 'Invoice_Alice_Jan2026',
      documentType: DocumentType.EXPENSE,
      fileSize: 1024,
      fileType: 'application/pdf',
      documentDate: new Date('2026-01-15'),
      oneDriveItemId: 'mock_onedrive_alice',
      originalFileName: 'invoice_alice.pdf',
      uploadedBy: userA.UserId,
    });
    createdDocIds.push(docA.id);

    const docB = await documentRepository.createDocument({
      documentName: 'Invoice_Bob_Feb2026',
      documentType: DocumentType.INCOME,
      fileSize: 2048,
      fileType: 'application/pdf',
      documentDate: new Date('2026-02-15'),
      oneDriveItemId: 'mock_onedrive_bob',
      originalFileName: 'invoice_bob.pdf',
      uploadedBy: userB.UserId,
    });
    createdDocIds.push(docB.id);

    console.log(`   Doc A created: ${docA.id} (Owner: User A)`);
    console.log(`   Doc B created: ${docB.id} (Owner: User B)`);

    // ==========================================
    // Test 4: Regular User Document Scoping
    // ==========================================
    console.log('\n4️⃣ Testing GET /documents as Regular User A...');
    const resGetA = await makeRequest('/documents', 'GET', null, tokenA);
    if (resGetA.status !== 200) throw new Error(`Expected 200, got ${resGetA.status}`);
    const rowsA = resGetA.data.data.rows;
    console.log(`   User A received ${rowsA.length} document(s).`);
    const hasDocA = rowsA.some((d) => d.id === docA.id);
    const hasDocB = rowsA.some((d) => d.id === docB.id);
    if (!hasDocA) throw new Error('User A should see their own Doc A');
    if (hasDocB) throw new Error('User A must NOT see User B Doc B');
    console.log('   ✅ GET /documents correctly scopes to User A only.');

    console.log('\n5️⃣ Testing POST /documents/filter as Regular User A...');
    const resFilterA = await makeRequest('/documents/filter', 'POST', {}, tokenA);
    if (resFilterA.status !== 200) throw new Error(`Expected 200, got ${resFilterA.status}`);
    const filterRowsA = resFilterA.data.data.rows;
    const filterHasDocB = filterRowsA.some((d) => d.id === docB.id);
    if (filterHasDocB) throw new Error('POST /documents/filter must NOT return User B Doc B for User A');
    console.log('   ✅ POST /documents/filter correctly restricted to User A.');

    // User A trying to view User B's document by ID
    console.log('\n6️⃣ Testing GET /documents/:id access control (User A accessing User B doc)...');
    const resForbidden = await makeRequest(`/documents/${docB.id}`, 'GET', null, tokenA);
    if (resForbidden.status !== 403) {
      throw new Error(`Expected 403 Forbidden for User A accessing User B doc, got ${resForbidden.status}`);
    }
    console.log('   ✅ 403 Forbidden correctly returned when User A accesses User B doc.');

    // ==========================================
    // Test 7: Admin Document Scoping (All Active Docs)
    // ==========================================
    console.log('\n7️⃣ Testing GET /documents as ADMIN...');
    const resGetAdmin = await makeRequest('/documents', 'GET', null, tokenAdmin);
    if (resGetAdmin.status !== 200) throw new Error(`Expected 200, got ${resGetAdmin.status}`);
    const rowsAdmin = resGetAdmin.data.data.rows;
    console.log(`   Admin received ${rowsAdmin.length} document(s).`);
    const adminHasDocA = rowsAdmin.some((d) => d.id === docA.id);
    const adminHasDocB = rowsAdmin.some((d) => d.id === docB.id);
    if (!adminHasDocA || !adminHasDocB) {
      throw new Error('Admin should see both Doc A and Doc B');
    }
    console.log('   ✅ Admin successfully sees documents across all users (softDelete = false).');

    console.log('\n8️⃣ Testing POST /documents/filter as ADMIN...');
    const resFilterAdmin = await makeRequest('/documents/filter', 'POST', {}, tokenAdmin);
    if (resFilterAdmin.status !== 200) throw new Error(`Expected 200, got ${resFilterAdmin.status}`);
    const adminFilterRows = resFilterAdmin.data.data.rows;
    const adminFilterHasDocA = adminFilterRows.some((d) => d.id === docA.id);
    const adminFilterHasDocB = adminFilterRows.some((d) => d.id === docB.id);
    if (!adminFilterHasDocA || !adminFilterHasDocB) {
      throw new Error('Admin POST /documents/filter should return both Doc A and Doc B');
    }

    // Verify uploadedByUser details are enriched in filter results
    const foundDocA = adminFilterRows.find((d) => d.id === docA.id);
    if (!foundDocA.uploadedByUser) {
      throw new Error('Expected uploadedByUser to be enriched in document');
    }
    if (foundDocA.uploadedByUser.userId !== userA.UserId) {
      throw new Error(`Expected uploadedByUser.userId '${userA.UserId}', got '${foundDocA.uploadedByUser.userId}'`);
    }
    if (foundDocA.uploadedByUser.email !== userA.Email) {
      throw new Error(`Expected uploadedByUser.email '${userA.Email}', got '${foundDocA.uploadedByUser.email}'`);
    }
    console.log('   ✅ Uploader details (uploadedByUser) correctly attached to document.');
    console.log('   ✅ Admin POST /documents/filter returns all users documents.');

    console.log('\n9️⃣ Testing Admin filtering by specific user (uploadedBy)...');
    const resAdminFilterByAlice = await makeRequest('/documents/filter', 'POST', { uploadedBy: userA.UserId }, tokenAdmin);
    if (resAdminFilterByAlice.status !== 200) throw new Error(`Expected 200, got ${resAdminFilterByAlice.status}`);
    const aliceOnlyRows = resAdminFilterByAlice.data.data.rows;
    if (!aliceOnlyRows.some((d) => d.id === docA.id)) throw new Error('Expected Doc A in Alice filter');
    if (aliceOnlyRows.some((d) => d.id === docB.id)) throw new Error('Doc B should not appear when filtered by Alice');
    console.log('   ✅ Admin can selectively filter by single uploadedBy ID.');

    // Test filtering by array of uploadedBy IDs
    const resAdminFilterMulti = await makeRequest('/documents/filter', 'POST', { uploadedBy: [userA.UserId, userB.UserId] }, tokenAdmin);
    if (resAdminFilterMulti.status !== 200) throw new Error(`Expected 200, got ${resAdminFilterMulti.status}`);
    const multiRows = resAdminFilterMulti.data.data.rows;
    if (!multiRows.some((d) => d.id === docA.id) || !multiRows.some((d) => d.id === docB.id)) {
      throw new Error('Expected both Doc A and Doc B when filtering by [userA.UserId, userB.UserId]');
    }
    console.log('   ✅ Admin can selectively filter by array of uploadedBy IDs.');

    console.log('\n🔟 Testing Admin GET /documents/:id on User B doc...');
    const resAdminGetDocB = await makeRequest(`/documents/${docB.id}`, 'GET', null, tokenAdmin);
    if (resAdminGetDocB.status !== 200) {
      throw new Error(`Admin should be allowed to view User B doc, got status ${resAdminGetDocB.status}`);
    }
    if (!resAdminGetDocB.data.data.uploadedByUser || resAdminGetDocB.data.data.uploadedByUser.userId !== userB.UserId) {
      throw new Error('Expected uploadedByUser on GET /documents/:id');
    }
    console.log('   ✅ Single document details also include uploadedByUser.');
    console.log('   ✅ Admin successfully views User B document details.');

    // ==========================================
    // Test 11: DB-Level ON DELETE CASCADE Verification
    // ==========================================
    console.log('\n1️⃣1️⃣ Testing DB-Level ON DELETE CASCADE (deleting user directly from DB)...');
    const cascadeUser = await userRepository.createUser({
      FirstName: 'Cascade',
      LastName: 'Tester',
      Email: `cascade.test.${Date.now()}@roverledger.com`,
      Role: Role.USER,
      isActive: true,
    });

    const cascadeDoc = await documentRepository.createDocument({
      documentName: 'Cascade Test Document',
      documentType: DocumentType.EXPENSE,
      fileSize: 512,
      fileType: 'application/pdf',
      documentDate: new Date('2026-07-01'),
      oneDriveItemId: 'mock_onedrive_cascade',
      originalFileName: 'cascade_doc.pdf',
      uploadedBy: cascadeUser.UserId,
    });

    // Verify document exists in DB before user deletion
    const checkDocBefore = await db.select().from(DocumentDetails).where(eq(DocumentDetails.id, cascadeDoc.id));
    if (checkDocBefore.length !== 1) {
      throw new Error('Expected cascade document to exist in DB before user deletion');
    }

    // Delete user directly from Rover_ledgers table via SQL
    await db.delete(RoverLedgers).where(eq(RoverLedgers.UserId, cascadeUser.UserId));

    // Verify document was automatically deleted from document_details by PostgreSQL CASCADE
    const checkDocAfter = await db.select().from(DocumentDetails).where(eq(DocumentDetails.id, cascadeDoc.id));
    if (checkDocAfter.length !== 0) {
      throw new Error('CASCADE FAILURE: Document details still exist in DB after user deletion!');
    }
    console.log('   ✅ Confirmed: Deleting user directly from DB automatically cascades and deletes all document_details records!');

    console.log('\n🎉 ALL ROLE ENUM & ROLE SCOPING TESTS PASSED 100%!\n');
  } finally {
    // Clean up test documents and users
    console.log('🧹 Cleaning up test records from database...');
    if (createdDocIds.length > 0) {
      await db.delete(DocumentDetails).where(inArray(DocumentDetails.id, createdDocIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(RoverLedgers).where(inArray(RoverLedgers.UserId, createdUserIds));
    }
    console.log('   Test records cleaned up.');
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

runRoleScopingTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});

