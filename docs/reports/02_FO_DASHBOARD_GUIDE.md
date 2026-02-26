# FO Dashboard Guide
## Field Operator (FO) - Step-by-Step

## 1) Dashboard purpose
The FO dashboard is used to create and track installation requests and manage pre-approval updates.

## 2) Create a request
1. Open FO dashboard.
2. Use request form to enter request details.
3. Add vehicle and LTPOC/driver details.
4. Submit request.
5. Verify request appears in **My Requests** table.

## 3) Search and monitor requests
- Use search box to find by request ID or client name.
- Review status badge and created date.
- Use **View** to inspect request details and audit log.

## 4) Cancel flow
### A) Cancel entire request
- Allowed at early workflow stages (`PARALLEL_REVIEW` / `FO_CREATED` contexts).
- Click **Cancel**, confirm action.

### B) Remove one vehicle from bulk request
- Open cancel options.
- Select vehicle.
- Remove selected vehicle.
- If only one vehicle remains, cancel entire request instead.

## 5) Status labels FO sees
FO table maps workflow status into user-readable labels such as:
- Pending Payment Approval
- Pending Vendor Action
- Pending FO Notification
- FO Notified
- Rejected
- Cancelled

## 6) FO operational do/don’t
- Do verify all phone fields are valid 10 digits before submit.
- Do review details before cancellation.
- Don’t expect cancellation/removal at locked workflow stages.
- Don’t submit partial bulk data.

## 7) Troubleshooting
- **No requests visible**: Confirm login role = FO and records `createdBy` your UID.
- **Cancel blocked**: Request stage already moved forward.
- **Data mismatch in view modal**: Refresh and re-check latest real-time state.
