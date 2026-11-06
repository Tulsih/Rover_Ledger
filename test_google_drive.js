const http = require('http');
const app = require('./src/app');
const cryptoUtil = require('./src/utils/crypto.util');
const googleConfigRepository = require('./src/repositories/googleConfig.repository');
const documentCaShareRepository = require('./src/repositories/documentCaShare.repository');
const documentRepository = require('./src/repositories/document.repository');
const { pool, testConnection } = require('./src/db');

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

  try {
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

    // 2. Test GET /auth/google/connect?redirect=false
    console.log('2️⃣ Testing Google OAuth Connect URL Generation (GET /auth/google/connect?redirect=false)...');
    const connectRes = await makeRequest('/auth/google/connect?redirect=false');
    console.log('   Connect response status:', connectRes.status);
    console.log('   Generated authUrl:', connectRes.data?.data?.authUrl);
    if (connectRes.status !== 200 || !connectRes.data?.data?.authUrl) {
      throw new Error('Failed to generate Google OAuth connect URL');
    }
    const authUrl = connectRes.data.data.authUrl;
    if (!authUrl.includes('accounts.google.com') || !authUrl.includes('drive.file') || !authUrl.includes('access_type=offline')) {
      throw new Error('Google OAuth URL is missing mandatory parameters');
    }
    console.log('   ✅ Google Connect URL generation passed.\n');

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

    const shareFailRes = await makeRequest(`/documents/${tempDoc.id}/share-to-ca`, 'POST');
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

    // 6. Test Idempotency with existing share record
    console.log('6️⃣ Testing Share with CA Idempotency...');
    // Manually record a share in DocumentCaShares
    const mockShare = await documentCaShareRepository.createShare({
      documentId: tempDoc.id,
      googleDriveFileId: '1mockGoogleFileId123456789',
      googleDriveWebViewLink: 'https://drive.google.com/file/d/1mockGoogleFileId123456789/view',
      caEmail: 'ca.auditor@test.com',
      sharedByUserId: null,
    });
    console.log('   Seeded mock share record:', mockShare);

    // Now call POST /documents/:id/share-to-ca
    const idempotentShareRes = await makeRequest(`/documents/${tempDoc.id}/share-to-ca`, 'POST');
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

    // 7. Test Disconnect endpoint
    console.log('7️⃣ Testing POST /auth/google/disconnect...');
    const disconnectRes = await makeRequest('/auth/google/disconnect', 'POST');
    console.log('   Disconnect response:', disconnectRes.data);
    if (disconnectRes.status !== 200) {
      throw new Error('Failed to disconnect Google Drive');
    }
    const finalStatus = await makeRequest('/auth/google/status');
    if (finalStatus.data?.data?.isConnected !== false) {
      throw new Error('Expected isConnected to be false after disconnect');
    }
    console.log('   ✅ Google Drive disconnect endpoint verified.\n');

    // Clean up temporary test document from DB
    await documentRepository.softDelete(tempDoc.id);

    console.log('🎉 ALL GOOGLE DRIVE INTEGRATION TESTS PASSED SUCCESSFULLY! 🚀\n');
  } catch (err) {
    console.error('❌ Google Drive test failed:', err);
    process.exit(1);
  } finally {
    server.close();
    await pool.end();
  }
}

runGoogleDriveTests();
