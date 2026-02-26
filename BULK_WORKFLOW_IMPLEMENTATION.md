# Bulk Vehicle Request Implementation Guide

## Overview

This document describes the comprehensive bulk vehicle request system implementation for the GPS installation workflow. The system cleanly separates single and bulk request workflows while maintaining backward compatibility with existing single-request logic.

---

## Architecture Overview

### Two Parallel Workflows

**Single Request Workflow** (Existing):
```
FO creates (manual) → PARALLEL_REVIEW
                    ↓
                RH Review (approval doesn't change status)
                    ↓ (stays PARALLEL_REVIEW)
                Payment Review 
                    ↓ (if approved)
                VENDOR_COORDINATION
                    ↓
                Vendor Notification
                    ↓
                COMPLETED
```

**Bulk Request Workflow** (New - for 2+ vehicles from same location):
```
FO creates (bulk selection) → FO_CREATED
                            ↓
                        RH Review
                            ↓ (if approved)
                        PAYMENT_PENDING
                            ↓
                        Payment Review
                            ↓ (if approved)
                        PAYMENT_APPROVED
                            ↓
                        Vendor Notification
                            ↓
                        SERVICE_INITIATED
```

---

## Key Field Additions

All bulk documents include:

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `isBulkRequest` | boolean | Identifies bulk vs single | `true` |
| `vehicleCount` | number | Num vehicles in request | `7` |
| `rhStatus` | enum | RH team status | `'PENDING'` \| `'APPROVED'` \| `'REJECTED'` |
| `paymentStatus` | enum | Payment team status | `'PENDING'` \| `'APPROVED'` \| `'REJECTED'` |
| `vendorStatus` | enum | Vendor team status | `'PENDING'` \| `'NOTIFIED'` \| `'APPROVED'` |

Single requests continue using:
- `rhApproval` (boolean)
- `paymentApproval` (boolean)
- `vendorNotified` (boolean)

---

## Firestore Rules Architecture

### Single Request Rules
Rules guard transitions:
- RH can only approve at `PARALLEL_REVIEW` (not bulk)
- Payment can only approve at `PARALLEL_REVIEW` (not bulk)
- Vendor can only update at `VENDOR_COORDINATION` (not bulk)

### Bulk Request Rules
- RH bulk: `FO_CREATED` → `PAYMENT_PENDING`
- Payment bulk: `PAYMENT_PENDING` → `PAYMENT_APPROVED`
- Vendor bulk: `PAYMENT_APPROVED` → `SERVICE_INITIATED`

**Key Pattern**: All rules check `isBulkRequest == true` or `!resource.data.isBulkRequest` to route to correct workflow.

```firestore
// RH bulk approval
allow update: if isRole('RH')
  && resource.data.status == 'FO_CREATED'
  && resource.data.isBulkRequest == true
  && request.resource.data.status == 'PAYMENT_PENDING'
  && onlyChanges(['status', 'rhStatus', 'rhApprovedAt', 'updatedAt', 'history']);
```

---

## Frontend Components

### 1. RequestForm.tsx - FO Bulk Creation

**Enhanced Features**:
- ✅ Checkbox selection on vehicle list (optional clear indicator)
- ✅ Shows vehicle count
- ✅ **Location Validation**: Prevents bulk if vehicles have different cities
  - Error shown: `"Bulk request allowed only for vehicles with same location"`
- ✅ Button changes: `"Create Bulk Request (N Vehicles)"` when N > 1
- ✅ Visual indicator: Blue badge `"🚗 Bulk Request (7 Vehicles)"`

**Validation**:
```typescript
const validateBulkLocation = () => {
  const locations = selectedVehicles.map(v => v.city);
  const uniqueLocations = Array.from(new Set(locations));
  
  if (uniqueLocations.length > 1) {
    return {
      valid: false,
      message: `Bulk request allowed only for vehicles with same location. Found: ${uniqueLocations.join(', ')}`
    };
  }
  return { valid: true, message: '' };
};
```

**Request Data**:
```typescript
{
  vehicles: [{vehicleNumber, isNewTrip}],
  isBulkRequest: selectedVehicles.length > 1,
  vehicleCount: selectedVehicles.length,
  // ... rest of fields
}
```

---

### 2. RhDashboard.tsx - RH Bulk Approval

**Display**:
- ✅ Blue background row `#e3f2fd` for bulk requests
- ✅ Badge shows: `"🚗 Bulk (7 vehicles)"`
- ✅ Status column shows `FO_CREATED` for pending bulk

