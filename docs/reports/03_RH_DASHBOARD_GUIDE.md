# RH Dashboard Guide
## Regional Head (RH) - Step-by-Step

## 1) Dashboard purpose
RH performs compliance review for all FO requests and can perform individual or bulk actions.

## 2) Find requests quickly
1. Open RH dashboard.
2. Use search by request ID/client/city.
3. Apply filters: city, client, date.
4. Open a request from table for detail review.

## 3) Review and approve a single request
1. Open request modal.
2. Validate request data and history.
3. Click approve action.
4. Confirm success toast and status update.

## 4) Reject a single request
1. Open request.
2. Click reject.
3. Enter mandatory rejection reason.
4. Submit rejection.

## 5) Bulk approval flow
1. Select multiple eligible requests.
2. Trigger bulk approve action.
3. System skips ineligible requests and processes valid ones.
4. Validate counts and status updates after operation.

## 6) RH workflow constraints
- RH action is blocked when request state is not allowed.
- Single request approvals are allowed in specific workflow states (`PARALLEL_REVIEW`, `VENDOR_COORDINATION`, `COMPLETED` behavior supported in compliance flow).
- Bulk actions use dedicated bulk workflow logic.

## 7) Best practices
- Always check prior actions in history.
- Add clear rejection reasons.
- Use filters before bulk operations.
- Recheck if Payment already acted to avoid stale assumptions.
