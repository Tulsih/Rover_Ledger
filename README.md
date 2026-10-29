# Rover Ledger - Backend & Cloud Services

A modular, clean, and developer-friendly Node.js backend built with **Express** and **Drizzle ORM** (PostgreSQL) featuring **Microsoft OAuth 2.0 / Entra ID login**, **Profile Management**, and **Document Management with Microsoft OneDrive / SharePoint Sync**.

> 📖 **Frontend Team Integration Guide**:
> For a step-by-step walkthrough of the backend flow, sequence diagrams, request envelopes, and FE code examples, see:
> 👉 **[ROVER_LEDGER_BE_FLOW_GUIDE.md](./ROVER_LEDGER_BE_FLOW_GUIDE.md)**

---

## 🏗️ Architecture Pattern

The application strictly follows the multi-layered enterprise architecture pattern:

```
Request ➡️ Route ➡️ Controller ➡️ Service ➡️ Repository ➡️ Drizzle Model (PostgreSQL)
                   ⬇️
            Helpers / Utils (JWT, Microsoft OAuth, Responses)
```

- **Routes (`src/routes/`)**: Map incoming HTTP endpoints and apply middleware.
- **Controllers (`src/controllers/`)**: Validate request payloads and return standardized JSON HTTP responses.
- **Services (`src/services/`)**: Implement business logic, Microsoft token exchange, Microsoft Graph queries, and token generation.
- **Repositories (`src/repositories/`)**: Encapsulate Drizzle ORM queries to interact with PostgreSQL.
- **Models (`src/models/`)**: Define the Drizzle ORM table schema for `Rover_ledgers`.
- **Middlewares (`src/middlewares/`)**: JWT authentication verification and global error handling.
- **Utils / Helpers (`src/utils/`)**: Reusable helper utilities (JWT handling, Microsoft OAuth/Graph client, uniform API responses).

---

## 🗄️ Database Schema: `Rover_ledgers`

The table `Rover_ledgers` is created and managed via Drizzle ORM with the following 12 fields:

| Field Name | Type | Constraints & Defaults | Description |
| :--- | :--- | :--- | :--- |
| `UserId` | Serial | Primary Key, Auto-increment | Unique identifier for user |
| `FirstName` | Varchar(255) | Nullable | User's first name |
| `LastName` | Varchar(255) | Nullable | User's last name |
| `Email` | Varchar(255) | Not Null, Unique | User's email address |
| `Gender` | Varchar(50) | Nullable | Gender (Male, Female, Other) |
| `Role` | Varchar(100) | Default: `'User'` | User permission role |
| `CreatedAt` | Timestamp | Default: `now()` | Registration timestamp |
| `UpdatedAt` | Timestamp | Default: `now()` | Last profile update timestamp |
| `Designation`| Varchar(255) | Nullable | Job title / designation |
| `FullName` | Varchar(255) | Nullable | Display full name |
| `isActive` | Boolean | Default: `true` | Account active status flag |
| `SoftDelete`| Boolean | Default: `false` | Soft deletion status flag |

---

## ⚙️ Environment Configuration (`.env`)

```env
# Server
PORT=5000
NODE_ENV=development

# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=12345
DB_NAME=rover_ledger
DATABASE_URL=postgresql://postgres:12345@localhost:5432/rover_ledger

# JWT Authentication
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Microsoft OAuth 2.0 Credentials
MICROSOFT_CLIENT_ID=
MICROSOFT_TENANT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=
```

---

## 📜 NPM Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start development server with auto-reload (`nodemon`) |
| `npm run start` | Start production server (`node src/app.js`) |
| `npm run Db:generate` | Generate migration SQL files via Drizzle Kit (`drizzle-kit generate`) |
| `npm run db:push` | Push schema directly to the database via Drizzle Kit (`drizzle-kit push`) |
| `npm test` | Run complete end-to-end automated test suite |

---

## 📖 Swagger API Testing & Documentation

Interactive Swagger documentation is available out of the box:

