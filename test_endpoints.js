const http = require('http');
const app = require('./src/app');
const userRepository = require('./src/repositories/user.repository');
const { generateToken } = require('./src/utils/jwt.util');
const { getMicrosoftAuthUrl } = require('./src/utils/microsoft.util');
const { pool } = require('./src/db');

async function runTests() {
  console.log('🧪 Starting Rover Ledger End-to-End Test Suite...\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5005, resolve));
  const baseUrl = 'http://localhost:5005';

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
    // 1. Test Root / Health
    console.log('1️⃣ Testing Server Health & Info Endpoints...');
    const healthRes = await makeRequest('/health');
    console.log('   Health check response:', healthRes.data);
    if (healthRes.status !== 200 || healthRes.data.status !== 'healthy') throw new Error('Health check failed');
    console.log('   ✅ Health endpoint passed.\n');

    // 2. Test Microsoft Auth URL generation
    console.log('2️⃣ Testing Microsoft OAuth URL Generation...');
    const msUrl = getMicrosoftAuthUrl();
    console.log('   Generated Microsoft OAuth URL:', msUrl);
    if (!msUrl.includes('c82efa2d-bb5b-4a0d-b933-48161ad556cd') || !msUrl.includes('b8634db0-771b-4791-8274-a289121bec0a')) {
      throw new Error('Microsoft OAuth URL missing client or tenant ID');
    }
    const msUrlRes = await makeRequest('/auth/microsoft?redirect=false');
    console.log('   API Microsoft Login URL response:', msUrlRes.data);
    if (msUrlRes.status !== 200 || !msUrlRes.data.success) throw new Error('Failed to get login URL from API');
    console.log('   ✅ Microsoft OAuth URL endpoint passed.\n');

    // 3. Test Database Insertion & Repository
    console.log('3️⃣ Testing Rover_ledgers Repository & Database Table Fields...');
    const testEmail = `testuser_${Date.now()}@example.com`;
    const createdUser = await userRepository.createUser({
      FirstName: 'John',
      LastName: 'Doe',
      Email: testEmail,
      Gender: 'Male',
      Role: 'User',
      Designation: 'Senior Accountant',
      FullName: 'John Doe',
      isActive: true,
      SoftDelete: false,
    });

    console.log('   Created User in Rover_ledgers table:', createdUser);
    const requiredFields = [
      'UserId', 'FirstName', 'LastName', 'Email', 'Gender',
      'Role', 'CreatedAt', 'UpdatedAt', 'Designation', 'FullName',
      'isActive', 'SoftDelete'
    ];
    for (const field of requiredFields) {
      if (createdUser[field] === undefined) {
        throw new Error(`Missing required field in Rover_ledgers table: ${field}`);
      }
    }
    console.log('   ✅ All 12 requested fields exist and are stored correctly.\n');

    // 4. Test Profile Fetch API (API 2)
    console.log('4️⃣ Testing API 2: Profile Fetch (GET /users/profile)...');
    const userToken = generateToken({
      UserId: createdUser.UserId,
      Email: createdUser.Email,
      Role: createdUser.Role,
    });

    // Unauthenticated request should return 401
    const unauthFetch = await makeRequest('/users/profile');
    if (unauthFetch.status !== 401) throw new Error('Expected 401 for unauthenticated profile fetch');
    console.log('   ✅ Protected endpoint correctly rejected unauthenticated request (401).');

    // Authenticated request
    const profileRes = await makeRequest('/users/profile', 'GET', null, userToken);
    console.log('   Profile fetch response:', profileRes.data);
    if (profileRes.status !== 200 || !profileRes.data.success || profileRes.data.data.Email !== testEmail) {
      throw new Error('Profile fetch failed');
    }
    console.log('   ✅ Profile fetch endpoint passed (200 OK).\n');

    // 5. Test Profile Update API (API 3)
    console.log('5️⃣ Testing API 3: Profile Update (PUT /users/profile)...');
    const updatePayload = {
      FirstName: 'Jonathan',
      LastName: 'Smith',
      Gender: 'Male',
      Designation: 'Lead Financial Auditor',
    };
    const updateRes = await makeRequest('/users/profile', 'PUT', updatePayload, userToken);
    console.log('   Profile update response:', updateRes.data);
    if (
      updateRes.status !== 200 ||
      !updateRes.data.success ||
      updateRes.data.data.FirstName !== 'Jonathan' ||
      updateRes.data.data.LastName !== 'Smith' ||
      updateRes.data.data.FullName !== 'Jonathan Smith' ||
      updateRes.data.data.Designation !== 'Lead Financial Auditor'
    ) {
      throw new Error('Profile update failed');
    }
    console.log('   ✅ Profile update endpoint passed (200 OK).\n');

    // 6. Test Login with Microsoft endpoint validation (API 1)
    console.log('6️⃣ Testing API 1: Microsoft Login Validation (POST /auth/microsoft)...');
    const emptyLoginRes = await makeRequest('/auth/microsoft', 'POST', {});
    console.log('   Empty payload response:', emptyLoginRes.data);
    if (emptyLoginRes.status !== 400 || emptyLoginRes.data.success !== false) {
      throw new Error('Expected 400 validation error for empty login payload');
    }
    console.log('   ✅ Microsoft login validation properly checked for code/accessToken.\n');

    // 7. Test Logout & Re-login Reactivation Flow
    console.log('7️⃣ Testing API 4: Logout & Re-login Reactivation Flow...');
    
    // Initial login via dummy code (User: Shraddha Chauhan)
    const initialLoginRes = await makeRequest('/auth/microsoft', 'POST', { code: 'shraddha' });
    if (initialLoginRes.status !== 200 || !initialLoginRes.data.success) {
      throw new Error('Initial login failed');
    }
    const initialUserId = initialLoginRes.data.data.user.UserId;
    const initialToken = initialLoginRes.data.data.token;
    console.log(`   Initial login succeeded for Shraddha (UserId: ${initialUserId}, isActive: ${initialLoginRes.data.data.user.isActive})`);

    // Perform Logout via POST /auth/logout
    const logoutRes = await makeRequest('/auth/logout', 'POST', null, initialToken);
    console.log('   Logout response:', logoutRes.data);
    if (logoutRes.status !== 200 || !logoutRes.data.success || logoutRes.data.data.isActive !== false) {
      throw new Error('Logout failed or isActive was not set to false');
    }
    console.log('   ✅ Logout successfully marked isActive = false in database.');

    // Verify profile fetch rejects inactive / logged out session
    const inactiveFetchRes = await makeRequest('/users/profile', 'GET', null, initialToken);
    if ((inactiveFetchRes.status !== 400 && inactiveFetchRes.status !== 404) || inactiveFetchRes.data.success !== false) {
      throw new Error(`Expected profile fetch to fail while user is logged out, got status ${inactiveFetchRes.status}`);
    }
    console.log(`   ✅ Profile fetch correctly rejected for logged out user (status: ${inactiveFetchRes.status}, message: "${inactiveFetchRes.data.message}").`);

    // Re-login with Microsoft: existing user should NOT be duplicated, should get same UserId, and isActive set to true
    const reloginRes = await makeRequest('/auth/microsoft', 'POST', { code: 'shraddha' });
    if (reloginRes.status !== 200 || !reloginRes.data.success) {
      throw new Error('Re-login failed');
    }
    const reloginUserId = reloginRes.data.data.user.UserId;
    const reloginIsActive = reloginRes.data.data.user.isActive;
    const reloginToken = reloginRes.data.data.token;
    console.log(`   Re-login succeeded (UserId: ${reloginUserId}, isActive: ${reloginIsActive})`);

    if (reloginUserId !== initialUserId) {
      throw new Error(`Duplicate record created! Original UserId: ${initialUserId}, New UserId: ${reloginUserId}`);
    }
    if (reloginIsActive !== true) {
      throw new Error('Re-login failed to reactivate user (isActive is not true)');
    }
    console.log('   ✅ Existing user successfully reactivated with the SAME UserId and isActive = true.');

    // Verify user can now fetch profile again with new token
    const newProfileRes = await makeRequest('/users/profile', 'GET', null, reloginToken);
    if (newProfileRes.status !== 200 || !newProfileRes.data.success) {
      throw new Error('Failed to fetch profile after re-login reactivation');
    }
    console.log('   ✅ Profile fetch succeeded after re-login reactivation.\n');

    // 8. Test Profile Persistence Across Logout & Re-login (Prevent Microsoft Overwrite)
    console.log('8️⃣ Testing Profile Persistence Across Logout & Re-Login (Prevent Overwrite)...');
    
    // Update user profile to custom values
    const customProfilePayload = {
      FirstName: 'Shraddha-Updated',
      LastName: 'Chauhan-Updated',
      Designation: 'Lead Architect',
      Gender: 'Female',
    };
    const customUpdateRes = await makeRequest('/users/profile', 'PUT', customProfilePayload, reloginToken);
    if (
      customUpdateRes.status !== 200 ||
      customUpdateRes.data.data.FirstName !== 'Shraddha-Updated' ||
      customUpdateRes.data.data.LastName !== 'Chauhan-Updated' ||
      customUpdateRes.data.data.FullName !== 'Shraddha-Updated Chauhan-Updated' ||
      customUpdateRes.data.data.Designation !== 'Lead Architect'
    ) {
      throw new Error('Failed to set custom profile details before logout test');
    }
    console.log('   ✅ Profile successfully updated to custom values in Rover Ledger.');

    // Logout
    const logoutRes2 = await makeRequest('/auth/logout', 'POST', null, reloginToken);
    if (logoutRes2.status !== 200 || logoutRes2.data.data.isActive !== false) {
      throw new Error('Logout failed during profile persistence test');
    }
    console.log('   ✅ User successfully logged out (isActive: false).');

    // Re-login with Microsoft (dummy profile has original "Shraddha", "Chauhan", "Software Engineer")
    const reloginRes2 = await makeRequest('/auth/microsoft', 'POST', { code: 'shraddha' });
    if (reloginRes2.status !== 200 || !reloginRes2.data.success) {
      throw new Error('Re-login failed during profile persistence test');
    }

    const reloadedUser = reloginRes2.data.data.user;
    console.log('   Re-login returned user profile:', {
      FirstName: reloadedUser.FirstName,
      LastName: reloadedUser.LastName,
      FullName: reloadedUser.FullName,
      Designation: reloadedUser.Designation,
    });

    if (
      reloadedUser.FirstName !== 'Shraddha-Updated' ||
      reloadedUser.LastName !== 'Chauhan-Updated' ||
      reloadedUser.FullName !== 'Shraddha-Updated Chauhan-Updated' ||
      reloadedUser.Designation !== 'Lead Architect'
    ) {
      throw new Error('BUG DETECTED: Profile details were overwritten by Microsoft OAuth details on re-login!');
    }
    console.log('   ✅ Re-login response strictly preserved custom updated profile details.');

    // Verify GET /users/profile also reflects the preserved details
    const finalProfileRes = await makeRequest('/users/profile', 'GET', null, reloginRes2.data.data.token);
    if (
      finalProfileRes.status !== 200 ||
      finalProfileRes.data.data.FirstName !== 'Shraddha-Updated' ||
      finalProfileRes.data.data.LastName !== 'Chauhan-Updated'
    ) {
      throw new Error('Profile fetch after re-login did not return preserved custom details');
    }
    console.log('   ✅ Profile fetch verified: Database retains updated profile across sessions without being overwritten.\n');

    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! Everything is functioning properly.\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    await pool.end();
  }
}

runTests();
