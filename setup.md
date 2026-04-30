# GPS Project Setup

This file documents the current local workflow, the PostgreSQL schema, and the run order needed to set up the project on any developer computer.

## Ports And URLs

- Frontend dev server: `http://localhost:5173`
- Frontend preview server: `http://localhost:4173`
- API server: `http://127.0.0.1:3002`
- Frontend proxy route: `/api`

The Vite config binds the frontend to `0.0.0.0` so it can be reached from other devices on the same network when needed, while still working on the local machine through `localhost`.

## Required Environment Variables

Frontend:

- `VITE_API_BASE_URL` or `BACKEND_API_URL` for the browser-visible API base URL
- `VITE_API_PROXY_TARGET` for the Vite dev proxy target when the API is not running on `127.0.0.1:3002`
- `VITE_PORT` if you want a different frontend dev port
- `VITE_PREVIEW_PORT` if you want a different preview port

Backend:

- `DATABASE_URL`
- `PORT`
- Google Secret Manager access through `GOOGLE_APPLICATION_CREDENTIALS` or application default credentials

## Local Run Order

1. Install backend dependencies in `api/`.
2. Create or point `DATABASE_URL` to the PostgreSQL instance.
3. Run Prisma migrations from `api/`.
4. Start the API on port `3002` or the configured `PORT`.
5. Install frontend dependencies in `frontend/`.
6. Start the frontend with `npm run dev`.
7. Open the app at `http://localhost:5173`.

## Database Schema

The current source of truth is `api/prisma/schema.prisma`.

### User

Fields:

- `id` string, primary key
- `email` string, unique
- `emailNormalized` string, unique
- `role` string, optional
- `name` string, optional
- `employeeId` string, optional
- `phoneNumber` string, optional
- `profileCompleted` boolean, default `false`
- `createdAt` datetime, default now
- `updatedAt` datetime, auto-updated

Purpose:

- Stores authenticated user identity and role mapping.

### Request

Fields:

- `id` integer, auto-increment primary key
- `requestDisplayId` string, optional, unique
- `firebaseId` string, optional, unique
- `status` string, default `REQUEST_CREATED`
- `createdBy` string, optional
- `createdByEmail` string, optional
- `city` string, optional
- `clientName` string, optional
- `isBulkRequest` boolean, default `false`
- `vehicleCount` integer, default `0`
- `assignedRhUserId` string, optional
- `assignedRhEmail` string, optional
- `assignedRhEmailNormalized` string, optional
- `rhStatus` string, optional
- `rhApproval` boolean, default `false`
- `rhApprovedAt` datetime, optional
- `rhApprovalNotes` string, optional
- `rhRejectedAt` datetime, optional
- `rejectionReason` string, optional
- `paymentStatus` string, optional
- `paymentApproved` boolean, default `false`
- `paymentRejected` boolean, default `false`
- `paymentActionTaken` boolean, default `false`
- `paymentApprovedAt` datetime, optional
- `paymentRejectedAt` datetime, optional
- `paymentApproverName` string, optional
- `vendorName` string, optional
- `vendorStatus` string, optional
- `vendorNotified` boolean, default `false`
- `vendorApprovedBy` string, optional
- `vendorApprovedAt` datetime, optional
- `vendorBulkMailSentAt` datetime, optional
- `assignedFoId` string, optional
- `assignedFoEmail` string, optional
- `foNotified` boolean, default `false`
- `foNotifiedAt` datetime, optional
- `foBulkNotifyEnabled` boolean, default `false`
- `createdAt` datetime, default now
- `updatedAt` datetime, auto-updated

Relations:

- Has many `RequestVehicle`
- Has many `LtpocDetail`
- Has many `RequestHistory`

Purpose:

- Stores the workflow record for a transport request across RH, Payment, Vendor, and FO stages.

### RequestVehicle

Fields:

- `id` integer, auto-increment primary key
- `requestId` integer, foreign key to `Request`
- `vehicleNumber` string, optional
- `city` string, optional
- `serviceType` string, optional
- `rhRejected` boolean, default `false`
- `rhRejectionReason` string, optional
- `paymentApproved` boolean, default `false`
- `paymentRejected` boolean, default `false`
- `paymentActionTaken` boolean, default `false`
- `paymentApprovedAt` datetime, optional
- `paymentRejectedAt` datetime, optional
- `paymentRejectionReason` string, optional
- `vendorNotified` boolean, default `false`
- `vendorName` string, optional
- `vehicleAvailabilityLocation` string, optional
- `vehicleAvailableTime` string, optional
- `createdAt` datetime, default now
- `updatedAt` datetime, auto-updated

Index:

- `requestId`

Purpose:

- Stores per-vehicle detail rows for bulk requests.

### LtpocDetail

Fields:

- `id` integer, auto-increment primary key
- `requestId` integer, foreign key to `Request`
- `vehicleNumber` string, optional
- `ltpocName` string, optional
- `ltpocPhone` string, optional
- `createdAt` datetime, default now
- `updatedAt` datetime, auto-updated

Index:

- `requestId`

Purpose:

- Stores local point of contact details for a request.

### RequestHistory

Fields:

- `id` integer, auto-increment primary key
- `requestId` integer, foreign key to `Request`
- `userId` string, optional
- `userName` string, optional
- `role` string, optional
- `action` string, optional
- `statusFrom` string, optional
- `statusTo` string, optional
- `notes` string, optional
- `createdAt` datetime, default now

Indexes:

- `requestId`
- `createdAt`

Purpose:

- Stores the audit trail for every workflow action.

### Notification

Fields:

- `id` integer, auto-increment primary key
- `requestId` integer, optional
- `recipientEmail` string, optional
- `recipientRole` string, optional
- `notificationType` string, optional
- `status` string, default `PENDING`
- `sentAt` datetime, optional
- `failureReason` string, optional
- `retryCount` integer, default `0`
- `createdAt` datetime, default now
- `updatedAt` datetime, auto-updated

Purpose:

- Tracks emails and workflow notifications.

## Workflow Summary

1. A request is created and saved in `Request`.
2. Bulk requests add rows in `RequestVehicle` and `LtpocDetail`.
3. RH reviews and updates approval or rejection fields.
4. Payment reviews and updates payment status fields.
5. Vendor notification and approval fields are updated.
6. FO notification fields are updated.
7. Every state change is written to `RequestHistory`.
8. Every outbound email or notification is written to `Notification`.

## Company Setup Checklist

- Use one PostgreSQL database per environment.
- Run Prisma migrations before opening the frontend.
- Keep frontend API calls on `/api` during development so the Vite proxy can route to the backend.
- Set a real deployed API URL for non-local environments.
- Use the same email domain and authentication rules required by the backend.
- Confirm Secret Manager or ADC access before starting the API.
- Confirm the API port and Vite proxy target are aligned for every developer computer.