**Approval Logic**:
```typescript
const handleApprove = async () => {
  const isBulk = selectedRequest.isBulkRequest;
  
  if (isBulk) {
    // Validate FO_CREATED status
    if (selectedRequest.status !== REQUEST_STATUSES.FO_CREATED) {
      throw "RH approval only allowed at FO_CREATED stage";
    }
    // Call approveBulkRequest()
    await requestService.approveBulkRequest(requestId, userRef);
    // Transitions: FO_CREATED → PAYMENT_PENDING
  } else {
    // Single request: validates PARALLEL_REVIEW
    await requestService.approveRequest(requestId, userRef, 'RH');
  }
};
```

**Bulk Approve Button**:
- ✅ Separates single (PARALLEL_REVIEW) from bulk (FO_CREATED)
- ✅ Calls different services: `bulkApprove()` vs `bulkApproveBulkRequests()`
- ✅ Shows count: `"7 single requests and 3 bulk requests approved"`

---

### 3. PaymentDashboard.tsx - Payment Bulk Approval

**Subscriptions** (BOTH workflows):
```typescript
useEffect(() => {
  const unsub1 = requestService.subscribeToRequests(
    REQUEST_STATUSES.PARALLEL_REVIEW,  // Single requests
    (data) => { /* ... */ }
  );
  const unsub2 = requestService.subscribeToRequests(
    REQUEST_STATUSES.PAYMENT_PENDING,  // Bulk requests
    (data) => { /* ... */ }
  );
}, []);
```

**Display**:
- ✅ Both single (PARALLEL_REVIEW) and bulk (PAYMENT_PENDING) requests visible
- ✅ Blue background `#e3f2fd` for bulk
- ✅ Vehicle count shows: `"🚗 Bulk Request (7 vehicles)"`

**Approval**:
```typescript
if (isBulk && status === REQUEST_STATUSES.PAYMENT_PENDING) {
  await requestService.approveBulkPayment(requestId, userRef);
  // Transitions: PAYMENT_PENDING → PAYMENT_APPROVED
} else {
  await requestService.approveRequest(requestId, userRef, 'PAYMENT');
  // Transitions: PARALLEL_REVIEW → VENDOR_COORDINATION
}
```

---

### 4. VendorDashboard.tsx - Vendor Bulk Coordination

**Subscriptions** (BOTH workflows):
```typescript
const unsub1 = requestService.subscribeToRequests(
  REQUEST_STATUSES.VENDOR_COORDINATION,  // Single
  (data) => { /* ... */ }
);
const unsub2 = requestService.subscribeToRequests(
  REQUEST_STATUSES.PAYMENT_APPROVED,  // Bulk
  (data) => { /* ... */ }
);
```

**Bulk Row Display**:
- Blue background for bulk
- Shows: `"🚗 Bulk (7 vehicles)"`

**Vendor Notification**:
```typescript
if (isBulk) {
  if (status !== REQUEST_STATUSES.PAYMENT_APPROVED) {
    throw "Bulk vendor notify only at PAYMENT_APPROVED stage";
  }
  await requestService.notifyBulkVendor(requestId, vendorName, userRef);
  // Transitions: PAYMENT_APPROVED → SERVICE_INITIATED
} else {
  await requestService.notifyVendor(requestId, vendorName, userRef);
  // Transitions: VENDOR_COORDINATION → COMPLETED
}
```

---

## Workflow Service (workflowService.ts)

### CREATE Action - Route by isBulkRequest

```typescript
case WORKFLOW_ACTIONS.CREATE: {
  const isBulkRequest = optionalData.isBulkRequest ?? false;
  
  statusTo = isBulkRequest 
    ? REQUEST_STATUSES.FO_CREATED      // Bulk: FO_CREATED
    : REQUEST_STATUSES.PARALLEL_REVIEW; // Single: PARALLEL_REVIEW
  
  updates.rhStatus = 'PENDING';
  updates.paymentStatus = 'PENDING';
  updates.vendorStatus = 'PENDING';
}
```

### Bulk Actions

**RH_BULK_APPROVE**: FO_CREATED → PAYMENT_PENDING
```typescript
case WORKFLOW_ACTIONS.RH_BULK_APPROVE: {
  ensureStatus(statusFrom, [REQUEST_STATUSES.FO_CREATED]);
  updates.rhStatus = 'APPROVED';
  updates.rhApprovedAt = serverTimestamp();
  statusTo = REQUEST_STATUSES.PAYMENT_PENDING;
}
```

