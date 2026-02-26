# Vendor Dashboard Guide
## Vendor Coordinator - Step-by-Step

## 1) Dashboard purpose
Vendor dashboard handles final coordination: selecting eligible requests, notifying vendors, exporting operational data, and triggering FO notifications.

## 2) Identify eligible requests
1. Open Vendor dashboard.
2. Use search and date filters.
3. Review pending/eligible request list.
4. Open request details to confirm vehicle eligibility.

## 3) Vendor notification flow
1. Select request(s).
2. Trigger vendor notification action.
3. System calls backend notification endpoints.
4. Verify `vendorNotified` behavior and notification timestamps.

## 4) Bulk notification and export
- Bulk mode supports structured row payload generation.
- Export to spreadsheet uses `xlsx` logic for operational sharing.
- Generated exports include city, client, service, vehicle, LTPOC, and LPO details.

## 5) FO notification flow
- After vendor actions, FO bulk notification can be sent through secured function calls.
- Auth token is applied for protected backend routes where required.

## 6) Vendor constraints
- Only vendor-stage requests are actionable.
- For bulk requests, payment-approved and non-rejected vehicle subsets are used.
- Already-notified records are prevented from duplicate notifications.

## 7) Best practices
- Verify vendor mapping (`FleetX`, `WheelsEye`) before sending.
- Confirm recipient emails/environment configuration.
- Export data before final bulk notification for audit.
