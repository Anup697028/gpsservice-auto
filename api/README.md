# GPS API - PostgreSQL Migration

Backend API for GPS workflow system using PostgreSQL instead of Firebase Firestore.

## Quick Start

### 1. Install Dependencies

```bash
cd api
npm install
```

### 2. Generate Prisma Client

```bash
npx prisma generate
```

### 3. Create Database and Run Migrations

First, ensure PostgreSQL is running, then:

```bash
npx prisma migrate dev --name init
```

This will:
- Create the `gps_app` database (if not exists)
- Create all required tables
- Set sequence for request ID starting at 1

### 4. Run Firestore to PostgreSQL Migration

```bash
npx ts-node scripts/migrateFirestore.ts
```

This script will:
- Export all requests, vehicles, users, and history from Firestore
- Import data into PostgreSQL with proper field mapping
- Show migration summary with counts

### 5. Start the API Server

```bash
npm run dev
```

Server will start on `http://localhost:3001`

For production containers, `npm run start:prod` now waits for Postgres, applies committed Prisma migrations, baselines legacy databases that were created before migration history existed, and restores core data from Firestore when the database is empty before starting the API.

## Google Secret Manager

This API no longer reads secrets from a `.env` file. It loads the required values from Google Secret Manager through [`src/secretManager.ts`](src/secretManager.ts).

Required IAM role:
- Grant the runtime identity `roles/secretmanager.secretAccessor`.

Secret naming:
- Create one secret per setting and name it exactly after the config key, for example `DATABASE_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `SMTP_HOST`, and `SMTP_PASS`.
- Store the latest value as the `latest` version for each secret.

Local credentials:
- Set `GOOGLE_APPLICATION_CREDENTIALS` to the provided service-account JSON path, or run `gcloud auth application-default login`.
- Keep service-account JSON files outside the repository and point `GOOGLE_APPLICATION_CREDENTIALS` to that external path.
- In Kubernetes or other production runtimes, prefer Workload Identity or an equivalent ADC source instead of mounting the key file directly.

Startup behavior:
- The API preloads required secrets at startup and fails fast if a secret is missing or inaccessible.
- Secrets are cached in memory after the first fetch; values are never logged.

## API Endpoints

### Public Endpoints (No Auth Required)

- `GET /health` - Health check
- `GET /health/db` - Database connectivity check
- `GET /test/request-id` - Request ID format examples

### Protected Endpoints (Require Firebase Token + @letstransport.team Email)

- `GET /users/me` - Get current user profile
- `GET /requests` - List all requests (paginated)
- `GET /requests/:requestId` - Get request details by ID

## Request ID Format

Request IDs are stored as integers in PostgreSQL but formatted as `REQ-00001` for display.

Examples:
- Numeric: `1` → Formatted: `REQ-00001`
- Numeric: `1234` → Formatted: `REQ-01234`
- Numeric: `99999` → Formatted: `REQ-99999`

## Configuration

Non-secret runtime settings still come from the environment, for example `PORT` and `NODE_ENV`.

Secret-backed settings should live in Secret Manager with the same names as the config keys used by the API.

## Database Schema

See `prisma/schema.prisma` for complete schema definition.

Key tables:
- `User` - User profiles and roles
- `Request` - Request details and workflow status
- `RequestVehicle` - Per-vehicle data for bulk requests
- `LtpocDetail` - Local Point of Contact information
- `RequestHistory` - Audit trail for all actions
- `Notification` - Email/notification tracking

## Testing

### Test Health Check

```bash
curl http://localhost:3001/health
```

### Test with Firebase Auth Token

1. Get Firebase ID token from your app
2. Make request with token:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3001/users/me
```

### Test Request ID Formatting

```bash
curl http://localhost:3001/test/request-id
```

## Next Steps

1. ✅ API server running with PostgreSQL
2. ⏳ Database schema initialized
3. ⏳ Firestore data migrated
4. ⏳ Frontend integration (update service calls to new API base URL)
5. ⏳ Role-specific workflow endpoints (RH, Payment, Vendor, FO)
6. ⏳ Email notification endpoints

## Troubleshooting

### Database Connection Failed

```bash
psql "host=localhost port=5432 dbname=postgres user=postgres sslmode=disable" -c "SELECT 1;"
```

### Prisma Migration Issues

```bash
npx prisma migrate reset
# Then re-run: npx prisma migrate dev
```

### Google Application Default Credentials

Verify ADC configuration:
```bash
echo $GOOGLE_APPLICATION_CREDENTIALS
```

## Notes

- Company email domain enforcement: Only `@letstransport.team` emails allowed
- Request IDs auto-increment starting from 1
- Firebase Auth still handles login; PostgreSQL handles request data
- All timestamps use ISO 8601 format
