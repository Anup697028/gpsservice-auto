# GPS Installation Workflow Logic

## ✅ Corrected Workflow Sequence

```
1. FO CREATES REQUEST
   Status: PARALLEL_REVIEW
   - FO can create single or bulk requests
   - Bulk requests must have same location
   - Auto-stores: isBulkRequest, vehicleCount

2. RH APPROVAL (Optional - Compliance Check)
   Status: PARALLEL_REVIEW → PARALLEL_REVIEW (no status change)
   - RH reviews and approves for compliance
   - Sets: rhApproval = true, rhActionTaken = true
   - Status remains at PARALLEL_REVIEW for Payment team

3. PAYMENT APPROVAL (Required - Budget Check)
   Status: PARALLEL_REVIEW → VENDOR_COORDINATION
   - Payment team reviews and approves budget
   - Sets: paymentApproval = true, paymentActionTaken = true
   - Status changes to VENDOR_COORDINATION

4. VENDOR COORDINATION
   Status: VENDOR_COORDINATION → VENDOR_COORDINATION
   - Vendor coordinator notifies vendor
   - Sets: vendorNotified = true, vendorName, notificationTimestamp
   - Status stays at VENDOR_COORDINATION

5. VENDOR APPROVAL
   Status: VENDOR_COORDINATION → COMPLETED (future)
   - Vendor approves and confirms service
   - Sets: approvedByVendor = true, vendorActionTaken = true
   - Can mark as COMPLETED when service initiated
```

## 🔒 Workflow Validation Rules

### RH Approval
- **ONLY allowed at:** PARALLEL_REVIEW
- **NOT allowed at:** VENDOR_COORDINATION (after payment approval)
- **Reason:** RH approval is for initial compliance check before budget approval

### Payment Approval
- **ONLY allowed at:** PARALLEL_REVIEW
- **Moves to:** VENDOR_COORDINATION
- **Reason:** Payment approval triggers vendor coordination phase

### Vendor Actions
- **ONLY allowed at:** VENDOR_COORDINATION
- **Reason:** Vendor can only act after both RH and Payment approvals

## 📋 Bulk Request Features

### FO Bulk Vehicle Selection
- Allow multiple vehicle selection
- **Validation:** All vehicles must have same location
- **Error:** "Bulk request allowed only for vehicles with same location"

### LPO Details Auto Count
- Automatically stores: `vehicleCount = selectedVehicles.length`
- Flags: `isBulkRequest = true` (if > 1 vehicle)
- Used for reporting and tracking

## 🚫 Prevented Issues

1. **RH Approval After Payment:** RH cannot approve once status is VENDOR_COORDINATION
2. **Illegal Workflow Transitions:** Strict validation prevents status jumping
3. **Payment Team Visibility:** Payment team sees all PARALLEL_REVIEW requests
4. **Mixed Location Bulk:** FO cannot create bulk request with different locations

## 🔄 Status Transitions Matrix

| From | Action | To | Who |
|------|--------|-----|-----|
| PARALLEL_REVIEW | RH Approve | PARALLEL_REVIEW | RH |
| PARALLEL_REVIEW | RH Reject | HALTED | RH |
| PARALLEL_REVIEW | Payment Approve | VENDOR_COORDINATION | PAYMENT |
| PARALLEL_REVIEW | Payment Reject | HALTED | PAYMENT |
| PARALLEL_REVIEW | FO Cancel | CANCELLED | FO |
| VENDOR_COORDINATION | Vendor Notify | VENDOR_COORDINATION | VENDOR |
| VENDOR_COORDINATION | Vendor Approve | VENDOR_COORDINATION | VENDOR |
| VENDOR_COORDINATION | FO Cancel | CANCELLED | FO |

## 📝 Database Fields

### New Fields Added
- `isBulkRequest: boolean` - Indicates if request has multiple vehicles
- `vehicleCount: number` - Total vehicles in request (auto-calculated)
- `rhActionTaken: boolean` - Prevents multiple RH actions
- `paymentActionTaken: boolean` - Prevents multiple Payment actions
- `vendorActionTaken: boolean` - Prevents multiple Vendor actions
- `vendorNotified: boolean` - Tracks vendor notification status

### Existing Fields
- `status: string` - Current workflow status
- `rhApproval: boolean` - RH approval flag
- `paymentApproval: boolean` - Payment approval flag
- `vendorName: string` - Vendor assigned
- `history: array` - Action history log
