const googledriveService = require('../services/googledrive.service');
const googleConfigRepository = require('../repositories/googleConfig.repository');
const cryptoUtil = require('../utils/crypto.util');
const { env } = require('../configs/env');
const { sendSuccess, sendError } = require('../utils/response.util');

/**
 * Controller for Google OAuth & Google Drive Connection Management
 */
class GoogleAuthController {
  /**
   * API: Start Google OAuth Connection
   * GET /auth/google/connect
   * Query params:
   *   redirect=false (optional, returns JSON URL instead of redirecting)
   *   caEmail (optional, CA email to bind upon connection)
   */
  async connect(req, res) {
    try {
      const caEmail = req.query?.caEmail || env.caEmailDefault;
      const stateObj = {
        caEmail,
        adminUserId: req.user?.UserId || null,
        adminEmail: req.user?.Email || null,
        timestamp: Date.now(),
      };

      const authUrl = googledriveService.getAuthorizationUrl(stateObj);

      if (req.query?.redirect === 'false' || req.headers.accept === 'application/json') {
        return sendSuccess(res, 200, 'Google authorization URL generated', { authUrl });
      }

      return res.redirect(authUrl);
    } catch (error) {
      console.error('[GoogleAuthController.connect Error]:', error.message);
      return sendError(res, 500, error.message);
    }
  }

  /**
   * API: Handle Google OAuth Callback
   * GET /auth/google/callback (also aliased as /api/google/callback)
   */
  async callback(req, res) {
    try {
      const code = req.query?.code || req.body?.code;
      const error = req.query?.error || req.body?.error;

      if (error) {
        return sendError(res, 400, `Google authorization was denied or failed: ${error}`);
      }

      if (!code) {
        return sendError(res, 400, 'Missing authorization code from Google.');
      }

      // Parse state if passed
      let caEmail = env.caEmailDefault;
      if (req.query?.state) {
        try {
          const parsed = JSON.parse(req.query.state);
          if (parsed?.caEmail) caEmail = parsed.caEmail;
        } catch {
          // Plain string state, ignore
        }
      }
      if (req.query?.caEmail || req.body?.caEmail) {
        caEmail = req.query.caEmail || req.body.caEmail;
      }

      // Exchange code for tokens
      const { accessToken, refreshToken, email } = await googledriveService.exchangeCodeForTokens(code);

      // Check existing config in case Google did not return a new refresh_token
      let encryptedRefreshToken = null;
      if (refreshToken) {
        encryptedRefreshToken = cryptoUtil.encryptToken(refreshToken);
      } else {
        const existingConfig = await googleConfigRepository.getActiveConfig();
        if (existingConfig && existingConfig.encryptedRefreshToken) {
          encryptedRefreshToken = existingConfig.encryptedRefreshToken;
        } else {
          return sendError(
            res,
            400,
            'Google did not return a refresh token. Please reconnect and ensure you grant offline permissions.'
          );
        }
      }

      // Save connection config
      const savedConfig = await googleConfigRepository.saveConfig({
        googleEmail: email,
        encryptedRefreshToken,
        caEmail,
      });

      // Clear any existing cached token to refresh with new credentials
      googledriveService.clearCachedToken();

      // Ensure CA folder is initialized right away
      try {
        const folderId = await googledriveService.ensureCaFolderExists({
          accessToken,
          existingFolderId: savedConfig.targetFolderId,
          caEmail,
        });
        if (folderId && folderId !== savedConfig.targetFolderId) {
          await googleConfigRepository.updateFolderId(savedConfig.id, folderId);
        }
      } catch (folderErr) {
        console.warn('[Google Drive Initial Folder Warning]:', folderErr.message);
      }

      // Check if browser request
      const isBrowser = (req.headers.accept && req.headers.accept.includes('text/html')) || !req.headers.accept;
      if (isBrowser) {
        return res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Google Drive Connected - Rover Ledger</title>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                  background-color: #f8fafc;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                  margin: 0;
                  padding: 20px;
                }
                .card {
                  background: white;
                  padding: 40px;
                  border-radius: 12px;
                  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                  max-width: 480px;
                  text-align: center;
                }
                h1 { color: #0f172a; font-size: 24px; margin-bottom: 12px; }
                p { color: #475569; font-size: 16px; line-height: 1.5; margin-bottom: 24px; }
                .email { font-weight: 600; color: #2563eb; }
                .badge {
                  display: inline-block;
                  background-color: #dcfce7;
                  color: #15803d;
                  padding: 6px 12px;
                  border-radius: 9999px;
                  font-weight: 600;
                  font-size: 14px;
                  margin-bottom: 16px;
                }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="badge">✓ Connected</div>
                <h1>Google Drive Connected</h1>
                <p>
                  Rover Ledger is now connected to <span class="email">${email}</span>.<br />
                  Invoices will be shared with CA (<span class="email">${caEmail}</span>).
                </p>
                <p style="font-size: 14px; color: #94a3b8;">
                  You may close this tab and return to the Rover Ledger mobile app.
                </p>
              </div>
            </body>
          </html>
        `);
      }

      return sendSuccess(res, 200, 'Company Google Drive connected successfully', {
        googleEmail: email,
        caEmail,
        isConnected: true,
      });
    } catch (error) {
      console.error('[GoogleAuthController.callback Error]:', error.message);
      return sendError(res, error.statusCode || 500, error.message);
    }
  }

  /**
   * API: Get Google Drive Connection Status
   * GET /auth/google/status
   */
  async getStatus(req, res) {
    try {
      const status = await googledriveService.getConnectionStatus();
      return sendSuccess(res, 200, 'Google Drive connection status retrieved', status);
    } catch (error) {
      console.error('[GoogleAuthController.getStatus Error]:', error.message);
      return sendError(res, 500, error.message);
    }
  }

  /**
   * API: Disconnect Google Drive
   * POST /auth/google/disconnect
   */
  async disconnect(req, res) {
    try {
      await googleConfigRepository.disconnect();
      googledriveService.clearCachedToken();
      return sendSuccess(res, 200, 'Google Drive disconnected successfully');
    } catch (error) {
      console.error('[GoogleAuthController.disconnect Error]:', error.message);
      return sendError(res, 500, error.message);
    }
  }
}

module.exports = new GoogleAuthController();

