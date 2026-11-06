const axios = require('axios');
const { env } = require('../configs/env');
const cryptoUtil = require('../utils/crypto.util');
const googleConfigRepository = require('../repositories/googleConfig.repository');

// In-memory cache for Google OAuth access token
let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Service for Google OAuth 2.0 and Google Drive API integration
 */
class GoogleDriveService {
  /**
   * Generates Google OAuth 2.0 authorization URL for connecting company Google account
   * @param {string|object} state - Optional state parameter for CSRF verification
   * @returns {string} Google authorization URL
   */
  getAuthorizationUrl(state = 'rover_ledger_google_auth') {
    if (!env.googleClientId) {
      throw new Error('Google Client ID is not configured in environment variables.');
    }

    const stateParam = typeof state === 'object' ? JSON.stringify(state) : String(state);

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: 'code',
      // Minimal needed scopes: create/manage files created by app + read basic email identity
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid',
      access_type: 'offline', // Mandatory to obtain refresh_token
      prompt: 'consent', // Mandatory so Google issues a refresh_token every time during testing/connect
      include_granted_scopes: 'true',
      state: stateParam,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges authorization code for Google access token and refresh token
   * @param {string} code - Authorization code from Google OAuth redirect
   * @param {string|null} customRedirectUri - Optional redirect URI override
   * @returns {Promise<{ accessToken: string, refreshToken: string, email: string, expiresIn: number }>}
   */
  async exchangeCodeForTokens(code, customRedirectUri = null) {
    if (!code) {
      const err = new Error('Authorization code is required.');
      err.statusCode = 400;
      throw err;
    }

    const redirectUri = customRedirectUri || env.googleRedirectUri;
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      // Fetch authorized user's email address
      let email = 'unknown@google.com';
      try {
        const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (userInfoRes.data?.email) {
          email = userInfoRes.data.email;
        }
      } catch (userErr) {
        console.warn('[Google UserInfo Warning]:', userErr.message);
      }

      return {
        accessToken: access_token,
        refreshToken: refresh_token || null,
        email,
        expiresIn: expires_in || 3600,
      };
    } catch (error) {
      const errorData = error.response ? error.response.data : error.message;
      console.error('[Google Token Exchange Error]:', errorData);
      const err = new Error(
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        'Failed to exchange authorization code for Google tokens.'
      );
      err.statusCode = 400;
      throw err;
    }
  }

