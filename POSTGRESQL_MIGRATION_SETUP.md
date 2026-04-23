# PostgreSQL Migration - Execution Steps

Follow these steps in order to complete the Firestore → PostgreSQL migration.

## ✅ Completed

- [x] PostgreSQL 18 installed
- [x] Node.js installed
- [x] Firebase credentials available
- [x] SMTP configured
- [x] Backend API structure created
- [x] Prisma schema defined
- [x] .env configured
- [x] Migration script created

## 📋 Next Steps to Execute

### Step 1: Install Dependencies (5 minutes)

```bash
cd c:\Users\HP\gps\api
npm install
```

**Expected output:**
```
added XX packages
```

---

### Step 2: Generate Prisma Client (2 minutes)

```bash
npx prisma generate
```

**Expected output:**
```
✔ Generated Prisma Client
```

---

### Step 3: Create PostgreSQL Database and Tables (3 minutes)

```bash
npx prisma migrate dev --name init
```

**What it does:**
- Creates `gps_app` database
- Creates all tables (Request, RequestVehicle, User, etc.)
- Sets up request ID sequence starting from 1

**Expected output:**
```
✔ Your database has been created at "postgresql://gps_user:..."
✔ Database preparation complete

Prisma has executed the following migrations:
✔ 20240324000000_init
```

---

### Step 4: Verify Database Setup (2 minutes)

```bash
psql "host=localhost port=5432 dbname=gps_app user=gps_user password=GpsUser@2024 sslmode=disable" -c "SELECT tablename FROM pg_tables WHERE schemaname='public';"
```

**Expected output:**
```
        tablename        
--------------------------
 User
 Request
 RequestVehicle
 LtpocDetail
 RequestHistory
 Notification
 _prisma_migrations
(7 rows)
```

---

### Step 5: Run Firestore to PostgreSQL Migration (5-10 minutes)

```bash
npx ts-node scripts/migrateFirestore.ts
```

**What it does:**
- Connects to Firestore using service account
- Exports all requests, vehicles, users, history
- Imports to PostgreSQL with proper formatting
- Shows migration summary

**Expected output:**
```
🔄 Starting Firestore → PostgreSQL Migration
📅 2024-03-24T...

👥 Migrating users from Firestore...
Found XX users in Firestore
✅ Migrated XX users

📊 Starting data migration from Firestore to PostgreSQL...
Found XX requests in Firestore
✅ Migrated 10 requests...
✅ Migrated 20 requests...

✨ Migration complete!
📊 Summary:
   ✅ Migrated: XX
   ❌ Failed: 0
   📝 Total: XX

🔗 Sample ID Mappings (Firebase ID → Numeric ID):
   abc123defghi... → 1
   xyz789uvwxyz... → 2
   ...
```

---

### Step 6: Start the API Server (2 minutes)

```bash
npm run dev
```

**Expected output:**
```
✅ Database connected
✅ Firebase Admin SDK initialized  
✅ Company email domain: @letstransport.team

🚀 GPS API Server running on http://localhost:3001

📝 Endpoints:
   GET  /health - Health check
   GET  /health/db - Database health check
   GET  /test/request-id - Request ID format examples
   GET  /users/me - Get current user profile (auth required)
   GET  /requests - List requests (auth required)
   GET  /requests/:requestId - Get request details (auth required)

🔐 Protected endpoints require Firebase token + company email (@letstransport.team)
```

---

### Step 7: Test the API (3 minutes)

#### 7a. Health Check (no auth required)

```bash
curl http://localhost:3001/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2024-03-24T10:30:00.000Z"
}
```

#### 7b. Database Health Check

```bash
curl http://localhost:3001/health/db
```

**Expected response:**
```json
{
  "status": "ok",
  "database": "connected",
  "result": [{ "connection": 1 }]
}
```

#### 7c. Request ID Format Examples

```bash
curl http://localhost:3001/test/request-id
```

**Expected response:**
```json
{
  "requestIdFormat": "REQ-XXXXX",
  "examples": [
    { "numeric": 1, "formatted": "REQ-00001" },
    { "numeric": 100, "formatted": "REQ-00100" },
    { "numeric": 1234, "formatted": "REQ-01234" },
    { "numeric": 10000, "formatted": "REQ-10000" },
    { "numeric": 99999, "formatted": "REQ-99999" }
  ]
}
```

#### 7d. Test Protected Endpoint (requires Firebase auth token)

Get a Firebase ID token from your frontend app, then:

```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3001/users/me
```

**Expected response (if using @letstransport.team email):**
```json
{
  "id": "firebase_uid_here",
  "email": "user@letstransport.team",
  "role": null,
  "profileCompleted": false
}
```

**Expected response (if using non-company email):**
```json
{ 
  "error": "Forbidden: Only @letstransport.team email addresses are allowed" 
}
```

---

## 🎯 Success Criteria

After completing all steps:

- ✅ PostgreSQL database running with all tables created
- ✅ Firestore data migrated to PostgreSQL (all request history intact)
- ✅ API server running on `localhost:3001`
- ✅ Health endpoints return success
- ✅ Request IDs formatted as `REQ-XXXXX` (internal: numeric)
- ✅ Firebase token validation working
- ✅ Company email domain (@letstransport.team) enforced
- ✅ No workflow/UI changes made

---

## 📊 Database Verification

Check data was migrated correctly:

```bash
psql "host=localhost port=5432 dbname=gps_app user=gps_user password=GpsUser@2024 sslmode=disable"
```

Then run:

```sql
-- Check request counts
SELECT COUNT(*) as request_count FROM "Request";

-- Show first few requests
SELECT id, status, "isBulkRequest", "createdAt" FROM "Request" LIMIT 5;

-- Check user counts
SELECT COUNT(*) as user_count FROM "User";

-- View request ID sequence
SELECT last_value FROM "Request_id_seq";
```

---

## ⚠️ Troubleshooting

### Issue: `Database connection refused`

**Solution:**
```bash
# Verify PostgreSQL is running
psql "host=localhost port=5432 dbname=postgres user=postgres sslmode=disable" -c "SELECT 1;"

# If failed, start PostgreSQL service
```

### Issue: `Firebase service account not found`

**Solution:**
```bash
# Verify file path
ls -la "C:\Users\HP\gps\gps-integration-b1a2e-firebase-adminsdk-fbsvc-85d47bd9e0.json"

# Update .env if path is different
```

### Issue: `Migration: Cannot insert duplicate key`

**Solution:**
```bash
# Reset database (WARNING: deletes all data)
npx prisma migrate reset
npx prisma migrate dev
```

### Issue: `Port 3001 already in use`

**Solution:**
```bash
# Find and kill process on port 3001
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Or change PORT in .env and restart
```

---

## 📝 Notes

- Firestore data is NOT deleted; it's read-only copied to PostgreSQL
- Backend still uses Firebase Auth tokens for login
- All request/workflow data now lives in PostgreSQL
- Company email domain check happens on every protected request
- Request IDs are sequential integers (1, 2, 3, ...) formatted as REQ-XXXXX

---

## 🔗 What's Next (Not included in this phase)

Once API is running:

1. Update frontend service calls to point to `http://localhost:3001` (or deployed URL)
2. Build role-specific workflow endpoints (RH approve/reject, Payment actions, etc.)
3. Implement email notification endpoints
4. Add comprehensive test suite
5. Deploy to production environment

---

**Timeline:** All steps above should take 20-30 minutes total
**Status:** Ready to execute
