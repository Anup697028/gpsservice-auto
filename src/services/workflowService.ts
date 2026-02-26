import { serverTimestamp } from 'firebase/firestore';
import {
  REQUEST_STATUSES,
  WORKFLOW_ACTIONS,
  type RequestRecord,
  type WorkflowAction,
  type WorkflowOptionalData,
  type WorkflowUpdateResult,
  type UserRef,
} from '../types/workflow';

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

/**
 * WORKFLOW LOGIC:
 * ===============
 * SINGLE REQUEST (isBulkRequest = false):
 *   FO creates → PARALLEL_REVIEW
 *   RH approves → stays PARALLEL_REVIEW
 *   Payment approves → VENDOR_COORDINATION
 *   Vendor notifies → COMPLETED
 *
 * BULK REQUEST (isBulkRequest = true):
 *   FO creates → FO_CREATED
 *   RH approves → PAYMENT_PENDING
 *   Payment approves → PAYMENT_APPROVED
 *   Vendor notifies → SERVICE_INITIATED
 */
export const updateRequestState = (
  request: RequestRecord | null,
  action: WorkflowAction,
  user: UserRef,
  optionalData: WorkflowOptionalData = {}
): WorkflowUpdateResult => {
  ensureRole(user);

  const statusFrom = request?.status ?? null;
  const isBulk = request?.isBulkRequest ?? false;
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

      // Determine initial status based on bulk flag
      const isBulkRequest = optionalData.isBulkRequest ?? false;
      statusTo = isBulkRequest 
        ? REQUEST_STATUSES.FO_CREATED 
        : REQUEST_STATUSES.PARALLEL_REVIEW;

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
      updates.rhApprovedAt = serverTimestamp();
      statusTo = statusFrom ?? REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_APPROVE: {
      // Single request: Payment approves, moves to vendor coordination
      if (isBulk) {
        throw new Error('Use PAYMENT_BULK_APPROVE for bulk requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      updates.paymentApproval = true;
      updates.paymentApproved = true;
      updates.paymentRejected = false;
      updates.paymentActionTaken = true;
      updates.paymentStatus = 'APPROVED';
      updates.paymentApprovedAt = serverTimestamp();
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.RH_REJECT: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.rhStatus = 'REJECTED';
      updates.rhActionTaken = true;
      updates.status = REQUEST_STATUSES.HALTED;
      updates.rejectionReason = optionalData.rejectionReason;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_REJECT: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.paymentApproved = false;
      updates.paymentRejected = true;
      updates.paymentActionTaken = true;
      updates.paymentStatus = 'REJECTED';
      updates.paymentRejectedAt = serverTimestamp();
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
      updates.rhApprovedAt = serverTimestamp();
      statusTo = statusFrom ?? REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_EDIT_APPROVE: {
      // Single request: Payment edits and approves
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      if (optionalData.updates) {
        Object.assign(updates, optionalData.updates);
      }
      updates.paymentApproval = true;
      updates.paymentStatus = 'APPROVED';
      updates.paymentActionTaken = true;
      updates.paymentApprovedAt = serverTimestamp();
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.status = statusTo;
      break;
    }

    // ===== BULK REQUEST WORKFLOW =====

    case WORKFLOW_ACTIONS.RH_BULK_APPROVE: {
      // ===== PARALLEL BULK APPROVAL =====
      // Bulk: RH compliance approval can happen before or after payment/vendor progress.
      if (!isBulk) {
        throw new Error('use RH_APPROVE for single requests.');
      }
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
        REQUEST_STATUSES.PAYMENT_APPROVED,
        REQUEST_STATUSES.SERVICE_INITIATED,
        REQUEST_STATUSES.COMPLETED,
      ]);
      
      // Set RH approval
      updates.rhStatus = 'APPROVED';
      updates.rhApprovedAt = serverTimestamp();

      // RH compliance action must not move business stage backward.
      statusTo = statusFrom ?? REQUEST_STATUSES.FO_CREATED;
      updates.bothApproved = request?.paymentStatus === 'APPROVED';
      
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.RH_BULK_REJECT: {
      // Bulk: RH rejects at FO_CREATED
      if (!isBulk) {
        throw new Error('Use RH_REJECT for single requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.FO_CREATED]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.rhStatus = 'REJECTED';
      updates.rejectionReason = optionalData.rejectionReason;
      statusTo = REQUEST_STATUSES.HALTED;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_BULK_APPROVE: {
      // ===== PARALLEL BULK APPROVAL =====
      // Bulk: Payment approves at FO_CREATED (independently from RH)
      if (!isBulk) {
        throw new Error('Use PAYMENT_APPROVE for single requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.FO_CREATED, REQUEST_STATUSES.PAYMENT_PENDING]);
      
      // Set Payment approval
      updates.paymentStatus = 'APPROVED';
      updates.paymentApprovedAt = serverTimestamp();

      // Payment approval moves bulk request to vendor stage irrespective of RH approval.
      statusTo = REQUEST_STATUSES.PAYMENT_APPROVED;
      updates.bothApproved = request?.rhStatus === 'APPROVED';
      
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.PAYMENT_BULK_REJECT: {
      // Bulk: Payment rejects at FO_CREATED
      if (!isBulk) {
        throw new Error('Use PAYMENT_REJECT for single requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.FO_CREATED, REQUEST_STATUSES.PAYMENT_PENDING]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.paymentStatus = 'REJECTED';
      updates.rejectionReason = optionalData.rejectionReason;
      statusTo = REQUEST_STATUSES.HALTED;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.VENDOR_BULK_NOTIFY: {
      // Bulk: Vendor notifies at PAYMENT_APPROVED
      if (!isBulk) {
        throw new Error('Use VENDOR_NOTIFY for single requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.PAYMENT_APPROVED]);
      ensureRequiredField(optionalData.vendorName, 'Vendor name');
      updates.vendorStatus = 'NOTIFIED';
      updates.vendorName = optionalData.vendorName;
      updates.vendorApprovedAt = serverTimestamp();
      updates.vendorApprovedBy = user.id;
      statusTo = REQUEST_STATUSES.SERVICE_INITIATED;
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
      updates.notificationTimestamp = serverTimestamp();
      updates.vendorApprovedAt = serverTimestamp();
      updates.vendorApprovedBy = user.id;
      break;
    }

    case WORKFLOW_ACTIONS.FO_REMOVE_VEHICLE: {
      if (!isBulk) {
        throw new Error('Vehicle removal is allowed only for bulk requests.');
      }
      ensureStatus(statusFrom, [REQUEST_STATUSES.FO_CREATED]);

      const vehicleNumber = optionalData.updates?.vehicleNumber as string | undefined;
      if (!vehicleNumber) {
        throw new Error('Vehicle number is required to remove a vehicle.');
      }

      const existingVehicles = (request?.vehicles ?? []) as Array<Record<string, unknown>>;
      const remainingVehicles = existingVehicles.filter(
        (vehicle) => vehicle.vehicleNumber !== vehicleNumber
      );

      if (remainingVehicles.length === existingVehicles.length) {
        throw new Error(`Vehicle ${vehicleNumber} not found in request.`);
      }

      if (remainingVehicles.length === 0) {
        throw new Error('Cannot remove last vehicle. Use cancel request instead.');
      }

      updates.vehicles = remainingVehicles;
      updates.vehicleCount = remainingVehicles.length;
      statusTo = REQUEST_STATUSES.FO_CREATED;
      updates.status = statusTo;
      break;
    }

    case WORKFLOW_ACTIONS.CANCEL: {
      // Both workflows can cancel
      ensureStatus(statusFrom, [
        REQUEST_STATUSES.FO_CREATED,
        REQUEST_STATUSES.PAYMENT_PENDING,
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.VENDOR_COORDINATION,
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
