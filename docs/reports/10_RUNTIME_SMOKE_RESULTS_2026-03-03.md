# Runtime Smoke Results (2026-03-03)

## Scope
Post-deploy backend smoke verification for dashboard-integrated functions.

## Environment
- Project: `gps-integration-b1a2e`
- Region: `us-central1`
- Runtime: `nodejs20`

## Deployed Functions (Verified)
- `validateVehicle`
- `vehicles`
- `sendOTP`
- `sendVendorNotification`
- `sendVendorBulkNotification`
- `sendFoBulkNotification`
- `notifyFO`

## Endpoint Checks

### Positive checks
1. `POST /validateVehicle`
- Request body: `{"vehicleNumber":"KA-01-AB-1234"}`
- Result: `200`
- Payload confirmed: `isRegistered=true`, city/client present

2. `GET /vehicles`
- Result: `200`
- Payload confirmed: vehicle list present (`count=4`)

### Guardrail/validation checks
1. `GET sendOTP` (no payload)
- Result: `400` (expected validation failure)

2. `GET sendVendorNotification` (no payload)
- Result: `400` (expected validation failure)

3. `GET sendVendorBulkNotification` (no payload)
- Result: `400` (expected validation failure)

4. `GET sendFoBulkNotification` (no auth)
- Result: `401` (expected auth requirement)

5. `GET notifyFO` (no required params)
- Result: `400` (expected validation failure)

## Interpretation
- Backend is reachable and active.
- New FO vehicle APIs are live and returning valid data.
- Notification endpoints enforce expected input/auth constraints.
- Integration is ready for UI role-flow runtime checks.

## Remaining manual verification
Perform user-flow checks in app UI:
- FO: create/cancel/remove-vehicle
- RH: approve/reject/edit/bulk approve
- Payment: approve/reject/edit/bulk row actions
- Vendor: notify vendor + notify FO