  /**
   * Refreshes an expired Google access token using the encrypted refresh token
   * @param {string} encryptedRefreshToken
   * @returns {Promise<{ accessToken: string, expiresIn: number }>}
   */
  async refreshAccessToken(encryptedRefreshToken) {
    if (!encryptedRefreshToken) {
      const err = new Error('Encrypted refresh token is missing.');
      err.statusCode = 400;
      throw err;
    }

    const decryptedRefreshToken = cryptoUtil.decryptToken(encryptedRefreshToken);
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          refresh_token: decryptedRefreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in || 3600,
      };
    } catch (error) {
      const errorData = error.response ? error.response.data : error.message;
      console.error('[Google Token Refresh Error]:', errorData);
      const err = new Error(
        error.response?.data?.error_description ||
        'Google token refresh failed. Please reconnect Google Drive in Profile.'
      );
      err.statusCode = 401;
      throw err;
    }
  }

  /**
   * Obtains a valid Google Drive access token, automatically refreshing when needed
   * @returns {Promise<string>} Valid Google Drive Access Token
   */
  async getValidAccessToken() {
    const now = Math.floor(Date.now() / 1000);

    // Return in-memory cached token if valid for at least 5 more minutes
    if (cachedAccessToken && tokenExpiresAt > now + 300) {
      return cachedAccessToken;
    }

    const activeConfig = await googleConfigRepository.getActiveConfig();
    if (!activeConfig || !activeConfig.encryptedRefreshToken) {
      const err = new Error(
        'Company Google Drive is not connected. Please connect Google Drive in the Profile screen first.'
      );
      err.statusCode = 400;
      throw err;
    }

    const { accessToken, expiresIn } = await this.refreshAccessToken(activeConfig.encryptedRefreshToken);
    cachedAccessToken = accessToken;
    tokenExpiresAt = now + expiresIn;

    return cachedAccessToken;
  }

  /**
   * Clears the in-memory cached token (useful upon disconnect or re-auth)
   */
  clearCachedToken() {
    cachedAccessToken = null;
    tokenExpiresAt = 0;
  }

  /**
   * Checks if existing CA folder exists in Google Drive, or creates and shares it with CA
   * @param {object} params
   * @param {string} params.accessToken - Valid Google access token
   * @param {string|null} params.existingFolderId - Known folder ID if already saved
   * @param {string} params.caEmail - CA's email address for folder permissions
   * @returns {Promise<string>} Valid Google Drive Folder ID
   */
  async ensureCaFolderExists({ accessToken, existingFolderId, caEmail }) {
    // 1. Verify existing folder if ID is provided
    if (existingFolderId) {
      try {
        const folderRes = await axios.get(
          `https://www.googleapis.com/drive/v3/files/${existingFolderId}?fields=id,name,trashed`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (folderRes.data && !folderRes.data.trashed) {
          return existingFolderId;
        }
      } catch (checkErr) {
        console.warn(`[Google Drive Folder Check]: Folder ${existingFolderId} not accessible, creating new one:`, checkErr.message);
      }
    }

    // 2. Create the target folder in Google Drive
    const folderName = 'Rover Ledger - CA Invoices';
    try {
      const createRes = await axios.post(
        'https://www.googleapis.com/drive/v3/files',
        {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const folderId = createRes.data.id;
      console.log(`📁 Created CA Folder in Google Drive with ID: ${folderId}`);

      // 3. Share folder with CA email (role: reader)
      const targetCaEmail = caEmail || env.caEmailDefault;
      if (targetCaEmail) {
        try {
          await axios.post(
            `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?sendNotificationEmail=false`,
            {
              role: 'reader',
              type: 'user',
              emailAddress: targetCaEmail,
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log(`🤝 Shared Google Drive folder ${folderId} with CA: ${targetCaEmail} (role: reader)`);
        } catch (shareErr) {
          console.error(`[Google Drive Share Permission Warning]: Could not share with ${targetCaEmail}:`, shareErr.response?.data || shareErr.message);
        }
      }

      return folderId;
    } catch (createErr) {
      const errorData = createErr.response ? createErr.response.data : createErr.message;
      console.error('[Google Drive Folder Creation Error]:', errorData);
      throw new Error('Failed to create or configure CA invoices folder in Google Drive.');
    }
  }

  /**
   * Uploads a file buffer into a specific Google Drive folder using standard multipart upload
   * @param {object} params
   * @param {string} params.accessToken - Valid Google access token
   * @param {string} params.folderId - Target Google Drive folder ID
   * @param {string} params.fileName - Name of file to save as
   * @param {string} params.mimeType - MIME type (e.g. application/pdf)
   * @param {Buffer} params.buffer - File binary content
   * @returns {Promise<{ id: string, name: string, webViewLink: string }>}
   */
  async uploadFileToFolder({ accessToken, folderId, fileName, mimeType, buffer }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      const err = new Error('File buffer is required for Google Drive upload.');
      err.statusCode = 400;
      throw err;
    }

    const sanitizedFileName = (fileName || 'invoice.pdf').replace(/[/\\?%*:|"<>]/g, '_');
    const finalMimeType = mimeType || 'application/pdf';

    const boundary = '-------rover_ledger_' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: sanitizedFileName,
      parents: folderId ? [folderId] : undefined,
    };

    const multipartBody = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${finalMimeType}\r\n\r\n`
      ),
      buffer,
      Buffer.from(closeDelimiter),
    ]);

    const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink';

    try {
      const response = await axios.post(uploadUrl, multipartBody, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': multipartBody.length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const item = response.data;
      return {
        id: item.id,
        name: item.name,
        webViewLink: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
        webContentLink: item.webContentLink || null,
      };
    } catch (uploadErr) {
      const errorData = uploadErr.response ? uploadErr.response.data : uploadErr.message;
      console.error('[Google Drive Upload Error]:', errorData);
      throw new Error(
        uploadErr.response?.data?.error?.message ||
        'Failed to upload invoice PDF to Google Drive.'
      );
    }
  }

  /**
   * Retrieves connection status of Google Drive
   * @returns {Promise<{ isConnected: boolean, googleEmail: string|null, caEmail: string|null, targetFolderId: string|null }>}
   */
  async getConnectionStatus() {
    const config = await googleConfigRepository.getActiveConfig();
    return {
      isConnected: Boolean(config && config.isConnected),
      googleEmail: config?.googleEmail || null,
      caEmail: config?.caEmail || env.caEmailDefault,
      targetFolderId: config?.targetFolderId || null,
    };
  }
}

module.exports = new GoogleDriveService();

