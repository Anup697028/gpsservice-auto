# Stitch Prompt Pack (No Admin)
## GPS Installation Automation System

## Objective
Generate a complete multi-page, role-based UI in Stitch for this project with minute detail coverage for FO, RH, Payment, and Vendor roles.

Use Delhivery and Porter only as visual/interaction references for operational clarity and logistics feel.
Do not copy Delhivery or Porter workflows, screen copy, user journey, or exact layouts.

## Hard Constraints
- No Admin route, page, card, menu, or analytics module.
- Include only these routes: `/login`, `/register`, `/fo-dashboard`, `/rh-dashboard`, `/payment-dashboard`, `/vendor-dashboard`.
- Desktop and mobile responsive behavior is mandatory.
- Build dense but readable operational tables and detail modals.
- Keep workflow language and state names from this project.

## How To Paste In Stitch (Exact)
1. Create one new Stitch project.
2. Paste Prompt 0 first.
3. Paste Prompt 1, then Prompt 2, then Prompt 3, then Prompt 4, then Prompt 5.
4. Paste Prompt 6 at the end to connect routing and polish cross-page consistency.
5. Paste one prompt at a time. Do not paste all at once.
6. In every step, keep previous pages unchanged.

## Prompt 0: Global Foundation And Design System
```text
Create a production-grade multi-page web app UI for "GPS Installation Automation System" with 4 role dashboards only: FO, RH, PAYMENT, VENDOR.

Important reference direction:
- Use Delhivery + Porter only for visual tone: operational clarity, high-signal cards, efficient logistics style.
- Do NOT copy their workflow structure, copywriting, or exact screens.

Do not generate admin pages.

Design language:
- Typography: use "Sora" for headings and "IBM Plex Sans" for body text.
- Visual style: clean operational UI, high contrast, compact but not cramped.
- Color tokens:
	- --bg: #F5F7F8
	- --surface: #FFFFFF
	- --ink: #12212A
	- --muted: #5E6F7C
	- --brand-primary: #F26A21
	- --brand-secondary: #0B7D8D
	- --success: #1E8E4B
	- --warning: #C18400
	- --danger: #C4382A
	- --border: #D8E0E6
- Buttons: strong solid primary, subtle outlined secondary, destructive red variant.
- Motion: 180-220ms transitions, row update flash, modal slide/fade, stagger cards on page load.
- Background: subtle geometric gradient, not flat color.

App shell:
- Desktop: left role-aware sidebar + top utility bar.
- Mobile: top compact header + bottom tab bar for current role sections.
- Include global notification toaster and non-blocking alert banner area.

Create shared reusable components:
- StatusBadge (all status variants)
- SearchInput with icon and clear action
- FilterChip and SelectFilter
- DataTable with sticky header, sortable columns, row checkbox support
- RequestDetailModal with tabs: Summary, Vehicles, Audit Log
- ConfirmActionModal with optional mandatory reason field
- RejectionReasonModal
- Toast stack (success/error/info)
- EmptyState card
- Skeleton loaders for cards and tables

Core data entity to be used across all pages:
- requestId
- createdAt
- createdByEmail
- city
- clientName
- serviceType
- isBulkRequest
- vehicleCount
- vehicles[] where each vehicle has:
	- vehicleNumber
	- serviceType
	- driverName
	- driverNumber
	- lpoNumber
	- ltpocName
	- ltpocPhone
	- paymentApproved (boolean)
	- paymentRejectedReason (optional)
	- vendorNotifiedAt (optional timestamp)
- status values:
	- PARALLEL_REVIEW
	- VENDOR_COORDINATION
	- FO_CREATED
	- PAYMENT_PENDING
	- PAYMENT_APPROVED
	- SERVICE_INITIATED
	- COMPLETED
	- HALTED
	- CANCELLED
- rhStatus: PENDING | APPROVED | REJECTED
- paymentStatus: PENDING | APPROVED | REJECTED
- vendorStatus: PENDING | NOTIFIED
- vendorName
- vendorNotified
- notificationTimestamp
- history[] where each history item has:
	- action
	- byName
	- byRole
	- note
	- fromStatus
	- toStatus
	- at

Status badge mapping:
- PARALLEL_REVIEW: amber
- FO_CREATED: slate
- PAYMENT_PENDING: blue-gray
- PAYMENT_APPROVED: blue
- VENDOR_COORDINATION: teal
- SERVICE_INITIATED: cyan
- COMPLETED: green
- HALTED: red
- CANCELLED: gray

Generate pages as route placeholders now (full page detail will come in next prompts):
- /login
- /register
- /fo-dashboard
- /rh-dashboard
- /payment-dashboard
- /vendor-dashboard
```