1. **Interactive Swagger UI**:
   - Start the server (`npm start` or `npm run dev`)
   - Open your browser to: **[http://localhost:3000/docs](http://localhost:3000/docs)** (or `/swagger-ui`, or `https://healthvault.share.zrok.io/rover-ledger/docs`)
   - **Instant Testing with Dummy Code**: On `POST /auth/microsoft`, pass `{"code": "dummy_code"}` (or `{"code": "shraddha"}`). It will instantly create and log in **Shraddha Chauhan** (`shraddha.chauhan@roverledger.com`) and return a JWT token!
   - Click the green **"Authorize 🔓"** button at the top-right and paste the JWT token to test protected routes (`/users/profile`).

2. **Raw OpenAPI 3.0 YAML File**:
   - Accessible locally at: [`swagger.yaml`](file:///e:/Rover_Ledger/swagger.yaml)
   - Or via HTTP: `http://localhost:3000/swagger.yaml`
   - You can copy/import this YAML directly into [Swagger Editor](https://editor.swagger.io/), Postman, or Insomnia.

---

## 🚀 API Documentation

### 1️⃣ Login with Microsoft
- **Method & Route**: `POST /auth/microsoft` (or `POST /auth/microsoft/login`)
- **Description**: Authenticates a user using either a Microsoft authorization code (redirect flow) or a Microsoft access token (from frontend MSAL). Also supports dummy code `{"code": "dummy_code"}` for Swagger testing. Finds or creates the user in `Rover_ledgers` and returns a JWT token.
- **Request Body (Dummy Code for Testing)**:
  ```json
  {
    "code": "dummy_code"
  }
  ```
- **Request Body (Frontend MSAL / Mobile)**:
  ```json
  {
    "accessToken": "EwBAA8l6BAAU..."
  }
  ```
- **Request Body (OAuth Authorization Code)**:
  ```json
  {
    "code": "0.AXo..."
  }
  ```
- **Success Response (`200 OK`)**:
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
        "UserId": 1,
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

> **Convenience Browser Sign-In**:
> - Visit `http://localhost:3000/auth/microsoft` in your web browser. It redirects you directly to the Microsoft login consent page.
> - After consenting, Microsoft redirects back to `http://localhost:3000/auth/microsoft/callback` which finishes the login and renders the JWT token and user profile.

---

### 2️⃣ Profile Fetch
- **Method & Route**: `GET /users/profile` (or `GET /profile`)
- **Headers**:
  ```http
  Authorization: Bearer <YOUR_JWT_TOKEN>
  ```
- **Description**: Retrieves the profile details of the currently authenticated user.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "User profile fetched successfully",
    "data": {
      "UserId": 1,
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
  ```

---

### 3️⃣ Profile Update
- **Method & Route**: `PUT /users/profile` (or `PATCH /users/profile`, `/profile`)
- **Headers**:
  ```http
  Authorization: Bearer <YOUR_JWT_TOKEN>
  Content-Type: application/json
  ```
- **Description**: Updates profile fields for the authenticated user. Automatically recalculates `FullName` if `FirstName` or `LastName` is updated and updates `UpdatedAt`.
- **Request Body**:
  ```json
  {
    "FirstName": "Tulsi",
    "LastName": "Patel",
    "Gender": "Female",
    "Designation": "Senior Full-Stack Engineer"
  }
  ```
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "User profile updated successfully",
    "data": {
      "UserId": 1,
      "FirstName": "Tulsi",
      "LastName": "Patel",
      "FullName": "Tulsi Patel",
      "Email": "tulsi@example.com",
      "Gender": "Female",
      "Role": "User",
      "Designation": "Senior Full-Stack Engineer",
      "isActive": true,
      "CreatedAt": "2026-10-22T06:25:08.002Z",
      "UpdatedAt": "2026-10-22T06:28:12.450Z"
    }
  }
  ```

---

## 📁 Project Directory Structure

```
Rover_Ledger/
├── .env                       # Environment variables (Credentials & DB configs)
├── .env.example               # Template environment variables
├── drizzle.config.js          # Drizzle Kit configuration for migrations and db push
├── package.json               # Dependencies and scripts (Db:generate, db:push, etc.)
├── README.md                  # Complete documentation and setup guide
├── ROVER_LEDGER_BE_FLOW_GUIDE.md # Frontend Integration & BE Architecture Guide
├── swagger.yaml               # OpenAPI 3.0 specification
├── test_endpoints.js          # Automated end-to-end test script for auth & user
├── test_documents.js          # Automated end-to-end test script for documents & OneDrive
├── drizzle/                   # Drizzle migration files
│   └── 0000_young_mojo.sql    # Migration SQL for Rover_ledgers table
└── src/
    ├── app.js                 # Express server initialization, Swagger UI, and middleware
    ├── db.js                  # PostgreSQL pool and Drizzle ORM client setup
    ├── controllers/
    │   ├── auth.controller.js     # Microsoft login and OAuth callbacks
    │   ├── user.controller.js     # Profile fetch and profile update
    │   └── document.controller.js # Document upload, filter, download, delete
    ├── middlewares/
    │   ├── auth.middleware.js     # JWT Bearer token authentication middleware
    │   ├── upload.middleware.js   # Multer file upload handling (50MB memory buffer)
    │   └── error.middleware.js    # Global error and 404 handler middleware
    ├── models/
    │   ├── index.js               # Models aggregator
    │   ├── user.model.js          # Rover_ledgers Drizzle ORM schema
    │   └── document.model.js      # document_details Drizzle ORM schema
    ├── repositories/
    │   ├── user.repository.js     # Database CRUD layer for users
    │   └── document.repository.js # Database CRUD layer for documents
    ├── routes/
    │   ├── auth.routes.js         # /auth routes
    │   ├── user.routes.js         # /users routes
    │   ├── document.routes.js     # /documents routes
    │   └── index.js               # Main routes mounting
    ├── services/
    │   ├── auth.service.js        # Microsoft OAuth, Graph API sync, JWT creation
    │   ├── user.service.js        # Profile retrieval and validation service
    │   ├── document.service.js    # Document orchestration and validations
    │   └── onedrive.service.js    # Microsoft Graph API & OneDrive file streaming
    └── utils/
        ├── jwt.util.js            # JWT sign & verify utility
        ├── microsoft.util.js      # Microsoft OAuth URL, token exchange & Graph API
        └── response.util.js       # Standard success and error response formatting
```