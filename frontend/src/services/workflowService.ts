import {
  REQUEST_STATUSES,
  WORKFLOW_ACTIONS,
  type RequestRecord,
  type WorkflowAction,
  type WorkflowOptionalData,
  type WorkflowUpdateResult,
  type UserRef,
} from '../types/workflow';

const createTimestamp = () => new Date().toISOString();

const ensureRole = (user: UserRef) => {
  if (!user?.id || !user?.role) {
    throw new Error('User identity is required to update workflow state.');
  }
};

const ensureStatus = (currentStatus: string | null | undefined, allowed: string[]) => {
  if (!currentStatus || !allowed.includes(currentStatus)) {
    throw new Error(`Illegal workflow transition from status: ${currentStatus ?? 'NONE'}`);
  }
};

const ensureRequiredField = (value: string | undefined, fieldName: string) => {
  if (!value) {
    throw new Error(`${fieldName} is required for this action.`);
  }
};

const normalizeVehicleNumberKey = (value: unknown) =>
  String(value ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const toVehicleArray = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => ((value as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>);
  }

  return [];
};

const isBulkRequestFlag = (value: unknown) => {
  if (value === true || value === 1) {
    return true;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  return false;
};

/**
 * WORKFLOW LOGIC:
 * ===============
 * UNIFIED WORKFLOW (single + bulk):
 *   FO creates → PARALLEL_REVIEW
 *   RH approves → stays PARALLEL_REVIEW
 *   Payment approves → VENDOR_COORDINATION
 *   Vendor notifies → COMPLETED
 */
export const updateRequestState = (
  request: RequestRecord | null,
  action: WorkflowAction,
  user: UserRef,
  optionalData: WorkflowOptionalData = {}
): WorkflowUpdateResult => {
  ensureRole(user);

  const statusFrom = request?.status ?? null;
  const isBulk = isBulkRequestFlag(request?.isBulkRequest);
  let statusTo: string | null = statusFrom;
  const updates: Record<string, unknown> = {};

  switch (action) {
    case WORKFLOW_ACTIONS.CREATE: {
      // ============================================
      // CREATE: Initialize request (single or bulk)
      // ============================================
      if (statusFrom) {
        throw new Error('Request already exists and cannot be created again.');
      }

      // Unified initial status for both single and bulk requests.
      statusTo = REQUEST_STATUSES.PARALLEL_REVIEW;

      updates.status = statusTo;
      
      // Initialize single request workflow fields
      updates.rhApproval = false;
      updates.paymentApproval = false;
      
      // Initialize bulk request workflow fields
      updates.rhStatus = 'PENDING';
      updates.paymentStatus = 'PENDING';
      updates.vendorStatus = 'PENDING';
      
      // Common fields
      updates.vendorName = null;
      updates.rejectionReason = null;
      updates.notificationTimestamp = null;
      break;
    }

    // ===== SINGLE REQUEST WORKFLOW =====
    
    case WORKFLOW_ACTIONS.RH_APPROVE: {
      // Single request: RH compliance approval can happen in parallel or later stages.
      if (isBulk) {
        throw new Error('Use RH_BULK_APPROVE for bulk requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.COMPLETED,
      ]);
      updates.rhApproval = true;
      updates.rhActionTaken = true;
      updates.rhStatus = 'APPROVED';
      updates.rhApprovedAt = createTimestamp();
      statusTo = statusFrom ?? REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_APPROVE: {
      // Single request: Payment approves, moves to vendor coordination
      if (isBulk) {
        throw new Error('Use PAYMENT_BULK_APPROVE for bulk requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      updates.paymentApproval = true;
      updates.paymentApproved = true;
      updates.paymentRejected = false;
      updates.paymentActionTaken = true;
      updates.paymentStatus = 'APPROVED';
      updates.paymentApprovedAt = createTimestamp();
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.RH_REJECT: {
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.rhStatus = 'REJECTED';
      updates.rhActionTaken = true;
      updates.status = REQUEST_STATUSES.HALTED;
      updates.rejectionReason = optionalData.rejectionReason;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_REJECT: {
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.paymentApproved = false;
      updates.paymentRejected = true;
      updates.paymentActionTaken = true;
      updates.paymentStatus = 'REJECTED';
      updates.paymentRejectedAt = createTimestamp();
      updates.status = REQUEST_STATUSES.HALTED;
      updates.rejectionReason = optionalData.rejectionReason;
      break;
    }

    case WORKFLOW_ACTIONS.RH_EDIT_APPROVE: {
      // Single request: RH edits and approves (compliance-friendly)
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.COMPLETED,
      ]);
      if (optionalData.updates) {
        Object.assign(updates, optionalData.updates);
      }
      updates.rhApproval = true;
      updates.rhActionTaken = true;
      updates.rhStatus = 'APPROVED';
      updates.rhApprovedAt = createTimestamp();
      statusTo = statusFrom ?? REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_EDIT_APPROVE: {
      // Single request: Payment edits and approves
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      if (optionalData.updates) {
        Object.assign(updates, optionalData.updates);
      }
      updates.paymentApproval = true;
      updates.paymentStatus = 'APPROVED';
      updates.paymentActionTaken = true;
      updates.paymentApprovedAt = createTimestamp();
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.status = statusTo;
      break;
    }

    // ===== BULK REQUEST WORKFLOW =====

    case WORKFLOW_ACTIONS.RH_BULK_APPROVE: {
      // Bulk follows the same rule as single: RH approval is parallel, no vendor move.
      if (!isBulk) {
        throw new Error('use RH_APPROVE for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
        REQUEST_STATUSES.PAYMENT_APPROVED,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.SERVICE_INITIATED,
        REQUEST_STATUSES.COMPLETED,
      ]);
      
      // Set RH approval
      updates.rhStatus = 'APPROVED';
      updates.rhApprovedAt = createTimestamp();

      // RH compliance action must not move business stage backward.
      statusTo = statusFrom ?? REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.bothApproved = request?.paymentStatus === 'APPROVED';
      
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.RH_BULK_REJECT: {
      // Bulk follows the same rejection gate as single.
      if (!isBulk) {
        throw new Error('Use RH_REJECT for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.rhStatus = 'REJECTED';
      updates.rejectionReason = optionalData.rejectionReason;
      statusTo = REQUEST_STATUSES.HALTED;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE: {
      // Bulk follows the same vendor gate as single: payment approval opens vendor stage.
      if (!isBulk) {
        throw new Error('Use PAYMENT_APPROVE for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      
      // Set Payment approval
      updates.paymentStatus = 'APPROVED';
      updates.paymentApprovedAt = createTimestamp();

      // Payment approval moves request to vendor stage irrespective of RH approval.
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.bothApproved = request?.rhStatus === 'APPROVED';
      
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_BULK_REJECT: {
      // Bulk follows the same rejection gate as single.
      if (!isBulk) {
        throw new Error('Use PAYMENT_REJECT for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.paymentStatus = 'REJECTED';
      updates.rejectionReason = optionalData.rejectionReason;
      statusTo = REQUEST_STATUSES.HALTED;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.VENDOR_BULK_NOTIFY: {
      // Bulk follows the same vendor stage as single.
      if (!isBulk) {
        throw new Error('Use VENDOR_NOTIFY for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.PAYMENT_APPROVED,
      ]);
      ensureRequiredField(optionalData.vendorName, 'Vendor name');
      updates.vendorStatus = 'NOTIFIED';
      updates.vendorName = optionalData.vendorName;
      updates.vendorApprovedAt = createTimestamp();
      updates.vendorApprovedBy = user.id;
      statusTo = REQUEST_STATUSES.COMPLETED;
      updates.status = statusTo;
      break;
    }

    // ===== SINGLE REQUEST VENDOR PATH =====

    case WORKFLOW_ACTIONS.VENDOR_NOTIFY: {
      // Single request: Vendor notifies at VENDOR_COORDINATION
      if (isBulk) {
        throw new Error('Use VENDOR_BULK_NOTIFY for bulk requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.VENDOR_COORDINATION]);
      ensureRequiredField(optionalData.vendorName, 'Vendor name');
      statusTo = REQUEST_STATUSES.COMPLETED;
      updates.status = statusTo;
      updates.vendorName = optionalData.vendorName;
      updates.notificationTimestamp = createTimestamp();
      updates.vendorApprovedAt = createTimestamp();
      updates.vendorApprovedBy = user.id;
      break;
    }

    case WORKFLOW_ACTIONS.FO_REMOVE_VEHICLE: {
      if (!isBulk) {
        throw new Error('Vehicle removal is allowed only for bulk requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
      ]);

      const vehicleNumber = optionalData.updates?.vehicleNumber as string | undefined;
      const vehicleKey = normalizeVehicleNumberKey(vehicleNumber);
      if (!vehicleKey) {
        throw new Error('Vehicle number is required to remove a vehicle.');
      }

      const existingVehicles = toVehicleArray(request?.vehicles);
      const remainingVehicles = existingVehicles.filter(
        (vehicle) => normalizeVehicleNumberKey(vehicle?.vehicleNumber) !== vehicleKey
      );

      if (remainingVehicles.length === existingVehicles.length) {
        throw new Error(`Vehicle ${vehicleNumber} not found in request.`);
      }

      if (remainingVehicles.length === 0) {
        throw new Error('Cannot remove last vehicle. Use cancel request instead.');
      }

      updates.vehicles = remainingVehicles;
      if (Array.isArray(request?.ltpocDetails)) {
        const remainingLtpocDetails = (request?.ltpocDetails as Array<Record<string, unknown>>).filter(
          (entry) => normalizeVehicleNumberKey(entry?.vehicleNumber) !== vehicleKey
        );
        updates.ltpocDetails = remainingLtpocDetails;
      }
      updates.vehicleCount = remainingVehicles.length;
      statusTo = statusFrom;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.CANCEL: {
      // Both workflows can cancel
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.PAYMENT_APPROVED,
        REQUEST_STATUSES.SERVICE_INITIATED,
        REQUEST_STATUSES.HALTED,
        'REQUEST_CREATED'
      ]);
      statusTo = REQUEST_STATUSES.CANCELLED;
      updates.status = statusTo;
      break;
    }

    default: {
      throw new Error(`Unsupported workflow action: ${action}`);
    }
  }

  const historyEntry = {
    userId: user.id,
    userName: user.name ?? user.email ?? null,
    role: user.role,
    action,
    statusFrom,
    statusTo,
    timestamp: new Date(),
    notes: optionalData.notes ?? null,
  };

  return {
    statusFrom,
    statusTo,
    updates,
    historyEntry,
  };
};