## Prompt 1: Login And Register (OTP Flow)
```text
Continue in the same project. Keep all existing pages unchanged.

Build complete `/login` and `/register` pages with role-based entry.

Login page requirements:
- Left panel: product value statement and logistics-themed visual block.
- Right panel: login form card.
- Fields: email, password.
- Actions: Login button, switch to register.
- Validation:
	- invalid email format
	- password required
- Error states:
	- incorrect credentials
	- network issue
- Success state:
	- role-based redirect hint text.

Register page requirements:
- Fields: email, password, confirm password, role selector (FO, RH, PAYMENT, VENDOR).
- Role selector must not include ADMIN.
- OTP flow UI:
	- Step 1: Send OTP
	- Step 2: Enter OTP
	- Step 3: Complete registration
- Include resend OTP countdown UI.
- Validation:
	- password min length 6
	- confirm password match
	- OTP required and 6 digit pattern
- Info panel: "Your role controls dashboard access and actions."

Micro details:
- Show inline helper text under email and password.
- Add password show/hide icon.
- Add loading state for Send OTP, Verify OTP, Register buttons.
- Include legal footer links placeholders.

Mobile behavior:
- Collapse to single-column layout.
- Keep primary actions sticky near bottom when keyboard is open.
```

## Prompt 2: FO Dashboard (Minute Operational Detail)
```text
Continue in the same project. Keep all existing pages unchanged.

Build `/fo-dashboard` with 3 FO subpages exactly and only:
- Dashboard
- History
- Profile

Reference style lock (visual DNA only, do not copy product workflow):
- Match the sharp, dense, operational feel seen in Delhivery and Porter enterprise interfaces.
- Keep logistics-control look: compact tables, clear hierarchy, high signal labels, practical controls.
- No decorative blur or fog effects.

Non-negotiable sharp UI constraints:
- No `backdrop-filter`, no glassmorphism, no translucent blur cards.
- Force crisp text rendering and contrast:
  - `-webkit-font-smoothing: antialiased`
  - `text-rendering: geometricPrecision`
- Typography:
  - headings: Sora 600/700
  - body/table/forms: IBM Plex Sans 400/500
- Spacing density must be compact (4/8/12/16/20 px rhythm).
- Cards: solid white, 1px border, minimal shadow.

FO navigation rules:
- Left nav contains only: Dashboard, History, Profile.
- Remove extra items like Settings, Vehicles, Hardware, Devices for FO.

FO data model fields that must appear in UI (do not skip):
- requestId
- createdAt
- clientName
- city
- assignedRhName
- assignedRhEmail
- isBulkRequest
- vehicleCount
- status
- serviceType
- serviceCost
- lpoNumber
- lpoDate
- vehicles[] with each vehicle containing:
  - vehicleNumber
  - tripType (Old Trip | New Trip)
  - vehicleAvailabilityLocation (place)
  - vehicleAvailableTime
  - serviceType
  - serviceCost
  - driverName
  - driverNumber
  - ltpocName
  - ltpocPhone
  - ltpocEmail

Subpage 1: Dashboard (counts + request panel together in same view)
- Header: "Field Operator Dashboard" with current date/time and help icon.
- Top KPI cards:
  - Total My Requests
  - Pending Review
  - Payment Pending
  - Vendor Pending
  - Completed
- Dashboard body rule:
	- Show only the Create Installation Request form panel below KPIs.
	- Do not show request tables/lists on Dashboard.

Create Installation Request panel (minute details)
- Section: Request Basics
  - city (required)
  - clientName (required)
  - assigned RH selector showing RH name + email (required)
  - bulk mode toggle: Single | Bulk
- Section: Service And Cost (request level)
  - serviceType (required; FleetX or WheelsEye)
  - serviceCost (required and editable numeric)
	- isRefundable (required boolean indicator shown in UI)
  - default mapping:
		- FleetX -> 3000 INR and Refundable = Yes
		- WheelsEye -> 2000 INR and Refundable = No
- Section: LPO
  - lpoNumber (required)
  - lpoDate (required)
- Section: Vehicles
  - searchable vehicle selector
  - add/remove vehicle controls
  - for each vehicle row capture:
    - vehicleNumber (required)
    - tripType toggle: Old Trip | New Trip (required)
    - vehicleAvailabilityLocation (required)
    - vehicleAvailableTime (required)
    - vehicle serviceType (required)
    - vehicle serviceCost (required)
	- vehicle isRefundable (derived from serviceType, visible)
    - driverName (required)
    - driverNumber (required, 10 digits)
    - ltpocName (required)
    - ltpocPhone (required, 10 digits)
    - ltpocEmail (optional)
- Bulk-specific behavior:
  - all selected vehicles must belong to same city and same client
  - exact error message: "Bulk registration allowed only for same client and same city."
  - show per-vehicle LTPOC fields for bulk too (not only request-level)
- CTA:
  - Submit Request
  - Reset Form

Subpage 2: History
- This page must have two tabs, both in table format:
	- Tab 1: New Requests
	- Tab 2: Request History
- Tab 1: New Requests table
	- show active/in-progress request records
	- Columns:
		- Request ID
		- Client
		- City
		- Assigned RH
		- Service Type
		- Service Cost
		- Refundable
		- Vehicle Count
		- Current Status
		- Created At
		- Actions
	- Actions:
		- View
		- Cancel
- Tab 2: Request History table
	- show completed/closed request records
	- Columns:
		- Request ID
		- Client
		- City
		- Service Type
		- Service Cost
		- Refundable
		- Vehicle Count
		- Final Status
		- Created At
		- Updated At
		- Actions
	- Actions:
		- View
		- Cancel (disabled when not allowed, with helper reason)
- Shared controls for both tabs:
	- search
	- date range
	- status
	- city
	- assigned RH
	- pagination

Subpage 3: Profile
- FO profile card with:
  - name
  - email
  - role
  - assigned region/city
- Activity summary:
  - requests created this month
  - pending
  - completed
- recent activity timeline.

Manage Request modal (must be complete)
- Tab 1 Summary:
  - requestId, createdAt, createdByEmail
  - clientName, city
  - assignedRhName, assignedRhEmail
  - serviceType, serviceCost
	- isRefundable
  - lpoNumber, lpoDate
  - workflow snapshot
- Tab 2 Vehicles:
  - for each vehicle show:
    - vehicleNumber
    - tripType (Old/New)
    - availability place + time
    - serviceType + serviceCost
	- refundable yes/no
    - driverName + driverNumber
    - ltpocName + ltpocPhone + ltpocEmail
    - payment/vendor flags
- Tab 3 Audit Log:
  - chronological history with actor role and timestamp.

Cancel flow card/modal (must exist and be complete)
- Cancel button must be present in History tab row actions.
- Clicking Cancel opens a dedicated Cancel Request card/modal containing:
	- request summary (requestId, client, city, status, vehicle count)
	- service summary (serviceType, serviceCost, refundable)
	- warning text for destructive action
- Cancel card/modal must include two options:
  - Cancel entire request
  - Cancel one vehicle from bulk
- If "Cancel one vehicle from bulk" selected:
  - show a dropdown/list to select vehicle to cancel
	- each option displays: vehicleNumber + tripType + serviceType + serviceCost + refundable
- If only one vehicle exists, disable vehicle-level cancel option and show helper text.
- Mandatory final confirmation before destructive action.

Workflow and database alignment (must match project logic)
- Use these request fields: `assignedRhEmail`, `assignedRhUserId`, `isBulkRequest`, `vehicleCount`, `status`, `serviceType`, `serviceCost`, `isRefundable`, `ltpocDetails`, `vehicles[]`.
- On create (single and bulk), initial status must align to `PARALLEL_REVIEW`.
- History tabs status split:
	- New Requests tab: `PARALLEL_REVIEW`, `FO_CREATED`, `PAYMENT_PENDING`, `PAYMENT_APPROVED`, `VENDOR_COORDINATION`, `SERVICE_INITIATED`
	- Request History tab: `COMPLETED`, `HALTED`, `CANCELLED`
- Cancel allowed states must align to workflow gates:
	- `PARALLEL_REVIEW`, `FO_CREATED`, `PAYMENT_PENDING`, `VENDOR_COORDINATION`, `PAYMENT_APPROVED`, `SERVICE_INITIATED`
- Remove vehicle from bulk allowed only when:
	- request is bulk
	- status in `PARALLEL_REVIEW` or `FO_CREATED` or `PAYMENT_PENDING`
	- remaining vehicles after removal >= 1

FO status label mapping:
- PAYMENT_PENDING -> Pending Payment Approval
- PAYMENT_APPROVED -> Pending Vendor Action
- SERVICE_INITIATED -> Pending FO Notification
- COMPLETED -> FO Notified
- HALTED -> Rejected
- CANCELLED -> Cancelled

State handling:
- skeleton loaders
- empty state
- non-blocking warning banner for permission errors

Content context rules:
- Keep project context India-first and logistics-operational.
- Prefer INR-based cost examples; avoid random global currency like AED unless explicitly requested.
```

