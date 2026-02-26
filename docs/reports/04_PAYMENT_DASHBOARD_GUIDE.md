# Payment Dashboard Guide
## Payment Team - Step-by-Step

## 1) Dashboard purpose
Payment dashboard validates service cost and budget readiness, then approves/rejects requests (including bulk/vehicle-level behavior).

## 2) Filter and prepare review queue
1. Open Payment dashboard.
2. Use search for request/client/city values.
3. Apply date range and city filters.
4. Apply action filter: ALL / APPROVED / NOT_APPROVED.

## 3) Review request details
- Open request modal.
- Validate service type and service cost.
- Review vehicle details and LTPOC/LPO data.
- Check history before action.

## 4) Approve flow
1. Select single request row or eligible rows.
2. Approve action.
3. Confirm status movement to next stage (`VENDOR_COORDINATION` for single path / bulk progression states).

## 5) Reject flow
1. Choose request or target vehicle row.
2. Click reject.
3. Enter mandatory rejection reason.
4. Submit and verify rejection status.

## 6) Bulk and row-level behavior
- Dashboard supports operational table rows from request + vehicle data.
- Per-row status includes approved/rejected/action-taken flags.
- Rejection reason resolution may come from row, request field, or history notes.

## 7) Best practices
- Validate service type normalization (FleetX/WheelsEye).
- Ensure every rejection has a clear reason.
- Use filters before high-volume actions.
- Confirm post-action status labels to avoid duplicate handling.
