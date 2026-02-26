# Cleanup Guide: Remove Fake FO Emails

## Status
✅ **Code-level Protection ACTIVE**: All Cloud Functions now reject emails to fake domains

## What Was Fixed

### 1. ✅ Code Validation (Deployed)
- Added `isValidRealEmail()` function that blocks:
  - `fo1@company.com`, `fo2@company.com`, `fo3@company.com`
  - `@company.com`, `@example.com`, `@test.com`, `@test.org`, `@fake.*`, `@dev.*` domains
- All 5 Cloud Functions now validate FO emails before sending
- **Result**: Any attempt to send to fake emails will get HTTP 400 error:
  ```
  Invalid FO email address: fo3@company.com. Please use a real email address.
  ```

### 2. ✅ Dev Server (Updated)
- Updated [dev-email-server.js](dev-email-server.js#L20-L26) mock FO database:
  ```javascript
  // Before:
  'VH001': { foEmail: 'fo1@company.com', foName: 'John Doe' },
  
  // After:
  'VH001': { foEmail: 'operator@test.com', foName: 'John Doe' },
  ```

## Required Cleanup: Firestore Data

### Check for Fake Emails in Firestore
Use Firebase Console to find and delete/update any requests with fake FO emails:

1. **Go to**: Firebase Console → Firestore Database → `requests` collection
2. **Search for documents** where `foEmail` field contains:
   - `fo1@company.com`
   - `fo2@company.com`
   - `fo3@company.com`
3. **For each document found**, either:
   - **Delete** the entire request if it's test data, OR
   - **Update** `foEmail` to a real address (e.g., `operator@test.com`)

### Batch Query (If needed)
Filter: `foEmail == "fo1@company.com"` and delete matching documents

## Testing Verification

### Verify Protection Works
1. Try sending FO notification to a fake email address
2. **Expected result**: HTTP 400 error response
   ```json
   {
     "error": "Invalid FO email address: fo3@company.com. Please use a real email address."
   }
   ```
3. If you get this error, **protection is working** ✅

### Verify Production Works
1. Create/update request with real FO email (e.g., `operator@test.com`)
2. Send FO notification
3. **Expected result**: Email sent successfully to real address

## Important Notes

- ⚠️ **No emails will be sent** to fake addresses anymore
- ⚠️ **Firestore documents** with fake emails still exist until manually deleted
- ✅ **Cloud Functions** will reject any attempts to use fake addresses
- ✅ **Dev server** now uses valid test addresses

## Commands for Cleanup

### To find fake email request IDs (in Firebase Console):
```
foEmail == "fo1@company.com" OR foEmail == "fo2@company.com" OR foEmail == "fo3@company.com"
```

### Once identified, delete via Console or update the foEmail field to valid address

---
**Last Updated**: 2026-02-20  
**Status**: 🟢 Fake emails are now blocked at the application level