## Prompt 2B: FO Correction Patch (Use This If FO Is Already Generated Wrong)
```text
Patch only FO screens. Do not touch Login, RH, Payment, or Vendor pages.

Fix FO dashboard output with these strict corrections:
- Keep exactly 3 FO subpages: Dashboard, History, Profile.
- Keep only these FO left-nav items: Dashboard, History, Profile.
- Dashboard must show KPI counts and only the request form panel (no request table/list).
- Add and show missing details everywhere:
	- assignedRhName and assignedRhEmail
	- serviceType and serviceCost
	- isRefundable
	- tripType (Old Trip/New Trip)
	- vehicleAvailabilityLocation and vehicleAvailableTime
	- ltpocName, ltpocPhone, ltpocEmail
	- lpoNumber, lpoDate
- Ensure serviceType + serviceCost + refundable appear in:
	- create request form
	- new requests table
	- history table
	- manage modal summary
	- manage modal vehicle cards
- Add complete cancel flow:
	- row action Cancel
	- dedicated cancel request card/modal with summary details
	- options "Cancel entire request" and "Cancel one vehicle from bulk"
	- vehicle selector for bulk cancellation (vehicle number + trip type + service + cost + refundable)
- Move table listing to History page with two tabs:
	- New Requests (table)
	- Request History (table)
- Enforce compact spacing and remove visual blur:
	- no backdrop blur, no glass cards
	- compact padding/margins
	- crisp high-contrast typography
	- sharp text rendering
- Apply Delhivery/Porter visual tone (dense operational layout), but do not copy their workflow.
- Use India/INR style data context.

Acceptance checklist (regenerate FO until all are true):
- Dashboard, History, Profile all present.
- Dashboard has KPI row + request form only.
- Create form has RH assigned, service type, service cost, trip type, availability place/time, LTPOC, LPO.
- Create form shows refundable yes/no mapped from service type.
- History page has New Requests table and Request History table tabs.
- Bulk flow supports vehicle-level LTPOC and vehicle-level cancel selection.
- Manage modal shows full summary + vehicles + audit.
- No blur visuals and no blurry typography.

Do not change route names.
Do not add admin pages.
```

