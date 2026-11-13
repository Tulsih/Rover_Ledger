const http = require('http');
const app = require('./src/app');
const cryptoUtil = require('./src/utils/crypto.util');
const googleConfigRepository = require('./src/repositories/googleConfig.repository');
const documentCaShareRepository = require('./src/repositories/documentCaShare.repository');
const documentRepository = require('./src/repositories/document.repository');
const userRepository = require('./src/repositories/user.repository');
const { Role } = require('./src/enums');
const { generateAccessToken } = require('./src/utils/jwt.util');
const { RoverLedgers } = require('./src/models');
const { inArray } = require('drizzle-orm');
const { pool, testConnection, db } = require('./src/db');

async function runGoogleDriveTests() {
  console.log('🧪 Starting Rover Ledger Google Drive Integration Test Suite...\n');
  await testConnection();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5006, resolve));
  const baseUrl = 'http://localhost:5006';

  const makeRequest = (path, method = 'GET', body = null, token = null) => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const req = http.request(
        url,
        {
          method,
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(data) });
            } catch (e) {
              resolve({ status: res.statusCode, raw: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  };

  const createdUserIds = [];

  try {
    // Seed test Admin and User for role verification
    const testAdmin = await userRepository.createUser({
      FirstName: 'DriveAdmin',
      LastName: 'Tester',
      Email: `driveadmin.${Date.now()}@roverledger.com`,
      Role: Role.ADMIN,
      isActive: true,
    });
    createdUserIds.push(testAdmin.UserId);

    const testUser = await userRepository.createUser({
      FirstName: 'DriveUser',
      LastName: 'Tester',
      Email: `driveuser.${Date.now()}@roverledger.com`,
      Role: Role.USER,
      isActive: true,
    });
    createdUserIds.push(testUser.UserId);

    const adminToken = generateAccessToken({ UserId: testAdmin.UserId, Email: testAdmin.Email, Role: testAdmin.Role });
    const userToken = generateAccessToken({ UserId: testUser.UserId, Email: testUser.Email, Role: testUser.Role });

    // 1. Test Crypto Util (AES-256-GCM encryption & decryption)
    console.log('1️⃣ Testing AES-256-GCM Token Encryption & Decryption...');
    const sampleToken = '1//0gA1b2c3d4e5f6g7h8i9j0k_sample_refresh_token_xyz';
    const encrypted = cryptoUtil.encryptToken(sampleToken);
    const decrypted = cryptoUtil.decryptToken(encrypted);
    if (decrypted !== sampleToken) {
      throw new Error(`Crypto round-trip mismatch: expected ${sampleToken}, got ${decrypted}`);
    }
    console.log('   Encrypted format:', encrypted);
    console.log('   Decrypted text matches exactly:', decrypted === sampleToken);
    console.log('   ✅ Crypto Util test passed.\n');

    // 2. Test GET /auth/google/connect role restrictions
    console.log('2️⃣ Testing Google OAuth Connect Access Control (Admin Only)...');
    // 2a. Unauthenticated -> 401
    const unauthRes = await makeRequest('/auth/google/connect?redirect=false');
    if (unauthRes.status !== 401) throw new Error(`Expected 401 for unauthenticated connect, got ${unauthRes.status}`);
    console.log('   ✅ Unauthenticated request correctly rejected with 401');

    // 2b. Role: User -> 403 Forbidden
    const userForbiddenRes = await makeRequest('/auth/google/connect?redirect=false', 'GET', null, userToken);
    if (userForbiddenRes.status !== 403) throw new Error(`Expected 403 for User role connect, got ${userForbiddenRes.status}`);
    console.log('   ✅ Regular User request correctly rejected with 403 Forbidden');

    // 2c. Role: Admin -> 200 OK + authUrl
    const adminConnectRes = await makeRequest('/auth/google/connect?redirect=false', 'GET', null, adminToken);
    if (adminConnectRes.status !== 200 || !adminConnectRes.data?.data?.authUrl) {
      throw new Error('Failed to generate Google OAuth connect URL for Admin');
    }
    const authUrl = adminConnectRes.data.data.authUrl;
    if (!authUrl.includes('accounts.google.com') || !authUrl.includes('drive.file') || !authUrl.includes('access_type=offline')) {
      throw new Error('Google OAuth URL is missing mandatory parameters');
    }
    console.log('   ✅ Admin role successfully authorized (200 OK with authUrl).\n');

    // 3. Test GET /auth/google/status
    console.log('3️⃣ Testing Google Drive Connection Status (GET /auth/google/status)...');
    const statusRes = await makeRequest('/auth/google/status');
    console.log('   Status response:', statusRes.data);
    if (statusRes.status !== 200 || !statusRes.data?.success) {
      throw new Error('Failed to get Google Drive connection status');
    }
    console.log('   ✅ Google Drive status endpoint passed.\n');

    // 4. Test Sharing when Google Drive is disconnected
    console.log('4️⃣ Testing Share with CA error handling when disconnected...');
    // Ensure disconnected state for test
    await googleConfigRepository.disconnect();
    
    // Create a temporary document in DB
    const tempDoc = await documentRepository.createDocument({
      documentName: 'Test Unconnected Invoice',
      documentType: 'expense',
      fileSize: 1024,
      fileType: 'application/pdf',
      documentDate: new Date(),
      oneDriveItemId: '01TESTITEMDISCONNECTED',
      originalFileName: 'test_unconnected.pdf',
    });

    // Unauthenticated request must return 401
    const unauthShareRes = await makeRequest(`/documents/${tempDoc.id}/share-to-ca`, 'POST');
    if (unauthShareRes.status !== 401) {
      throw new Error(`Expected 401 Unauthorized for unauthenticated share-to-ca, got ${unauthShareRes.status}`);
    }
    console.log('   ✅ Unauthenticated share-to-ca request correctly rejected with 401');

    const shareFailRes = await makeRequest(`/documents/${tempDoc.id}/share-to-ca`, 'POST', null, userToken);
    console.log('   Share response status (expected 400):', shareFailRes.status);
    console.log('   Error message:', shareFailRes.data?.message);
    if (shareFailRes.status !== 400 || !shareFailRes.data?.message?.includes('Google Drive is not connected')) {
      throw new Error('Expected 400 error indicating Google Drive is not connected');
    }
    console.log('   ✅ Disconnected state properly guarded with 400 status.\n');

    // 5. Test Embedded Share Status in GET /documents and GET /documents/:id
    console.log('5️⃣ Testing Embedded isSharedWithCa, sharedWithCaAt, and view links in document queries...');
    const singleDocRes = await makeRequest(`/documents/${tempDoc.id}`);
    console.log('   Single doc response isSharedWithCa:', singleDocRes.data?.data?.isSharedWithCa);
    if (singleDocRes.data?.data?.isSharedWithCa !== false) {
      throw new Error('Expected isSharedWithCa to be false for unshared document');
    }
    if (singleDocRes.data?.data?.sharedWithCaAt !== null) {
      throw new Error('Expected sharedWithCaAt to be null for unshared document');
    }
    console.log('   ✅ Document Details correctly enriched with Google Drive CA share properties.\n');

    // 6. Test Idempotency with existing share record & Database Unique Constraint
    console.log('6️⃣ Testing Share with CA Idempotency & Database Unique Constraint...');
    // Manually record a share in DocumentCaShares
    const mockShare = await documentCaShareRepository.createShare({
      documentId: tempDoc.id,
      googleDriveFileId: '1mockGoogleFileId123456789',
      googleDriveWebViewLink: 'https://drive.google.com/file/d/1mockGoogleFileId123456789/view',
      caEmail: 'ca.auditor@test.com',
      sharedByUserId: null,
    });
    console.log('   Seeded mock share record:', mockShare);

    // Verify DB unique constraint rejects duplicate insert on documentId
    try {
      await documentCaShareRepository.createShare({
        documentId: tempDoc.id,
        googleDriveFileId: '2mockGoogleFileId999999999',
        googleDriveWebViewLink: 'https://drive.google.com/file/d/2mock/view',
        caEmail: 'ca.auditor@test.com',
        sharedByUserId: null,
      });
      throw new Error('Expected duplicate createShare to fail due to DB unique constraint');
    } catch (dbErr) {
      if (dbErr.message.includes('Expected duplicate createShare to fail')) throw dbErr;
      console.log('   ✅ Database unique constraint correctly prevented duplicate share record insert:', dbErr.message);
    }

    // Now call POST /documents/:id/share-to-ca with userToken
    const idempotentShareRes = await makeRequest(`/documents/${tempDoc.id}/share-to-ca`, 'POST', null, userToken);
    console.log('   Idempotent share status:', idempotentShareRes.status);
    console.log('   Idempotent message:', idempotentShareRes.data?.message);
    console.log('   Already shared flag:', idempotentShareRes.data?.data?.alreadyShared);
    if (idempotentShareRes.status !== 200 || idempotentShareRes.data?.data?.alreadyShared !== true) {
      throw new Error('Expected idempotent response with alreadyShared = true');
    }

    // Check GET /documents/:id again - should now show isSharedWithCa: true
    const updatedDocRes = await makeRequest(`/documents/${tempDoc.id}`);
    console.log('   Updated single doc isSharedWithCa:', updatedDocRes.data?.data?.isSharedWithCa);
    console.log('   Updated single doc googleDriveViewUrl:', updatedDocRes.data?.data?.googleDriveViewUrl);
    if (updatedDocRes.data?.data?.isSharedWithCa !== true) {
      throw new Error('Expected isSharedWithCa to be true after sharing');
    }
    if (updatedDocRes.data?.data?.googleDriveFileId !== '1mockGoogleFileId123456789') {
      throw new Error('Expected googleDriveFileId to match mock share');
    }
    console.log('   ✅ Idempotency and document enrichment verified.\n');

    // 6b. Test Filter by isSharedWithCa (POST /documents/filter)
    console.log('6️⃣b Testing Filter by isSharedWithCa: true and false...');
    const filterSharedRes = await makeRequest('/documents/filter', 'POST', {
      isSharedWithCa: true,
    });
    console.log('   Filter isSharedWithCa: true returned rows count:', filterSharedRes.data?.data?.rows?.length);
    const foundInShared = filterSharedRes.data?.data?.rows?.some(r => r.id === tempDoc.id);
    if (!foundInShared) {
      throw new Error('Expected tempDoc to be included in isSharedWithCa: true filter results');
    }

    const filterUnsharedRes = await makeRequest('/documents/filter', 'POST', {
      isSharedWithCa: false,
    });
    console.log('   Filter isSharedWithCa: false returned rows count:', filterUnsharedRes.data?.data?.rows?.length);
    const foundInUnshared = filterUnsharedRes.data?.data?.rows?.some(r => r.id === tempDoc.id);
    if (foundInUnshared) {
      throw new Error('Expected tempDoc to NOT be included in isSharedWithCa: false filter results');
    }
    console.log('   ✅ Filter by isSharedWithCa (true/false) verified successfully.\n');

    // 7. Test Disconnect endpoint access control
    console.log('7️⃣ Testing POST /auth/google/disconnect Access Control (Admin Only)...');
    // 7a. Unauthenticated -> 401
    const unauthDiscRes = await makeRequest('/auth/google/disconnect', 'POST');
    if (unauthDiscRes.status !== 401) throw new Error(`Expected 401 for unauthenticated disconnect, got ${unauthDiscRes.status}`);
    console.log('   ✅ Unauthenticated request correctly rejected with 401');

    // 7b. Role: User -> 403 Forbidden
    const userDiscRes = await makeRequest('/auth/google/disconnect', 'POST', null, userToken);
    if (userDiscRes.status !== 403) throw new Error(`Expected 403 for User role disconnect, got ${userDiscRes.status}`);
    console.log('   ✅ Regular User disconnect correctly rejected with 403 Forbidden');

    // 7c. Role: Admin -> 200 OK
    const adminDiscRes = await makeRequest('/auth/google/disconnect', 'POST', null, adminToken);
    console.log('   Disconnect response:', adminDiscRes.data);
    if (adminDiscRes.status !== 200) {
      throw new Error('Failed to disconnect Google Drive for Admin');
    }
    const finalStatus = await makeRequest('/auth/google/status');
    if (finalStatus.data?.data?.isConnected !== false) {
      throw new Error('Expected isConnected to be false after disconnect');
    }
    console.log('   ✅ Google Drive disconnect endpoint verified with Admin role.\n');

    // Clean up temporary test document from DB
    await documentRepository.softDelete(tempDoc.id);

    console.log('🎉 ALL GOOGLE DRIVE INTEGRATION TESTS PASSED SUCCESSFULLY! 🚀\n');
  } catch (err) {
    console.error('❌ Google Drive test failed:', err);
    process.exit(1);
  } finally {
    if (createdUserIds.length > 0) {
      await db.delete(RoverLedgers).where(inArray(RoverLedgers.UserId, createdUserIds));
    }
    server.close();
    await pool.end();
  }
}

runGoogleDriveTests();
