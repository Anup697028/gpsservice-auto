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

## Environment Variables

All configured in `.env`:

```
DATABASE_URL=postgresql://gps_user:password@localhost:5432/gps_app?sslmode=disable
POSTGRES_HOST=db
POSTGRES_PORT=5432
POSTGRES_USER=gps_user
POSTGRES_PASSWORD=password
POSTGRES_DB=gps_app
FIREBASE_PROJECT_ID=gps-integration-b1a2e
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/firebase-adminsdk.json
COMPANY_EMAIL_DOMAIN=letstransport.team
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=anupgogeri4@gmail.com
SMTP_PASS=ckzjksyurzozkirj
PORT=3001
```

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

### Firebase Service Account Path

Verify the path exists:
```bash
ls -l "C:\Users\HP\gps\gps-integration-b1a2e-firebase-adminsdk-fbsvc-85d47bd9e0.json"
```

## Notes

- Company email domain enforcement: Only `@letstransport.team` emails allowed
- Request IDs auto-increment starting from 1
- Firebase Auth still handles login; PostgreSQL handles request data
- All timestamps use ISO 8601 format