## Prompt 2C: FO Hard Reset Rebuild (Use If 2B Still Fails)
```text
Rebuild FO screens from scratch. Do not patch partially.
Only FO scope should be rebuilt. Do not touch Login, RH, Payment, Vendor pages.

FO rebuild scope:
- /fo-dashboard with only 3 FO subpages:
	- Dashboard
	- History
	- Profile

Strict rebuild requirements:
- Remove any FO menu items other than Dashboard, History, Profile.
- Dashboard must include in one view:
	- KPI cards row
	- Create Installation Request panel only
- Include all required fields and flows:
	- assigned RH name/email
	- service type
	- service cost
	- refundable yes/no
	- vehicle number
	- trip type old/new
	- availability place and time
	- LTPOC details
	- LPO details
	- bulk request per-vehicle details
	- History page with New Requests table and Request History table
	- cancel entire request
	- cancel selected vehicle from bulk via vehicle selector

Visual constraints:
- Sharp typography and crisp rendering.
- No blur effects.
- Compact spacing.
- Dense operational style inspired by Delhivery/Porter enterprise UI tone.

Data context constraints:
- India/INR style values.
- FleetX/WheelsEye naming.
- Keep project statuses and workflow labels.

Acceptance gate:
- If any required FO field or cancel flow is missing, regenerate FO again before finalizing.
```

## Prompt 2D: FO One-Shot Final Prompt (Single Paste)
```text
FO ONLY REBUILD. Do not touch Login, RH, Payment, Vendor.

Goal:
Create final FO experience with exact flow and exact data details.

Routes and subpages:
- Keep FO to exactly 3 subpages only:
	- Dashboard
	- History
	- Profile
- Remove all extra FO menu items.

Visual direction:
- Sharp, dense, operations-focused UI like Delhivery/Porter enterprise tone.
- Do NOT copy their product workflow or text.
- No blur effects at all:
	- no backdrop blur
	- no translucent glass cards
- Compact spacing and crisp typography.

Dashboard requirements:
- Top KPI row:
	- Total My Requests
	- Pending Review
	- Payment Pending
	- Vendor Pending
	- Completed
- Below KPI row: show only Create Installation Request form.
- Do not show request table/list on Dashboard.

Create Installation Request form (must include all fields):
- Request basics:
	- city
	- clientName
	- assignedRhName/assignedRhEmail selector
	- bulk toggle (Single/Bulk)
- Service and commercial:
	- serviceType
	- serviceCost
	- refundable indicator
	- mapping:
		- FleetX = 3000 INR, refundable yes
		- WheelsEye = 2000 INR, refundable no
- LPO:
	- lpoNumber
	- lpoDate
- Vehicles section (single and bulk):
	- vehicleNumber
	- tripType (Old Trip / New Trip)
	- availability place
	- availability time
	- vehicle service type
	- vehicle service cost
	- vehicle refundable flag
	- driverName
	- driverNumber (10 digits)
	- LTPOC name
	- LTPOC phone (10 digits)
	- LTPOC email
- Bulk validation:
	- all selected vehicles must be same city and same client
	- exact message: "Bulk registration allowed only for same client and same city."

History page requirements:
- Two tabs, both tabular:
	- New Requests
	- Request History
- New Requests table columns:
	- Request ID
	- Client
	- City
	- Assigned RH
	- Service Type
	- Service Cost
	- Refundable
	- Vehicle Count
	- Status
	- Created At
	- Actions (View, Cancel)
- Request History table columns:
	- Request ID
	- Client
	- City
	- Service Type
	- Service Cost
	- Refundable
	- Vehicle Count
	- Final Status
	- Created At
	- Updated At
	- Actions (View, Cancel disabled with reason when not allowed)
- Add filters: search, date range, status, city, assigned RH.

Cancel request card/modal (mandatory):
- Triggered from History table Cancel action.
- Show request summary:
	- requestId
	- client
	- city
	- status
	- vehicle count
	- service type
	- service cost
	- refundable
- Two options:
	- Cancel entire request
	- Cancel one vehicle from bulk request
- On vehicle-cancel option:
	- show vehicle selector
	- each item: vehicle number + trip type + service + cost + refundable
- If only one vehicle exists, disable vehicle-cancel option and show helper text.
- Show final confirmation CTA.

Manage/View modal requirements:
- Tabs: Summary, Vehicles, Audit Log.
- Summary includes assigned RH + service + cost + refundable + LPO.
- Vehicles tab includes per-vehicle trip type, availability place/time, service/cost/refundable, driver, LTPOC.
- Audit log chronological with actor role and timestamp.

Database/workflow alignment rules:
- Use field names:
	- assignedRhEmail
	- assignedRhUserId
	- isBulkRequest
	- vehicleCount
	- status
	- serviceType
	- serviceCost
	- isRefundable
	- ltpocDetails
	- vehicles[]
- New request lifecycle must align to PARALLEL_REVIEW start.
- New Requests tab statuses:
	- PARALLEL_REVIEW
	- FO_CREATED
	- PAYMENT_PENDING
	- PAYMENT_APPROVED
	- VENDOR_COORDINATION
	- SERVICE_INITIATED
- Request History tab statuses:
	- COMPLETED
	- HALTED
	- CANCELLED
- Cancel allowed statuses:
	- PARALLEL_REVIEW
	- FO_CREATED
	- PAYMENT_PENDING
	- VENDOR_COORDINATION
	- PAYMENT_APPROVED
	- SERVICE_INITIATED
- Remove vehicle from bulk allowed only in:
	- PARALLEL_REVIEW
	- FO_CREATED
	- PAYMENT_PENDING

Final acceptance criteria:
- Exactly 3 FO subpages.
- Dashboard has KPI + form only.
- History has New Requests and Request History tables.
- View and Cancel actions are present.
- Cancel card supports cancel selected bulk vehicle.
- Service type, service cost, refundable shown in all required places.
- No blurry fonts and no blur visuals.
```

