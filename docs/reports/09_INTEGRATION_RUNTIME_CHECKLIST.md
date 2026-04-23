# Integration Runtime Checklist (UI Updated, Workflow Preserved)

## 1) Preflight
- Ensure frontend env has Firebase keys.
- Optional: set `VITE_FUNCTIONS_BASE_URL` and/or `VITE_FO_API_BASE_URL`.
- Build status (already verified):
  - `npm run build` (root) ✅
  - `npm run build` (functions) ✅

## 2) Deploy backend functions
```powershell
firebase deploy --only functions
```

Functions expected live:
- `sendOTP`
- `validateVehicle`
- `vehicles`
- `sendVendorNotification`
- `sendVendorBulkNotification`
- `sendFoBulkNotification`

## 3) Role-by-role smoke tests

### FO (Field Operator)
- Create single request with one vehicle.
- Create bulk request with 2+ vehicles.
- Cancel single request.
- Remove one vehicle from a bulk request.

Expected backend paths:
- `foApiService.validateVehicle` -> `/validateVehicle`
- `requestService.createRequest`
- `requestService.cancelRequest`
- `requestService.removeBulkVehicle`

### RH (Regional Head)
- Open request list and verify real-time load.
- Approve one request.
- Reject one request with reason.
- Edit & approve one request.
- Bulk approve mixed eligible requests.

Expected backend paths:
- `requestService.approveRequest` / `approveBulkRequest`
- `requestService.rejectRequest` / `rejectBulkRequest`
- `requestService.editAndApprove`
- `requestService.bulkApprove` / `bulkApproveBulkRequests`

### Payment Team
- Approve single request.
- Reject single request with reason.
- Approve/reject bulk vehicle rows.
- Edit & approve.

Expected backend paths:
- `requestService.approveRequest` / `approveBulkPayment`
- `requestService.rejectRequest` / `rejectBulkPayment`
- `requestService.updateBulkPaymentVehicles`
- `requestService.editAndApprove`

### Vendor Coordinator
- Notify vendor (single request).
- Notify vendor (bulk selection).
- Notify FO for completed vendor step.

Expected backend paths:
- `functionsService.sendVendorBulkNotification`
- `requestService.notifyVendor` / `notifyBulkVendor`
- `functionsService.sendFoBulkNotification`

### Login/Register
- Login with existing account.
- Register new account with OTP.

Expected backend paths:
- `functionsService.sendOTP`
- Firebase Auth login/register flow

## 4) Acceptance criteria
- UI is Stitch-style.
- Workflow transitions remain unchanged.
- Actions persist in Firestore and reflect in role dashboards.
- Notification flows succeed without frontend service errors.

## 5) Quick troubleshooting
- If FO vehicle checks fail: verify `/validateVehicle` and `/vehicles` deployed.
- If OTP fails: verify SMTP env in functions project.
- If vendor/FO mail fails: verify Functions URL and auth token path.
- If status not updating: check Firestore rules and function logs.