**PAYMENT_BULK_APPROVE**: PAYMENT_PENDING → PAYMENT_APPROVED
```typescript
case WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE: {
  ensureStatus(statusFrom, [REQUEST_STATUSES.PAYMENT_PENDING]);
  updates.paymentStatus = 'APPROVED';
  updates.paymentApprovedAt = serverTimestamp();
  statusTo = REQUEST_STATUSES.PAYMENT_APPROVED;
}
```

**VENDOR_BULK_NOTIFY**: PAYMENT_APPROVED → SERVICE_INITIATED
```typescript
case WORKFLOW_ACTIONS.VENDOR_BULK_NOTIFY: {
  ensureStatus(statusFrom, [REQUEST_STATUSES.PAYMENT_APPROVED]);
  updates.vendorStatus = 'NOTIFIED';
  updates.vendorName = optionalData.vendorName;
  updates.vendorApprovedAt = serverTimestamp();
  statusTo = REQUEST_STATUSES.SERVICE_INITIATED;
}
```

---

## Request Service (requestService.ts)

### New Bulk Methods

```typescript
// Single bulk approval
approveBulkRequest(requestId, user)
rejectBulkRequest(requestId, rejectionReason, user)

// Payment bulk
approveBulkPayment(requestId, user)
rejectBulkPayment(requestId, rejectionReason, user)

// Vendor bulk
notifyBulkVendor(requestId, vendorName, user)

// Batch operations
bulkApproveBulkRequests(requestIds, user)     // RH bulk approve multiple
bulkApproveBulkPayment(requestIds, user)      // Payment bulk approve multiple
```

### Implementation Pattern

```typescript
approveBulkRequest: async (requestId, user) => {
  await updateRequestWithWorkflow(
    requestId,
    WORKFLOW_ACTIONS.RH_BULK_APPROVE,
    user
  );
  // workflowService handles validation and status transition
};
```

---

## Workflow Validation Helper (utils/workflowValidator.ts)

Provides validators for UI safety checks:

```typescript
// Check if RH can approve
canRhApprove(status, isBulk) 
// → { canApprove: true/false, message: "..." }

// Check if Payment can approve
canPaymentApprove(status, isBulk)
// → { canApprove: true/false, message: "..." }

// Check if Vendor can notify
canVendorNotify(status, isBulk)
// → { canNotify: true/false, message: "..." }

// Get next status after approval
getNextStatusAfterApproval(currentStatus, isBulk, role)
// → "PAYMENT_PENDING" | "VENDOR_COORDINATION" | null

// Get UI-friendly summary
getWorkflowSummary(status, isBulk)
// → "💳 RH Approved - Awaiting Payment Review"
```

---

## Database Structure

### Example Bulk Request Document

```json
{
  "id": "req_abc123def456",
  "isBulkRequest": true,
  "vehicleCount": 7,
  "vehicles": [
    { "vehicleNumber": "KA-01-AB-1234", "isNewTrip": false },
    { "vehicleNumber": "KA-01-AB-1235", "isNewTrip": false },
    { "vehicleNumber": "KA-01-AB-1236", "isNewTrip": true }
    // ... 4 more vehicles
  ],
  "city": "Mumbai",
  "clientName": "Tech Corp",
  "serviceType": "FleetX",
  "vendorType": "fleetx",
  "status": "PAYMENT_PENDING",
  "rhStatus": "APPROVED",
  "rhApprovedAt": "2025-02-17T10:30:00Z",
  "paymentStatus": "PENDING",
  "vendorStatus": "PENDING",
  "createdBy": "fo_user_123",
  "createdAt": "2025-02-17T09:00:00Z",
  "updatedAt": "2025-02-17T10:30:00Z",
  "history": [
    {
      "action": "CREATE",
      "statusFrom": null,
      "statusTo": "FO_CREATED",
      "userId": "fo_user_123",
      "role": "FO",
      "timestamp": "2025-02-17T09:00:00Z"
    },
    {
      "action": "RH_BULK_APPROVE",
      "statusFrom": "FO_CREATED",
      "statusTo": "PAYMENT_PENDING",
      "userId": "rh_user_456",
      "role": "RH",
      "timestamp": "2025-02-17T10:30:00Z"
    }
  ]
}
```

---

## Status Transitions Reference

### Single Request (isBulkRequest = false)

| From | Action | To | By |
|------|--------|-----|-----|
| PARALLEL_REVIEW | RH_APPROVE | PARALLEL_REVIEW | RH |
| PARALLEL_REVIEW | PAYMENT_APPROVE | VENDOR_COORDINATION | PAYMENT |
| VENDOR_COORDINATION | VENDOR_NOTIFY | COMPLETED | VENDOR |
| PARALLEL_REVIEW | Reject | HALTED | RH/PAYMENT |