## Prompt 2E: FO Dashboard Visual Match (Use This To Match Reference-2 Layout)
```text
FO ONLY visual + layout rebuild. Do not touch Login, RH, Payment, Vendor.

Override note:
- Override any previous FO rule that says FO has only 3 subpages.

Target:
- Do NOT generate the style seen in the first output.
- Match the layout and information hierarchy of reference-2 (current FO console style), but make it cleaner and more premium.

FO route structure:
- Keep exactly 4 FO subpages:
	- Dashboard
	- Bulk Requests
	- History
	- Profile
- No extra FO menu items.

Dashboard layout to match reference-2:
1) Left sidebar (dark)
- Dark navy sidebar with logo/brand at top.
- Role subtitle: "Field Operator".
- Menu items only: Dashboard, Bulk Requests, History, Profile.
- Active state: strong, high-contrast highlight.

2) Top command bar
- White compact top bar containing:
	- page title (Field Operations Console)
	- notification icon
	- signed-in info chip
	- logout button

3) KPI strip (compact)
- Compact KPI cards under top bar:
	- Total
	- Pending
	- Completed
- Keep cards dense and readable, not oversized.

4) Main Dashboard content
- Dashboard must contain only the single-request creation area (form-first).
- No request table/list on Dashboard.
- Use one large form card with section blocks in this order:
	- From City
	- Client Name
	- Assign RH
	- Add Vehicle Number (+ add button)
	- Selected Vehicle strip/banner
	- Service Type selector cards
	- Availability Location
	- Available Time
	- LTPOC Details (repeatable rows)
	- LPO Details
	- Submit Request button

Mandatory data details to include in form (do not miss):
- assigned RH (name + email)
- serviceType
- serviceCost
- refundable yes/no
- vehicleNumber
- tripType (Old Trip/New Trip)
- vehicleAvailabilityLocation
- vehicleAvailableTime
- LTPOC details only:
	- vehicleNumber
	- ltpocName
	- ltpocPhone
	- do not show ltpocEmail in this section
- LPO number/date

Service selector card rules (strict):
- FleetX and WheelsEye cards must be compact and minimal.
- Do not show long descriptions under FleetX/WheelsEye.
- Do not add any extra cost/refundable button, chip, or badge.
- For each service card, show these as plain text lines inside the card:
	- `Cost: ₹3000` or `Cost: ₹2000`
	- `Refundable: Yes` or `Refundable: No`
- Keep this in-card and compact, matching the current project pattern.

Bulk Requests page requirements:
- Keep the separate FO subpage: `Bulk Requests` (already part of project structure).
- This page handles bulk request creation and bulk request listing only.
- Include bulk vehicle add section with same-city and same-client validation.
- Show exact validation message:
	- "Bulk registration allowed only for same client and same city."
- Include row actions: View and Cancel.
- Reuse same cancel modal behavior as History page.

History page requirements:
- Two tabular tabs:
	- New Requests
	- Request History
- Both tabs must include View button.
- Cancel button must exist where allowed.
- Cancel must open dedicated cancel card/modal with:
	- Cancel entire request
	- Cancel one vehicle from bulk
	- vehicle selector for bulk cancellation (vehicle number + trip type + service + cost + refundable)
- Cancel modal is mandatory; do not skip it.

Workflow/data alignment rules:
- Use field names from project:
	- assignedRhEmail
	- assignedRhUserId
	- isBulkRequest
	- vehicleCount
	- status
	- serviceType
	- serviceCost
	- isRefundable
	- ltpocDetails
	- vehicles[]
- New request starts at PARALLEL_REVIEW.
- New Requests tab statuses:
	- PARALLEL_REVIEW
	- FO_CREATED
	- PAYMENT_PENDING
	- PAYMENT_APPROVED
	- VENDOR_COORDINATION
	- SERVICE_INITIATED
- History tab statuses:
	- COMPLETED
	- HALTED
	- CANCELLED

Sharp typography and UI quality rules:
- No blur effects of any kind.
- No glassmorphism, no low-contrast haze.
- Use bright black text for all labels/body text (`#000000` or near-black).
- Input fields should be slightly transparent inside (subtle transparency), with black border.
- Buttons should be solid black where needed for emphasis.
- Compact spacing and dense operational layout.
- Clean borders, tight form controls, strong visual hierarchy.
- Keep everything crisp and sharp; do not waste space.

