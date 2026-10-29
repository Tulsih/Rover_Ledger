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
| `/auth/logout` | `POST` | Optional / Bearer | Log out (marks `isActive: false` in DB) |

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
3. **Dual Scoping**: If the user is logged in (passes `Authorization: Bearer <token>`), the document is linked with `uploadedBy: user.UserId`. If unauthenticated, it is stored as a global ledger document.

---

### Upload Document Flow
- **Endpoint**: `POST /documents/upload` (or `POST /documents`)
- **Content-Type**: `multipart/form-data`
- **Max File Size**: `50 MB`

#### Form Fields:
| Field Name | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `file` | File Binary | ✅ Yes | The actual file/image (accepts field name `file`, `document`, or `image`) |
| `documentName` | String | ✅ Yes | Custom display name (e.g. `"Office Rent Invoice Oct 2026"`) |
| `documentType` | String | ✅ Yes | Allowed values: `'income'` or `'expense'` |
| `documentDate` | String (Date) | ✅ Yes | Format: `YYYY-MM-DD` (e.g. `"2026-10-29"`) |
| `pdfCreated` | Boolean / String | ❌ Optional | `true` or `false` (default: `false`) |

#### Frontend Code Example (JavaScript / React):
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('documentName', 'Server Cloud Hosting');
formData.append('documentType', 'expense');
formData.append('documentDate', '2026-10-29');
formData.append('pdfCreated', 'false');

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
    "pdfCreated": false,
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

### Fetch Active Documents for Authenticated User (Zero Filter Parameters Required)
- **Endpoint**: `GET /documents` (or `GET /rover-ledger/documents`)
- **Headers**: `Authorization: Bearer <accessToken>` (Required)
- **User Scoping**: Automatically extracts `UserId` from the Bearer Access Token.
- **Query Parameters**: None required! Simply click **"Execute"** in Swagger (with Bearer token authorized) or make a GET request.
- **Strict User Privacy**: Returns **only** the authenticated user's active documents (`softDelete: false AND uploadedBy = user.UserId`), and calculates `total`, `incomeInvoiceCount`, and `expenseInvoiceCount` strictly for this user!

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
        "pdfCreated": true,
        "softDelete": false,
        "createdAt": "2026-10-29T10:13:02.013Z",
        "updatedAt": "2026-10-29T10:13:02.013Z",
        "oneDriveItemId": "01TQSGEJRMAVNLIUETMNFZ3YQFVSGUE6VE",
        "oneDriveWebUrl": "https://techroverinc-my.sharepoint.com/...",
        "oneDriveDownloadUrl": "https://techroverinc-my.sharepoint.com/...",
        "originalFileName": "consulting_income.pdf",
        "uploadedBy": "2857a21e-ace9-4188-bd47-18e39745940e"
      }
    ],
    "total": 13,
    "page": 1,
    "limit": 13,
    "totalPages": 1,
    "incomeInvoiceCount": 5,
    "expenseInvoiceCount": 8
  }
}
```

> 💡 **Notice**: In addition to pagination metadata (`page`, `limit`, `totalPages`, `total`), the response returns **`incomeInvoiceCount`** and **`expenseInvoiceCount`** calculating the counts of all active income and expense records!

---

### Search & Filter Flow
- **Endpoint**: `POST /documents/filter` (Also accepts `GET /documents/filter`)
- **Headers**: `Authorization: Bearer <token>` *(Optional)*
- **Body (`application/json`)**:
```json
{
  "documentType": "expense",
  "documentName": "Hosting",
  "search": "invoice",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31",
  "pdfCreated": false,
  "fileType": "application/pdf",
  "page": 1,
  "limit": 10,
  "sortBy": "documentDate",
  "order": "desc"
}
```

> ⚠️ **Key Rule**: As per backend specification, the filter criteria are provided in the **request body**, not as query parameters.

---

### Single Document Details
- **Endpoint**: `GET /documents/:id`
- **Description**: Returns full metadata of a document by its UUID. Verifies ownership if authenticated.

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

Rover Ledger uses **soft deletion** (`softDelete: true`). Soft-deleted records are retained in the database for auditing and history, but excluded from standard document listings and searches.

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
| `documentType` | Varchar(50) | `'income'` or `'expense'` |
| `fileSize` | Bigint | Size of file in bytes |
| `fileType` | Varchar(100) | MIME type (e.g. `application/pdf`, `image/jpeg`) |
| `documentDate` | Timestamp | Date of financial record |
| `pdfCreated` | Boolean | Flag if converted to/generated as PDF |
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
- [ ] **File Upload**: Use `FormData` with field `file`, `documentName`, `documentType` (`income`/`expense`), and `documentDate` (`YYYY-MM-DD`).
- [ ] **File Preview / Download**: Use `/documents/:id/download?inline=true` directly inside `<img src="...">` or PDF viewers.
- [ ] **Bulk Deletion**: Pass `{ "ids": ["id1", "id2"] }` to `DELETE /documents/bulk`.

