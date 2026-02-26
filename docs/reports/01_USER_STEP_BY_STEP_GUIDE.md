# GPS Installation Automation System
## User Step-by-Step Guide (All Roles)

## 1) What this system does

The application manages GPS installation requests from creation to vendor execution using role-based dashboards:
- FO (Field Operator)
- RH (Regional Head)
- Payment Team
- Vendor Coordinator
- Admin (analytics)

---

## 2) Sign in or register

### Step 1: Open the app
- Go to the application URL.
- You land on the Login page.

### Step 2: Login (existing user)
- Enter email and password.
- Click **Login**.
- You are auto-redirected to your role dashboard.

### Step 3: Register (new user)
- Switch to **Register** mode.
- Enter email + password (minimum 6 chars).
- Select role (FO, RH, PAYMENT, VENDOR).
- Click **Send OTP**.
- Enter OTP from email.
- Click **Register**.

> Note: Admin users are protected by role; admin route is `/admin`.

---

## 3) End-to-end request lifecycle (business view)

### Single Request Path
1. FO creates request.
2. RH reviews (approve/reject).
3. Payment reviews (approve/reject).
4. Vendor coordinator notifies vendor.
5. Request completes.

### Bulk Request Path
1. FO creates multi-vehicle request.
2. RH and Payment perform compliance/finance actions with bulk logic.
3. Vendor coordinator processes vendor notification/export.
4. FO receives bulk status notifications after vendor action.

---

## 4) Statuses you will see

Common statuses:
- `PARALLEL_REVIEW`
- `VENDOR_COORDINATION`
- `FO_CREATED`
- `PAYMENT_PENDING`
- `PAYMENT_APPROVED`
- `SERVICE_INITIATED`
- `COMPLETED`
- `HALTED`
- `CANCELLED`

---

## 5) Role responsibilities

- **FO**: Create requests, manage own request list, cancel request, remove vehicles (bulk stage rules apply).
- **RH**: Compliance review, approve/reject single and bulk requests.
- **Payment**: Budget/cost review, approve/reject at request or vehicle-level flows.
- **Vendor Coordinator**: Notify vendor, send bulk notifications, export data, trigger FO notifications.
- **Admin**: View real-time analytics summary.

---

## 6) Common user mistakes and fixes

- **Cannot approve due to status**: Request is in a stage where your action is not allowed.
- **OTP failure**: Check SMTP setup / email availability.
- **Missing role redirect**: Ensure user role is present in Firestore `users` collection.
- **Bulk validation errors**: Ensure vehicles satisfy same-location/client constraints where required by workflow.

---

## 7) Best-practice usage checklist

- Keep FO request data complete (vehicle details, LPO/LTPOC details).
- Use rejection reason whenever rejecting.
- Review audit/history before making final approvals.
- Use dashboard filters before bulk actions.
- Track final completion/notification status before closing operations.