Acceptance criteria:
- Dashboard visually follows reference-2 structure.
- FO has Dashboard + Bulk Requests + History + Profile.
- Form includes all required workflow fields and commercial details.
- History has tabular New Requests + Request History with View/Cancel actions.
- Bulk Requests page exists and supports bulk create + view/cancel.
- Cancel flow includes bulk vehicle selection.
- LTPOC section contains only vehicle number, LTPOC name, LTPOC number.
- UI is crisp, sharp, and attractive.
```

## Prompt 3: RH Dashboard (Compliance Review)
```text
Continue in the same project. Keep all existing pages unchanged.

Patch only the existing RH implementation.
Do not regenerate the full app.
Do not touch Login, FO, Payment, Vendor pages.
Do not create new routes.

Build `/rh-dashboard` with exactly 3 RH subpages only:
- Dashboard
- History
- Profile

RH navigation rules:
- Sidebar and mobile nav must contain only Dashboard, History, Profile.
- Keep existing shell and style language unchanged.

Project-aligned RH data scope:
- Show only requests assigned to signed-in RH (`assignedRhUserId` or `assignedRhEmail`).
- RH-visible statuses include:
	- `PARALLEL_REVIEW`
	- `VENDOR_COORDINATION`
	- `COMPLETED`
	- `HALTED`
	- `CANCELLED`

Dashboard and History split (strict):
- Dashboard must show only New Requests.
- History must show only non-new requests.

New Request definition (match project behavior):
- Request is New only when all are true:
	- status is `PARALLEL_REVIEW` or `VENDOR_COORDINATION` or `COMPLETED`
	- RH decision is still `PENDING`
	- status is not `HALTED` and not `CANCELLED`
- Any other request must appear in History.

Dashboard requirements:
- Header: "Regional Head Console" (or "Regional Head Dashboard").
- KPI cards:
	- Total Assigned
	- New Requests
	- History
- Filter/search row:
	- search by requestId/client/city
	- city filter
	- client filter
	- created date filter
- Table must contain only New Requests.
- Add top action button: `Approve All Pending`.

History requirements:
- Show non-new RH requests only.
- Keep same table columns as Dashboard.
- View action must remain available.
- Approve/Reject must be hidden or disabled when not actionable.

Table columns (project-aligned):
- Request ID
- Status
- Client
- Vehicle Number
- Service Type
- Date
- Action

Row actions:
- View
- Approve
- Reject

Required modal set (all mandatory):
1) View Details modal
- Opens from View button.
- Shows request summary, assigned RH, payment state, location, priority, and status tags.
- Must include modal actions:
	- Approve
	- Edit & Approve
	- Reject

2) Reject modal
- Opens from row Reject or from View modal.
- Rejection reason is mandatory.
- Include character counter and min-length helper.
- Buttons: Cancel and Confirm Reject.
- Block submit when reason is empty.

3) Edit & Approve modal
- Opens from View modal.
- Editable fields:
	- clientName
	- city
- Primary CTA: `Save & Approve`.
- Available only for single requests.
- For bulk requests, disable with helper text.
- Client/city edits allowed only while status is `PARALLEL_REVIEW`; otherwise show helper and allow plain approve flow.

Workflow alignment rules:
- Approve actions:
	- single request -> `RH_APPROVE`
	- bulk request -> `RH_BULK_APPROVE`
- Reject actions (reason required):
	- single request -> `RH_REJECT`
	- bulk request -> `RH_BULK_REJECT`
- Keep status vocabulary exactly:
	- `PARALLEL_REVIEW`, `FO_CREATED`, `PAYMENT_PENDING`, `PAYMENT_APPROVED`, `VENDOR_COORDINATION`, `SERVICE_INITIATED`, `COMPLETED`, `HALTED`, `CANCELLED`
- Keep RH decision vocabulary exactly:
	- `PENDING`, `APPROVED`, `REJECTED`

Profile page requirements:
- Keep compact RH profile summary card.
- Show:
	- Email
	- Division: Regional Head
	- Total Requests
	- Approved
	- New Requests
	- History

Reliability constraints:
- Show disabled actions when request is not actionable.
- Show helper text for blocked actions.
- Keep permission/data-fetch failures non-blocking with warning banner.

Acceptance criteria:
- RH has exactly 3 subpages: Dashboard, History, Profile.
- Dashboard shows only New Requests.
- History shows only non-new requests.
- View Details modal exists and works.
- Reject modal exists and enforces reason.
- Edit & Approve modal exists and works for single requests only.
- Approve All Pending exists on Dashboard.
- Other pages/routes remain unchanged.
```

## Prompt 4: Payment Dashboard (Financial Verification)
```text
Continue in the same project. Keep all existing pages unchanged.

Patch only the existing PAYMENT implementation.
Do not regenerate the full app.
Do not touch Login, FO, RH, Vendor pages.
Do not create new routes.

Build `/payment-dashboard` with exactly 3 PAYMENT subpages only:
- Dashboard
- History
- Profile

Navigation rules:
- Sidebar and mobile nav must contain only Dashboard, History, Profile.
- Keep existing page shell and visual language unchanged.

