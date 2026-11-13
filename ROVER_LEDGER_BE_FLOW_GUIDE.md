# 📘 Rover Ledger — Complete Backend Flow & Frontend Integration Guide

This document is crafted specifically for **Frontend (FE) and Mobile Engineers** to understand the Rover Ledger Backend (BE) architecture, data models, authentication lifecycle, document storage pipeline, and API conventions.

---

## 📑 Table of Contents
1. [High-Level Architecture](#1-high-level-architecture)
2. [Server Configuration & Dual-Mount URLs](#2-server-configuration--dual-mount-urls)
3. [Standard API Response Format](#3-standard-api-response-format)
4. [Authentication Flow (Microsoft OAuth 2.0 & JWT)](#4-authentication-flow-microsoft-oauth-20--jwt)
   - [Production Auth Options (MSAL / Auth Code / PKCE)](#production-auth-options)
   - [Testing Shortcut: Dummy Login Code](#testing-shortcut-dummy-login-code)
   - [Auth Token Header Setup](#auth-token-header-setup)
5. [User Profile Management](#5-user-profile-management)
6. [Document Management & Microsoft OneDrive Storage Flow](#6-document-management--microsoft-onedrive-storage-flow)
   - [How the Storage Pipeline Works](#how-the-storage-pipeline-works)
   - [Upload Document Flow (`POST /documents/upload`)](#upload-document-flow)
   - [Fetch All Documents with Pagination (`GET /documents`)](#fetch-all-documents-with-pagination)
   - [Search & Filter Flow (`POST /documents/filter`)](#search--filter-flow)
   - [Single Document Details (`GET /documents/:id`)](#single-document-details)
   - [File Download & In-Browser Preview Streaming (`GET /documents/:id/download`)](#file-download--in-browser-preview-streaming)
   - [Single & Bulk Soft Deletion](#single--bulk-soft-deletion)
7. [Database Data Models](#7-database-data-models)
8. [Error Handling & HTTP Status Codes](#8-error-handling--http-status-codes)
9. [Interactive Swagger API Docs](#9-interactive-swagger-api-docs)
10. [Frontend Quick Start Checklist](#10-frontend-quick-start-checklist)

---

## 1. High-Level Architecture

Rover Ledger is built on **Node.js (Express 5)**, **PostgreSQL**, **Drizzle ORM**, and integrates directly with **Microsoft Entra ID (Azure AD)** and **Microsoft Graph API (OneDrive/SharePoint)**.

The backend strictly follows a layered architecture:

```mermaid
flowchart TD
    Client["Frontend (Web / Mobile / Postman)"]
    
    subgraph Express_Backend ["Rover Ledger Backend"]
        Routes["Routes (src/routes/)"]
        Middlewares["Middlewares (Auth, Multer, Error)"]
        Controllers["Controllers (src/controllers/)"]
        Services["Services (Business Logic)"]
        Repositories["Repositories (Drizzle ORM Queries)"]
    end
    
    subgraph External_Storage_Auth ["Cloud Services & Database"]
        PG[(PostgreSQL Database)]
        MSGraph["Microsoft Graph API (OneDrive)"]
        MSAuth["Microsoft Entra ID (OAuth 2.0)"]
    end
    
    Client -->|HTTP Request| Routes
    Routes --> Middlewares
    Middlewares --> Controllers
    Controllers --> Services
    Services --> Repositories
    Repositories --> PG
    Services -->|Sync & Stream Files| MSGraph
    Services -->|Validate Tokens| MSAuth
    Controllers -->|Uniform JSON Response| Client
```

### Why this matters for Frontend:
- **No Direct Cloud Credentials on Client**: The frontend never talks directly to OneDrive or AWS S3. You send requests directly to the Rover Ledger backend, and the backend handles all cloud token refreshes, file uploading, and streaming securely.
- **Stateless Authentication**: Uses standard JWT Bearer tokens. Once logged in, attach `Authorization: Bearer <token>` to all protected endpoints.
- **Automatic Scoping**: When you pass the JWT Bearer token to document endpoints, the backend automatically scopes document listings, filters, and uploads to that user.

---

## 2. Server Configuration & Dual-Mount URLs

The backend supports **dual routing mounts**: all routes are reachable directly from `/` or with the prefix `/rover-ledger/` (used by public tunnels like Zrok or reverse proxies).

| Environment | Base URL Examples | Swagger Docs URL |
| :--- | :--- | :--- |
| **Local Development** | `http://localhost:3000` | `http://localhost:3000/docs` |
| **Zrok Public Tunnel** | `https://healthvault.share.zrok.io/rover-ledger` | `https://healthvault.share.zrok.io/rover-ledger/docs` |

> 💡 **Tip for FE**: Configure your API base URL in an environment variable (e.g. `VITE_API_BASE_URL` or `NEXT_PUBLIC_API_URL`). Both `/auth/microsoft` and `/rover-ledger/auth/microsoft` hit the exact same backend logic.

---

## 3. Standard API Response Format

All Rover Ledger endpoints return a uniform response envelope, making response handling predictable.

### Success Response (`200 OK`, `201 Created`)
```json
{
  "success": true,
  "message": "Human readable status description",
  "data": { ... }
}
```

### Error Response (`400`, `401`, `403`, `404`, `500`)
```json
{
  "success": false,
  "message": "Descriptive error message",
  "error": null
}
```

---

## 4. Authentication Flow (Microsoft OAuth 2.0 & JWT)

Rover Ledger authenticates users via their corporate or personal Microsoft accounts, creates/syncs their profile in PostgreSQL, and generates an internal 7-day JWT token.

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant FE as Frontend (Web / Mobile)
    participant BE as Rover Ledger BE
    participant MS as Microsoft Entra / Graph API
    participant DB as PostgreSQL (Rover_ledgers)

    User->>FE: Click "Login with Microsoft"
    alt Option A: Frontend MSAL Library (Mobile/Web)
        FE->>MS: Interactive Login via MSAL
        MS-->>FE: Returns Microsoft Access Token
        FE->>BE: POST /auth/microsoft { accessToken }
    else Option B: Authorization Code Flow (PKCE)
        FE->>MS: Redirect to Microsoft Login consent
        MS-->>FE: Callback with Auth Code
        FE->>BE: POST /auth/microsoft { code, codeVerifier, redirectUri }
    else Option C: Instant Testing Shortcut (No Microsoft Account Needed)
        FE->>BE: POST /auth/microsoft { code: "dummy_code" }
    end

    BE->>MS: (If code) Exchange code for Microsoft token
    BE->>MS: GET /v1.0/me (Fetch profile details)
    MS-->>BE: User profile (Email, Name, Job Title)
    BE->>DB: Query user by Email
    alt User exists
        BE->>DB: Update isActive=true, backfill missing fields
    else First-time user
        BE->>DB: INSERT into Rover_ledgers (Role: 'User', isActive: true)
    end
    BE->>BE: Sign application JWT (UserId, Email, Role)
    BE-->>FE: 200 OK { success: true, data: { token: "...", user: { ... } } }
    FE->>FE: Save token to AsyncStorage / LocalStorage
```

### Production Auth Options

#### Endpoint: `POST /auth/microsoft` (or `/auth/microsoft/login`)

#### Method 1: Using Frontend MSAL (`accessToken`)
If your frontend uses `@azure/msal-browser` or `@azure/msal-react`:
```json
{
  "accessToken": "EwBAA8l6BAAU..."
}
```

#### Method 2: Using Authorization Code Flow (`code` + optional `codeVerifier` for PKCE)
If your app performs the standard OAuth redirect:
```json
{
  "code": "0.AXoAsB_TuHG3kUeC4S4hGt...",
  "redirectUri": "roverledger://auth",
  "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
}
```

> **Note for Mobile Apps**: Azure Entra ID handles mobile apps as **Public Clients**. If you send `codeVerifier`, the backend omits the server `client_secret` to strictly follow PKCE standards.

---

### Testing Shortcut: Dummy Login Code
You do **not** need a live Microsoft tenant or credentials to develop and test features locally!

Send:
```http
POST /auth/microsoft
Content-Type: application/json

{
  "code": "dummy_code"
}
```
*(Aliases: `"dummy"`, `"shraddha"`, `"test_code"`, `"demo"`)*

**Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Login with Microsoft successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": {
      "UserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "FirstName": "Shraddha",
      "LastName": "Chauhan",
      "FullName": "Shraddha Chauhan",
      "Email": "shraddha.chauhan@roverledger.com",
      "Gender": "Female",
      "Role": "User",
      "Designation": "Software Engineer",
      "isActive": true,
      "CreatedAt": "2026-10-22T06:25:08.002Z",
      "UpdatedAt": "2026-10-22T06:25:08.002Z"
    }
  }
}
```

---

### Auth Token Header Setup
For all authenticated requests, pass the returned token in the HTTP `Authorization` header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Dual-Token Lifecycle & Silent Refresh
Rover Ledger uses a **Dual-Token Architecture**:
- **Access Token** (`accessToken`): Short-lived (**15 minutes**). Sent in `Authorization: Bearer <accessToken>`.
- **Refresh Token** (`refreshToken`): Long-lived (**7 days**). Stored in the database and exchanged via `POST /auth/refresh` for a new token pair.
- **Token Rotation & Replay Attack Defense**: Every time a refresh token is used, it is revoked and replaced with a new one. If an already revoked refresh token is reused, all active sessions for that user are immediately terminated.

#### Endpoint: `POST /auth/refresh`
**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": { ... }
  }
}
```

#### Frontend Silent Refresh Interceptor (Axios Example):
```javascript
import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3000' });

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

// 1. Attach accessToken to outgoing requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 2. Intercept expired tokens (code: 'TOKEN_EXPIRED') and silently refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const storedRefreshToken = localStorage.getItem('refreshToken');
        const { data } = await axios.post('http://localhost:3000/auth/refresh', {
          refreshToken: storedRefreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = data.data;

        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', newRefreshToken);

        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
```

---

## 5. User Profile Management

| Endpoint | Method | Auth Required | Description |
| :--- | :---: | :---: | :--- |
| `/users/profile` (or `/profile`) | `GET` | ✅ Yes | Fetch current user's profile |
| `/users/profile` (or `/profile`) | `PUT` / `PATCH` | ✅ Yes | Update profile fields |
| `/users/profile` (or `/profile`) | `DELETE` | ✅ Yes | Permanent account deletion (Cascading cleanup of user, OneDrive files, and all DB data) |
| `/auth/logout` | `POST` | Optional / Bearer | Log out (marks `isActive: false` in DB) |

### Permanent Cascading Account Deletion (Option A)
When an account is deleted via `DELETE /users/profile`:
1. **Cloud File Cleanup**: Queries all documents uploaded by this user and permanently removes their files from **Microsoft OneDrive** via Microsoft Graph API.
2. **Database Cleanup**: In an atomic transaction, hard-deletes:
   - All document records from `document_details`
   - All session tokens from `refresh_tokens`
   - The user profile record from `Rover_ledgers`

**Request:**
```http
DELETE /users/profile
Authorization: Bearer <token>
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "message": "User account, all uploaded documents from OneDrive, and associated database records deleted successfully",
  "data": {
    "userId": "5096738d-1d77-4e4d-89b1-fd72cf5fd2da",
    "email": "user@example.com",
    "deletedDocumentsCount": 3,
    "oneDriveFilesDeleted": 3,
    "oneDriveFilesFailed": 0,
    "deletedRefreshTokensCount": 1
  }
}
```

### Updating User Profile
**Request:**
```http
PUT /users/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "FirstName": "Shraddha",
  "LastName": "Patel",
  "Gender": "Female",
  "Designation": "Lead Financial Engineer"
}
```
*Note: If `FirstName` or `LastName` is updated without passing `FullName`, the backend automatically recalculates `FullName` as `"${FirstName} ${LastName}"`.*

---

## 6. Document Management & Microsoft OneDrive Storage Flow

### How the Storage Pipeline Works

```mermaid
flowchart LR
    FE["Frontend Form Data"] -->|1. Multipart Upload| BE["Rover Ledger Backend"]
    BE -->|2. Buffer in Memory| Multer["Multer (MemoryStorage)"]
    Multer -->|3. Stream File via PUT| OneDrive["Microsoft OneDrive / SharePoint"]
    OneDrive -->|4. Return Item ID & URLs| BE
    BE -->|5. Store Metadata| PG[(PostgreSQL document_details)]
    BE -->|6. Return Success & Doc Data| FE
```

1. **Zero Disk Footprint on Server**: Files are processed in memory and streamed directly to Microsoft OneDrive folder via Microsoft Graph API.
2. **Resilience**: The backend caches the Microsoft Graph Access token and refreshes it before expiration.
3. **Mandatory Authentication & User Scoping**: Uploading requires `Authorization: Bearer <token>`. The document is strictly linked to the authenticated user (`uploadedBy: user.UserId`).

---

### Upload Document Flow
- **Endpoint**: `POST /documents/upload`
- **Security**: Bearer Token required (`Authorization: Bearer <token>`)
- **Content-Type**: `multipart/form-data`
- **Allowed Formats**: Documents (PDF, DOCX, TXT, XLSX) and Images (JPG, JPEG, PNG, WEBP, GIF)
- **Max File Size**: `50 MB`

#### Form Fields:
| Field Name | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `file` | File Binary | ✅ Yes | The document or image file (accepts field name `file`, `document`, or `image`) |
| `documentName` | String | ✅ Yes | Custom display name (e.g. `"Office Rent Invoice Oct 2026"`) |
| `documentType` | String | ❌ No (Optional) | Allowed values: `'income'`, `'expense'`, or `null` (`DocumentType` enum) |
| `documentDate` | String (Date) | ✅ Yes | Format: `YYYY-MM-DD` (e.g. `"2026-10-29"`) |

#### Frontend Code Example (JavaScript / React):
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('documentName', 'Server Cloud Hosting');
formData.append('documentType', 'expense');
formData.append('documentDate', '2026-10-29');

const response = await api.post('/documents/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
});
```

#### Response (`201 Created`):
```json
{
  "success": true,
  "message": "Document uploaded and synced to Microsoft OneDrive successfully",
  "data": {
    "id": "7f8b9c2a-1123-4455-8899-aabbccddeeff",
    "documentName": "Server Cloud Hosting",
    "documentType": "expense",
    "fileSize": 1048576,
    "fileType": "application/pdf",
    "documentDate": "2026-10-29T00:00:00.000Z",
    "softDelete": false,
    "createdAt": "2026-10-29T10:15:30.123Z",
    "updatedAt": "2026-10-29T10:15:30.123Z",
    "oneDriveItemId": "01ABCD123456789...",
    "oneDriveWebUrl": "https://onedrive.live.com/...",
    "oneDriveDownloadUrl": "https://public.onedrive.com/...",
    "originalFileName": "invoice_oct.pdf",
    "uploadedBy": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
  }
}
```

---

### Fetch Document Counts & Statistics API (NEW)
- **Endpoint**: `GET /documents/counts` (or `GET /documents/count`)
- **Headers**: `Authorization: Bearer <accessToken>` (Required)
- **Description**: Returns all 4 aggregate counts strictly for the authenticated user based on their Bearer token:
  1. `total`: Total active documents uploaded by the user
  2. `incomeInvoiceCount`: Total active income invoices for this user
  3. `expenseInvoiceCount`: Total active expense invoices for this user
  4. `pdfCount`: Total active PDF documents

#### Response Structure (`200 OK`):
```json
{
  "success": true,
  "message": "Document counts fetched successfully",
  "data": {
    "total": 42,
    "incomeInvoiceCount": 24,
    "expenseInvoiceCount": 18,
    "pdfCount": 15
  }
}
```

---

### Fetch Active Documents (Role Scoped)
- **Endpoint**: `GET /documents` (or `GET /rover-ledger/documents`)
- **Headers**: `Authorization: Bearer <accessToken>` (Required)
- **Role Scoping**:
  - **`Role: User`**: Exclusively returns active documents uploaded by the authenticated user (`softDelete: false AND uploadedBy = user.UserId`).
  - **`Role: Admin`**: Returns **all active documents across all users** (`softDelete: false`). Admins can optionally provide `?uploadedBy=<userId>` in query parameters to view a specific user's documents.
- **Counts Removed**: Counts (`total`, `incomeInvoiceCount`, `expenseInvoiceCount`, `pdfCount`) are provided by the dedicated `GET /documents/counts` API.

#### Response Structure (`200 OK`):
```json
{
  "success": true,
  "message": "Documents fetched successfully",
  "data": {
    "rows": [
      {
        "id": "98656735-4fd9-4784-876e-e98feca482f9",
        "documentName": "Consulting Income Invoice April 2026",
        "documentType": "income",
        "fileSize": 61,
        "fileType": "application/pdf",
        "documentDate": "2026-04-10T00:00:00.000Z",
        "softDelete": false,
        "createdAt": "2026-10-29T10:13:02.013Z",
        "updatedAt": "2026-10-29T10:13:02.013Z",
        "oneDriveItemId": "01TQSGEJRMAVNLIUETMNFZ3YQFVSGUE6VE",
        "oneDriveWebUrl": "https://techroverinc-my.sharepoint.com/...",
        "oneDriveDownloadUrl": "https://techroverinc-my.sharepoint.com/...",
        "originalFileName": "consulting_income.pdf",
        "uploadedBy": "2857a21e-ace9-4188-bd47-18e39745940e",
        "contentUrl": "/documents/98656735-4fd9-4784-876e-e98feca482f9/content",
        "downloadUrl": "/documents/98656735-4fd9-4784-876e-e98feca482f9/download"
      }
    ],
    "page": 1,
    "limit": 42
  }
}
```

---

### Search & Filter Flow
- **Endpoint**: `POST /documents/filter`
- **Headers**: `Authorization: Bearer <token>` *(Optional)*
- **Body (`application/json`)**:
```json
{
  "documentType": "expense",
  "documentName": "Hosting",
  "search": "invoice",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31",
  "fileType": "application/pdf",
  "isSharedWithCa": true,
  "page": 1,
  "limit": 10,
  "sortBy": "documentDate",
  "order": "desc"
}
```
> 💡 **New Filter Property (`isSharedWithCa`)**: Pass `true` to fetch only invoices shared with the CA in Google Drive, or `false` to fetch only unshared invoices. Omit or pass `undefined` to fetch both.

> 🛡️ **Role Scoping in Filter**:
> - If authenticated as **`Role: User`**: The search is automatically restricted to documents uploaded by this user (`uploadedBy = user.UserId`).
> - If authenticated as **`Role: Admin`**: The search operates across **all active documents** in the platform. Admins can optionally pass `"uploadedBy": "<userId>"` in the body if they want to filter for a particular employee.
>
> ⚠️ **Key Rule**: As per backend specification, the filter criteria are provided in the **request body**, not as query parameters.

---

### Single Document Details
- **Endpoint**: `GET /documents/:id`
- **Description**: Returns full metadata of a document by its UUID. Verifies ownership if authenticated.

---

### Raw Image/Document Content Streaming (For Mobile App & PDF Generator)
- **Endpoint**: `GET /documents/:id/content`
- **Headers**: `Authorization: Bearer <rover_ledger_access_token>` (or query parameter `?token=<access_token>`)
- **Description**: Exposes an authenticated proxy stream specifically designed for mobile image loaders, image rendering, and PDF generator libraries.
  - The backend validates the Rover Ledger Bearer Token, fetches the file stream from Microsoft OneDrive using backend Microsoft credentials (which refresh automatically server-side), and streams the raw bytes directly to the client.
  - Returns `Content-Disposition: inline` and proper MIME `Content-Type` (e.g. `image/png`, `image/jpeg`, `application/pdf`).
  - **No Microsoft Graph credentials needed by the client** — the client only passes its active Rover Ledger bearer token.

```mermaid
sequenceDiagram
    participant App as Mobile App / PDF Generator
    participant BE as Rover Ledger BE
    participant OD as Microsoft OneDrive / SharePoint

    App->>BE: GET /documents/:id/content (Header: Bearer RoverLedgerToken)
    Note over BE: Validates Rover Ledger Bearer token & document ownership
    BE->>OD: GET /drives/:driveId/items/:itemId/content (Server-Side Microsoft Entra ID Token)
    OD-->>BE: Raw File Stream + Content-Type (image/png, image/jpeg)
    BE-->>App: Direct Binary Stream (Content-Disposition: inline)
    Note over App: App feeds image bytes directly into PDF Generator!
```

---

### File Download & In-Browser Preview Streaming
- **Endpoint**: `GET /documents/:id/download` (or `GET /documents/:id/file`)

The backend queries Microsoft OneDrive and **pipes the binary stream directly into the HTTP response**:

```mermaid
sequenceDiagram
    participant FE as Frontend / Browser
    participant BE as Rover Ledger BE
    participant OD as Microsoft OneDrive

    FE->>BE: GET /documents/:id/download?inline=true
    BE->>OD: GET /drives/:driveId/items/:itemId/content (stream)
    OD-->>BE: Binary Stream + Content-Type
    BE-->>FE: Stream File Binary (Content-Disposition: inline)
    FE->>FE: Browser renders image or PDF directly!
```

#### Query Param:
- `?inline=true`: Sets `Content-Disposition: inline`. **Use this for rendering PDFs or images directly in `<img src="..." />` or `<iframe src="..." />` / PDF viewers.**
- Default (no param or `?inline=false`): Sets `Content-Disposition: attachment`, prompting a file download dialog in the browser.

---

### Single & Bulk Soft Deletion

Rover Ledger permanently removes the physical file from **Microsoft OneDrive** to free up cloud storage space, while marking `softDelete: true` in the database to preserve historical ledger auditing. Soft-deleted records are automatically excluded from standard document listings, counts, and search queries.

#### 1. Single Delete:
- **Endpoint**: `DELETE /documents/:id`
- **Response**: Returns the updated record with `softDelete: true`.

#### 2. Bulk Soft Delete:
- **Endpoint**: `DELETE /documents/bulk` (or `POST /documents/bulk-delete`)
- **Body (`application/json`)**:
```json
{
  "ids": [
    "7f8b9c2a-1123-4455-8899-aabbccddeeff",
    "a1b2c3d4-e5f6-7890-1234-567890abcdef"
  ]
}
```
*(Also accepts `{ "documentIds": [...] }` or a raw array `["id1", "id2"]`)*

**Response (`200 OK`):**
```json
{
  "success": true,
  "message": "Bulk soft delete completed. Successfully soft deleted 2 document(s).",
  "data": {
    "totalRequested": 2,
    "deletedCount": 2,
    "deletedIds": ["7f8b9c2a...", "a1b2c3d4..."],
    "notFoundOrAlreadyDeleted": [],
    "documents": [ ... ]
  }
}
```

---

## 7. Database Data Models

### 1. `Rover_ledgers` (Users Table)
| Column | Type | Description |
| :--- | :--- | :--- |
| `UserId` | UUID (PK) | Auto-generated unique identifier |
| `FirstName` | Varchar(255) | First name |
| `LastName` | Varchar(255) | Last name |
| `FullName` | Varchar(255) | Combined display name |
| `Email` | Varchar(255) | Unique email address |
| `Gender` | Varchar(50) | Gender |
| `Role` | Varchar(100) | Default: `'User'` |
| `Designation` | Varchar(255) | Job title / Role in organisation |
| `isActive` | Boolean | Account status (set to `false` on logout) |
| `SoftDelete` | Boolean | Account deletion flag |
| `CreatedAt` | Timestamp | Registration timestamp |
| `UpdatedAt` | Timestamp | Last modified timestamp |

### 2. `document_details` (Documents Table)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Auto-generated unique document ID |
| `documentName` | Varchar(255) | Name given to the document |
| `documentType` | Varchar(50) | Allowed values: `'income'`, `'expense'`, or `null` |
| `fileSize` | Bigint | Size of file in bytes |
| `fileType` | Varchar(100) | MIME type (e.g. `application/pdf`, `image/jpeg`) |
| `documentDate` | Timestamp | Date of financial record |
| `softDelete` | Boolean | Soft deletion flag (default `false`) |
| `oneDriveItemId` | Varchar(255) | Unique item ID inside Microsoft OneDrive |
| `oneDriveWebUrl` | Text | Web browser link to file in OneDrive |
| `oneDriveDownloadUrl`| Text | Direct CDN download link from Microsoft Graph |
| `originalFileName` | Varchar(255) | Original file name during upload |
| `uploadedBy` | UUID | Foreign Key linking to `Rover_ledgers.UserId` |
| `createdAt` | Timestamp | Upload timestamp |
| `updatedAt` | Timestamp | Last modified timestamp |

---

## 8. Error Handling & HTTP Status Codes

| Status Code | Meaning | When it occurs | Frontend Action |
| :---: | :--- | :--- | :--- |
| **`200`** | OK | Success for GET, PUT, PATCH, DELETE | Render data |
| **`201`** | Created | Upload or creation success | Display success notification |
| **`400`** | Bad Request | Missing fields, invalid date format, invalid `documentType` | Display validation message to user |
| **`401`** | Unauthorized | Missing or expired JWT Bearer token | Redirect user to Microsoft login screen |
| **`403`** | Forbidden | Trying to access/delete a document owned by another user | Show "Access Denied" toast |
| **`404`** | Not Found | Document ID or User not found | Show empty state or 404 alert |
| **`502`** | Bad Gateway | Microsoft OneDrive / Graph API communication failed | Show "Storage service temporarily unavailable" |

---

## 9. Interactive Swagger API Docs

The backend includes a live Swagger UI:
- **Localhost**: `http://localhost:3000/docs`
- **Aliases**: `/swagger`, `/swagger-ui`, `/api-docs`, `/rover-ledger/docs`
- **Raw YAML**: `http://localhost:3000/swagger.yaml`

### How to use Swagger UI during Frontend Development:
1. Open `http://localhost:3000/docs` in your browser.
2. Go to **Authentication** ➔ `POST /auth/microsoft`.
3. Click **"Try it out"**, leave `{"code": "dummy_code"}`, and click **Execute**.
4. Copy the `data.token` from the response.
5. Scroll to the top of the Swagger page, click the green **"Authorize 🔓"** button, and paste the token.
6. Now you can test all protected endpoints directly in the browser!

---

## 10. Frontend Quick Start Checklist

- [ ] **Configure Base URL**: Set your Axios/Fetch base URL to `http://localhost:3000` (or the tunnel URL).
- [ ] **Implement Login Flow**:
  - For rapid UI prototyping: Call `POST /auth/microsoft` with `{"code": "dummy_code"}`.
  - For production: Integrate `@azure/msal-browser` and pass the obtained `accessToken` to `POST /auth/microsoft`.
- [ ] **Store JWT Token**: Store `data.token` securely in storage and attach to the `Authorization: Bearer <token>` header.
- [ ] **File Upload**: Use `FormData` with field `file`, `documentName`, `documentDate` (`YYYY-MM-DD`), and optional `documentType` (`'income'`, `'expense'`, or `null`).
- [ ] **File Preview / Download**: Use `/documents/:id/download?inline=true` directly inside `<img src="...">` or PDF viewers.
- [ ] **Bulk Deletion**: Pass `{ "ids": ["id1", "id2"] }` to `DELETE /documents/bulk`.



---

## 11. Google Drive Integration ("Share with CA")

### 11.1 Architecture & Flow Summary
- **Employees**: Continue logging in via their Microsoft Entra ID corporate account. No personal Google accounts are required.
- **Chartered Accountant (CA)**: Receives a shared folder (`Rover Ledger - CA Invoices`) directly inside their personal Gmail (`Google Drive` ➔ `Shared with me`). The CA does not log into Rover Ledger or authorize any apps.
- **Company Google Drive**: Connected once via OAuth 2.0 (`GET /auth/google/connect`). The backend securely encrypts the refresh token using AES-256-GCM at rest and re-uses it indefinitely.
- **Invoice Transfer**: When an employee shares an invoice (`POST /documents/:id/share-to-ca`), the backend streams the PDF directly from Microsoft OneDrive and uploads it to the CA shared Google Drive folder using standard Google Drive v3 multipart upload.

---

### 11.2 Google Drive Endpoints

#### 1. Check Google Drive Connection Status
- **Endpoint**: `GET /auth/google/status`
- **Use Case**: Used by the Frontend Profile Screen to determine whether the "Connect Google Drive" button should be displayed or if Google Drive is already connected.
- **Response (`200 OK`)**:
```json
{
  "success": true,
  "message": "Google Drive connection status retrieved",
  "data": {
    "isConnected": true,
    "googleEmail": "company.drive@gmail.com",
    "caEmail": "ca@roverledger.com",
    "targetFolderId": "1lY9...folderId"
  }
}
```

#### 2. Connect Google Drive (OAuth 2.0 - Admin Only)
- **Endpoint**: `GET /auth/google/connect`
- **Headers**: `Authorization: Bearer <adminAccessToken>` (Required - **Role: Admin**)
- **Access Control**: Restricted strictly to users with **`Role: Admin`**. Regular users receive `403 Forbidden`.
- **Query Parameters**:
  - `redirect=false` (Optional): Returns a JSON payload containing `{ authUrl }` for mobile / web apps to open in a browser or `expo-web-browser`.
  - `caEmail` (Optional): Target CA email to share folder with (defaults to `CA_EMAIL_DEFAULT` from environment).
- **Default Behavior**: Redirects (HTTP 302) to Google's OAuth 2.0 Consent Screen.
- **JSON Response (`redirect=false`)**:
```json
{
  "success": true,
  "message": "Google authorization URL generated",
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&access_type=offline&prompt=consent..."
  }
}
```

#### 3. Google OAuth Callback
- **Endpoint**: `GET /auth/google/callback` (or alias `GET /api/google/callback`)
- **Description**: Google redirects here with `?code=...`. The backend exchanges the code for tokens, encrypts the refresh token, initializes the "Rover Ledger - CA Invoices" folder, and shares it with the CA email.

#### 4. Disconnect Google Drive (Admin Only)
- **Endpoint**: `POST /auth/google/disconnect`
- **Headers**: `Authorization: Bearer <adminAccessToken>` (Required - **Role: Admin**)
- **Access Control**: Restricted strictly to users with **`Role: Admin`**. Regular users receive `403 Forbidden`.
- **Description**: Marks the connection inactive and revokes cached access tokens.

---

### 11.3 Share Document with CA API
- **Endpoint**: `POST /documents/:id/share-to-ca`
- **Headers**: `Authorization: Bearer <accessToken>` (Optional / Recommended)
- **Parameters**: `id` - Document UUID to share.
- **Workflow**:
  1. Validates document ownership and existence.
  2. Idempotency check: If already shared, returns immediately without re-uploading.
  3. Verifies company Google Drive connection.
  4. Streams original PDF from Microsoft OneDrive.
  5. Uploads directly into the target CA Google Drive folder.
  6. Stores share audit record in `document_ca_shares` database table.

#### Success Response (`201 Created` or `200 OK` if already shared):
```json
{
  "success": true,
  "message": "Document shared with CA successfully.",
  "data": {
    "alreadyShared": false,
    "message": "Document shared with CA successfully.",
    "share": {
      "id": "035db723-5291-498d-bdfb-c0369ab84122",
      "documentId": "617f92da-c09e-4355-916e-17998f17eaa3",
      "googleDriveFileId": "1lY9...fileId",
      "googleDriveWebViewLink": "https://drive.google.com/file/d/1lY9.../view",
      "caEmail": "ca@roverledger.com",
      "sharedByUserId": "8f039082-de2f-4403-b5e4-be7ad38bde1e",
      "sharedAt": "2026-11-05T12:00:00.000Z"
    },
    "document": {
      "id": "617f92da-c09e-4355-916e-17998f17eaa3",
      "documentName": "April Consulting Invoice",
      "isSharedWithCa": true,
      "sharedWithCaAt": "2026-11-05T12:00:00.000Z",
      "googleDriveFileId": "1lY9...fileId",
      "googleDriveViewUrl": "https://drive.google.com/file/d/1lY9.../view"
    }
  }
}
```

---

### 11.4 Embedded CA Share Status in Document Responses
You do **NOT** need to call a separate status API to know if an invoice is shared with the CA.
Every document returned by `GET /documents`, `POST /documents/filter`, and `GET /documents/:id` automatically includes these 4 share properties:

```json
{
  "id": "617f92da-c09e-4355-916e-17998f17eaa3",
  "documentName": "April Consulting Invoice",
  "documentType": "income",
  "fileSize": 102400,
  "isSharedWithCa": true,
  "sharedWithCaAt": "2026-11-05T12:00:00.000Z",
  "googleDriveFileId": "1lY9...fileId",
  "googleDriveViewUrl": "https://drive.google.com/file/d/1lY9.../view",
  "contentUrl": "/documents/617f92da-c09e-4355-916e-17998f17eaa3/content",
  "downloadUrl": "/documents/617f92da-c09e-4355-916e-17998f17eaa3/download"
}
```

---

### 11.5 Frontend Implementation Guide

#### 1. In the Profile / Settings Menu
1. Call `GET /auth/google/status`.
2. If `data.isConnected === false`:
   - Display a **"Connect Google Drive"** button.
   - When tapped, fetch the URL from `GET /auth/google/connect?redirect=false` and open it via `WebBrowser.openAuthSessionAsync(authUrl)`.
3. If `data.isConnected === true`:
   - Display **"Google Drive Connected: {data.googleEmail}"** with an optional **"Disconnect"** button (`POST /auth/google/disconnect`).

#### 2. In Invoice List & Details Screen
1. Check `document.isSharedWithCa`:
   - If `true`: Show a green **"Shared with CA"** badge and optionally a button to open `document.googleDriveViewUrl`.
   - If `false`: Show a **"Share with CA"** button.
2. When the user taps **"Share with CA"**:
   - Make a `POST /documents/:id/share-to-ca` request.
   - On success (200 / 201), update the UI state to `isSharedWithCa: true` and show a success toast.