### Bulk Request (isBulkRequest = true)

| From | Action | To | By |
|------|--------|-----|-----|
| FO_CREATED | RH_BULK_APPROVE | PAYMENT_PENDING | RH |
| PAYMENT_PENDING | PAYMENT_BULK_APPROVE | PAYMENT_APPROVED | PAYMENT |
| PAYMENT_APPROVED | VENDOR_BULK_NOTIFY | SERVICE_INITIATED | VENDOR |
| Any pending | Reject | HALTED | RH/PAYMENT |

---

## Error Handling

### Common Validation Errors

**"Bulk request allowed only for vehicles with same location"**
- Shown to FO during request creation
- Prevents submission if vehicles from different cities selected

**"RH bulk approval only allowed at FO_CREATED"**
- Shown if RH tries to approve bulk at wrong status
- Prevents illegal workflow transitions

**"Illegal workflow transition from PAYMENT_PENDING to VENDOR_COORDINATION"**
- Thrown by workflowService
- Means bulk request trying single request action

**"Vendor notification only allowed at PAYMENT_APPROVED"**
- Shown when vendor tries to notify bulk at wrong status

---

## Testing Scenarios

### Scenario 1: Successful Bulk Request
1. FO adds 5 vehicles from Mumbai → BulkRequest created (FO_CREATED)
2. RH approves → status: PAYMENT_PENDING
3. Payment approves → status: PAYMENT_APPROVED
4. Vendor notifies → status: SERVICE_INITIATED

### Scenario 2: Mixed Location Validation
1. FO selects:
   - 2 vehicles from Mumbai
   - 3 vehicles from Delhi
2. Validation error shown: "Bulk request allowed only for vehicles with same location. Found: Mumbai, Delhi"
3. Request cannot be submitted

### Scenario 3: RH Rejects Bulk
1. Bulk request at FO_CREATED
2. RH provides rejection reason and rejects
3. Status: HALTED
4. Payment never sees it
5. FO notified of rejection

### Scenario 4: Single Request (No Regression)
1. FO creates single vehicle request
2. isBulkRequest: false, status: PARALLEL_REVIEW
3. RH approves (stays PARALLEL_REVIEW)
4. Payment approves → VENDOR_COORDINATION
5. Vendor notifies → COMPLETED
6. All existing logic preserved

---

## Deployment Checklist

- ✅ Types updated (`src/types/workflow.ts`)
- ✅ Workflow service updated (`src/services/workflowService.ts`)
- ✅ Request service enhanced (`src/services/requestService.ts`)
- ✅ RequestForm improved (`src/components/RequestForm.tsx`)
- ✅ RhDashboard updated (`src/pages/RhDashboard.tsx`)
- ✅ PaymentDashboard updated (`src/pages/PaymentDashboard.tsx`)
- ✅ VendorDashboard updated (`src/pages/VendorDashboard.tsx`)
- ✅ Firestore rules deployed (`firestore.rules`)
- ✅ Validation helper created (`src/utils/workflowValidator.ts`)
- ✅ No breaking changes to single request workflow

---

## Migration Notes

**Existing single requests**: No changes needed
- `isBulkRequest` field defaults to `false`
- Use existing PARALLEL_REVIEW workflow
- All approvals work identically

**New bulk requests**: Automatic routing
- `isBulkRequest: true` in request data
- Automatically routes to FO_CREATED
- Teams see correct dashboard status

---

## Support & Debugging

### Check Request Type
```javascript
const request = requests[0];
console.log('Bulk?', request.isBulkRequest);
console.log('Status:', request.status);
console.log('Vehicles:', request.vehicleCount);
```

### Verify Status Transitions
```javascript
// Use workflow validator
import { getNextStatusAfterApproval } from '../utils/workflowValidator';

const nextStatus = getNextStatusAfterApproval(
  request.status,
  request.isBulkRequest,
  'RH'
);
// Returns expected next status or null if invalid
```

### Inspect History
```javascript
request.history.forEach(entry => {
  console.log(`${entry.action}: ${entry.statusFrom} → ${entry.statusTo} by ${entry.role}`);
});
```

---

## References

- Workflow Type Definitions: `src/types/workflow.ts`
- Workflow Logic: `src/services/workflowService.ts`
- Request Operations: `src/services/requestService.ts`
- Validation Helper: `src/utils/workflowValidator.ts`
- Firestore Rules: `firestore.rules`