Project-aligned data scope:
- Use role-scoped payment dataset from current project logic.
- Keep workflow vocabulary unchanged.

Dashboard/History split (strict):
- Dashboard must show only actionable/pending payment rows.
- History must show only processed/non-actionable rows.

Pending/actionable row rules (match project behavior):
- Row is actionable only when:
	- request is not closed (`HALTED`, `CANCELLED` are not actionable), and
	- row is not already actioned (`paymentApproved`, `paymentRejected`, `paymentActionTaken`), and
	- for single request row: request is payment-actionable at `PARALLEL_REVIEW`, and
	- for bulk vehicle row: request is in payment bulk stage (`PARALLEL_REVIEW`, `FO_CREATED`, `PAYMENT_PENDING`).

Page layout:
- Header: "Payment Team Console" (or "Payment Dashboard").
- KPI cards:
	- Total Requests
	- Pending Requests
	- Processed Requests

Filter and control row (must include all current dashboard controls):
- Search input (requestId/client/city/vehicle).
- City filter (All Cities + available cities).
- Date range:
	- From
	- To
- Status filter (History view only):
	- `ALL`
	- `APPROVED`
	- `REJECTED`
- "Show extra details" toggle.
- `Download CSV` button that exports currently visible rows.

Bulk action controls (Dashboard):
- Selected count indicator.
- `Approve Selected (N)` button.
- `Clear Selection` button.
- Add explicit `Approve All Pending` button:
	- selects all currently actionable rows and approves them in one click.
	- keep existing selection-based logic intact.

Operational table requirements:
- Build row-level table from request + vehicle rows.
- Default columns:
	- Select
	- Request ID (with Bulk/Single tag)
	- Status
	- Client
	- Vehicle Number
	- Service Type
	- Service Charge
	- Date
	- Action
- Extra columns when toggle is ON:
	- Location
	- Time
	- LTPOC
	- LTPOC Phone
	- Rejection Reason

Row action behavior:
- View (always visible).
- Approve/Accept when actionable.
- Reject when actionable and rejection reason required.
- Non-actionable rows show reviewed state and prevent duplicate action.

Required modal set:
1) Payment Verification Details modal
- Opens from View row action.
- Shows summary:
	- requestId
	- workflow status
	- vehicle count
	- bulk flag
- Shows per-vehicle details:
	- vehicle number
	- service type
	- service cost (INR)
	- location/time
	- LTPOC name/phone
	- payment state
	- rejection reason if rejected
- Modal CTAs:
	- Close
	- Approve
	- Reject

2) Payment Reject modal
- Opens from row or details modal.
- Mandatory rejection reason.
- Buttons: Cancel and Confirm Reject.
- Block submit when reason is empty.

Workflow/data alignment rules:
- Single approve action:
	- `PAYMENT_APPROVE` -> move request to `VENDOR_COORDINATION`.
- Single reject action:
	- `PAYMENT_REJECT` with mandatory reason -> `HALTED`.
- Bulk row approve/reject action:
	- use row-level bulk payment update logic by vehicle index.
	- when all vehicles processed:
		- if at least one approved -> `VENDOR_COORDINATION`
		- if all rejected -> `HALTED`
- Keep `paymentStatus` values aligned (`PENDING` / `APPROVED` / `REJECTED`).

Rejection reason resolver (must match current priority):
- row-level reason
- request-level reason
- latest payment-reject note from history

CSV export requirements (current-view rows):
- Include columns:
	- Request ID
	- Status
	- Client
	- City
	- Service Type
	- Vehicle Number
	- Service Charge
	- Availability Location
	- Available Time
	- LTPOC Name
	- LTPOC Phone
	- Payment Approved
	- Payment Rejected
	- Rejection Reason
	- Date

Profile page requirements:
- Keep compact profile summary card.
- Show:
	- Email
	- Division: Payment Team
	- Total Requests
	- Pending Rows
	- Approved Rows
	- Rejected Rows

Reliability constraints:
- Show non-blocking success/error banners.
- Keep actions disabled while operation is in progress.
- Preserve page behavior when filters change.

Acceptance criteria:
- PAYMENT has exactly 3 subpages: Dashboard, History, Profile.
- Dashboard shows only actionable rows; History shows only processed rows.
- Download CSV button is visible and exports current view.
- All filters from existing dashboard are present and working.
- Approve All Pending and Approve Selected controls are present and working.
- View details modal and Reject modal are both present and functional.
- Other pages/routes remain unchanged.
```

## Prompt 5: Vendor Dashboard (Final Coordination)
```text
Continue in the same project. Keep all existing pages unchanged.

Patch only the existing VENDOR implementation.
Do not regenerate the full app.
Do not touch Login, FO, RH, Payment pages.
Do not create new routes.

Build `/vendor-dashboard` with exactly 3 VENDOR subpages only:
- Dashboard
- History
- Profile

Navigation rules:
- Sidebar and mobile nav must contain only Dashboard, History, Profile.
- Keep current shell and visual language unchanged.

Dashboard/History split (strict, project-aligned):
- Dashboard shows only requests with pending vendor action or pending FO notification.
- History shows requests with no remaining vendor/FO action.

