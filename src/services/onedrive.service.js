const axios = require('axios');
const { env } = require('../configs/env');

const CLIENT_ID = env.microsoftClientId;
const TENANT_ID = env.microsoftTenantId;
const CLIENT_SECRET = env.microsoftClientSecret;
const DRIVE_ID = env.microsoftDriveId;
const FOLDER_ID = env.microsoftFolderId;

// In-memory cache for Microsoft Graph application access token
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Standard error extractor for Microsoft Graph API requests
 */
const handleGraphError = (error, defaultMessage, tag = 'OneDrive') => {
  const errorDetails = error.response ? error.response.data : error.message;
  console.error(`[${tag} Error]:`, errorDetails);
  throw new Error(
    error.response?.data?.error?.message ||
    error.response?.data?.error_description ||
    defaultMessage
  );
};

/**
 * Obtains an application access token from Microsoft Entra ID using Client Credentials Grant.
 * Caches token in memory and refreshes automatically when expiring within 5 minutes.
 * 
 * @returns {Promise<string>} Valid Microsoft Graph Access Token
 */
const getGraphAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if valid for at least 5 more minutes
  if (cachedToken && tokenExpiresAt > now + 300) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const bodyParams = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  try {
    const response = await axios.post(tokenUrl, bodyParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    cachedToken = response.data.access_token;
    tokenExpiresAt = now + (response.data.expires_in || 3600);
    return cachedToken;
  } catch (error) {
    handleGraphError(error, 'Failed to obtain access token from Microsoft Entra ID', 'Microsoft Graph Auth');
  }
};

/**
 * Uploads a file buffer directly to the specified folder in Microsoft OneDrive / SharePoint
 * 
 * @param {object} params
 * @param {string} params.fileName - Target file name to save as in OneDrive
 * @param {Buffer} params.buffer - File binary content
 * @param {string} params.mimeType - Content-Type / MIME type of the file
 * @returns {Promise<object>} Uploaded item metadata from Microsoft Graph
 */
const uploadFileToOneDrive = async ({ fileName, buffer, mimeType }) => {
  const token = await getGraphAccessToken();

  // Sanitize file name for OneDrive compatibility
  const sanitizedFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
  const encodedFileName = encodeURIComponent(sanitizedFileName);

  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}:/${encodedFileName}:/content`;

  try {
    const response = await axios.put(uploadUrl, buffer, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType || 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const item = response.data;
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      webUrl: item.webUrl,
      downloadUrl: item['@microsoft.graph.downloadUrl'] || null,
      createdDateTime: item.createdDateTime,
      lastModifiedDateTime: item.lastModifiedDateTime,
    };
  } catch (error) {
    handleGraphError(error, 'Failed to upload file to Microsoft OneDrive', 'OneDrive File Upload');
  }
};

/**
 * Retrieves file metadata from Microsoft OneDrive by item ID
 * 
 * @param {string} itemId - OneDrive item ID
 * @returns {Promise<object>} Item metadata
 */
const getFileMetadataFromOneDrive = async (itemId) => {
  const token = await getGraphAccessToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const item = response.data;
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      webUrl: item.webUrl,
      downloadUrl: item['@microsoft.graph.downloadUrl'] || null,
      mimeType: item.file?.mimeType || null,
    };
  } catch (error) {
    handleGraphError(error, 'Failed to get document metadata from Microsoft OneDrive', 'OneDrive Get Metadata');
  }
};

/**
 * Fetches file content stream from Microsoft OneDrive
 * 
 * @param {string} itemId - OneDrive item ID
 * @returns {Promise<{ stream: stream.Readable, contentType: string, contentLength: number }>}
 */
const getFileStreamFromOneDrive = async (itemId) => {
  const token = await getGraphAccessToken();
  const contentUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}/content`;

  try {
    const response = await axios.get(contentUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: 'stream',
      maxRedirects: 5,
    });

    return {
      stream: response.data,
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
    };
  } catch (error) {
    handleGraphError(error, 'Failed to fetch document content from Microsoft OneDrive', 'OneDrive Get Content');
  }
};

/**
 * Deletes a file from Microsoft OneDrive
 * 
 * @param {string} itemId - OneDrive item ID
 * @returns {Promise<boolean>}
 */
const deleteFileFromOneDrive = async (itemId) => {
  const token = await getGraphAccessToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${itemId}`;

  try {
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return true;
  } catch (error) {
    handleGraphError(error, 'Failed to delete file from Microsoft OneDrive', 'OneDrive Delete');
  }
};

module.exports = {
  getGraphAccessToken,
  uploadFileToOneDrive,
  getFileMetadataFromOneDrive,
  getFileStreamFromOneDrive,
  deleteFileFromOneDrive,
};