Pending-action rules (must match project workflow):
- Vendor notify allowed only when:
	- request is not closed (`HALTED`, `CANCELLED`),
	- `vendorNotified` is false,
	- `foNotified` is false,
	- at least one vendor-eligible row exists,
	- status is `VENDOR_COORDINATION` or `COMPLETED`.
- FO notify allowed only when:
	- request is not closed,
	- `vendorNotified` is true,
	- `foNotified` is false,
	- vendor-eligible rows exist,
	- status is `VENDOR_COORDINATION` or `COMPLETED`.

Page layout:
- Header: "Vendor Coordinator Console" (or "Vendor Coordinator Dashboard").
- KPI cards:
	- Total Pending
	- FO Pending
	- Completed

Filter and control row (must include all existing dashboard controls):
- Search input (requestId/client/city).
- Date range:
	- From
	- To
- Clear Dates button.
- Download CSV button for current visible rows.

Selection and bulk action bar:
- Selected count indicator.
- Bulk Notify Vendor button with selected count.
- Notify FO button with selected count.
- Clear Selection button.

Main table (project-aligned columns):
- Select
- Request ID (with Bulk/Single tag)
- Status
- Client
- Service Type
- Vehicles
- Date
- Action

Row actions:
- View (always available)
- Notify Vendor (only when vendor action is allowed)
- Notify FO (only when FO notify is allowed)
- Show "No pending action" when neither action is allowed.

Required modal set: exactly 3 modals only
1) Vendor Request Details modal
- Opens from View action.
- Shows summary:
	- requestId
	- status label
	- vehicle count
	- vendor/service summary
	- created and last updated timestamps
- Shows per-vehicle details:
	- vehicle number
	- service type
	- location/time
	- LTPOC name/phone
- Shows audit log timeline from request history.

2) Notify Vendor confirmation modal
- Opens before single-row and bulk vendor notify submit.
- Shows selected request count and vendor grouping preview.
- Primary action confirms vendor notification.
- Cancel action closes modal.

3) Notify FO confirmation modal
- Opens before single-row and bulk FO notify submit.
- Shows selected request count and FO payload summary.
- Primary action confirms FO notification.
- Cancel action closes modal.

Do not create any additional modal beyond these three.

Workflow/action alignment:
- Single request vendor notify:
	- send vendor payload by mapped vendor (`FleetX`/`WheelsEye` or mixed)
	- execute `VENDOR_NOTIFY`
- Bulk request vendor notify:
	- consolidate selected rows by vendor and send grouped payloads
	- execute `VENDOR_BULK_NOTIFY`
- FO notify action:
	- send consolidated FO payload
	- mark `foNotified = true`
- Keep status and flags aligned with project:
	- `vendorNotified`, `foNotified`, `vendorName`, `notificationTimestamp`
	- status vocabulary: `PARALLEL_REVIEW`, `VENDOR_COORDINATION`, `FO_CREATED`, `PAYMENT_PENDING`, `PAYMENT_APPROVED`, `SERVICE_INITIATED`, `COMPLETED`, `HALTED`, `CANCELLED`

CSV export requirements (current view):
- Include columns:
	- Request ID
	- Status
	- Client
	- City
	- Vendor
	- Service Type
	- Vehicle Number
	- Availability Location
	- Available Time
	- LTPOC Name
	- LTPOC Phone
	- Vendor Notified
	- FO Notified
	- Date

Profile page requirements:
- Keep compact profile summary card.
- Show:
	- Email
	- Division: Vendor Coordinator
	- Total Requests
	- Vendor Pending
	- FO Pending
	- History
	- Completed

Reliability constraints:
- Keep buttons disabled while vendor operations are running.
- Show non-blocking success/error banners.
- Preserve current page behavior when filters change.

Acceptance criteria:
- VENDOR has exactly 3 subpages: Dashboard, History, Profile.
- Dashboard shows vendor/FO pending actions only.
- History shows non-actionable/completed rows.
- Download CSV button is present and exports current view.
- Notify Vendor and Notify FO buttons are present at row and bulk levels.
- Exactly 3 modals exist: Details, Notify Vendor Confirm, Notify FO Confirm.
- Other pages/routes remain unchanged.
```

## Prompt 6: Final Route Wiring And Consistency Pass
```text
Continue in the same project. Keep all existing pages unchanged.

Do a final pass to ensure:
- all routes are wired and navigable:
	- /login
	- /register
	- /fo-dashboard
	- /rh-dashboard
	- /payment-dashboard
	- /vendor-dashboard
- no admin route or menu item exists
- shared components and tokenized styles are consistent across all pages
- all tables have loading, empty, and error states
- all destructive actions use confirmation modals
- mobile layouts are complete for all dashboards
- role labels and action buttons are consistent in wording

Add a sample seed data panel (UI-only) for testing visual states:
- one single request in PARALLEL_REVIEW
- one bulk request in PAYMENT_APPROVED
- one request in SERVICE_INITIATED
- one request in COMPLETED
- one rejected request in HALTED
```

## Recovery Prompt (Use Only If Stitch Overwrites Existing Pages)
```text
Do not redesign or remove existing pages.
Only add the requested page/section from this prompt.
Preserve current design system, color tokens, spacing, and components.
If there is a conflict, keep existing implementation and append the new section below it.
```
