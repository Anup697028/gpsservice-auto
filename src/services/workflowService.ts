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

export const updateRequestState = (
  request: RequestRecord | null,
  action: WorkflowAction,
  user: UserRef,
  optionalData: WorkflowOptionalData = {}
): WorkflowUpdateResult => {
  ensureRole(user);

  const statusFrom = request?.status ?? null;
  let statusTo: string | null = statusFrom;
  const updates: Record<string, unknown> = {};

  switch (action) {
    case WORKFLOW_ACTIONS.CREATE: {
      if (statusFrom) {
        throw new Error('Request already exists and cannot be created again.');
      }
      statusTo = REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      updates.rhApproval = false;
      updates.paymentApproval = false;
      updates.vendorName = null;
      updates.rejectionReason = null;
      updates.notificationTimestamp = null;
      break;
    }
    case WORKFLOW_ACTIONS.RH_APPROVE: {
      // RH approval can happen at PARALLEL_REVIEW (before PAYMENT) or VENDOR_COORDINATION (after PAYMENT)
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW, REQUEST_STATUSES.VENDOR_COORDINATION]);
      updates.rhApproval = true;
      // Status doesn't change on RH approval - they are just marking compliance. Status is controlled by PAYMENT.
      statusTo = statusFrom;
      updates.status = statusTo;
      break;
    }
    case WORKFLOW_ACTIONS.PAYMENT_APPROVE: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      updates.paymentApproval = true;
      // Payment approval moves to VENDOR_COORDINATION. RH approval is optional for compliance.
      statusTo = REQUEST_STATUSES.VENDOR_COORDINATION;
      updates.status = statusTo;
      break;
    }
    case WORKFLOW_ACTIONS.RH_REJECT: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.status = REQUEST_STATUSES.HALTED;
      updates.rejectionReason = optionalData.rejectionReason;
      break;
    }
    case WORKFLOW_ACTIONS.PAYMENT_REJECT: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      ensureRequiredField(optionalData.rejectionReason, 'Rejection reason');
      updates.status = REQUEST_STATUSES.HALTED;
      updates.rejectionReason = optionalData.rejectionReason;
      break;
    }
    case WORKFLOW_ACTIONS.RH_EDIT_APPROVE: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW, REQUEST_STATUSES.VENDOR_COORDINATION]);
      if (optionalData.updates) {
        Object.assign(updates, optionalData.updates);
      }
      updates.rhApproval = true;
      // Status doesn't change on RH approval - they are just marking compliance.
      statusTo = statusFrom;
      updates.status = statusTo;
      break;
    }
    case WORKFLOW_ACTIONS.PAYMENT_EDIT_APPROVE: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.PARALLEL_REVIEW]);
      if (optionalData.updates) {
        Object.assign(updates, optionalData.updates);
      }
      updates.paymentApproval = true;
      statusTo = request?.rhApproval
        ? REQUEST_STATUSES.VENDOR_COORDINATION
        : REQUEST_STATUSES.PARALLEL_REVIEW;
      updates.status = statusTo;
      break;
    }
    case WORKFLOW_ACTIONS.VENDOR_NOTIFY: {
      ensureStatus(statusFrom, [REQUEST_STATUSES.VENDOR_COORDINATION]);
      ensureRequiredField(optionalData.vendorName, 'Vendor name');
      statusTo = REQUEST_STATUSES.COMPLETED;
      updates.status = statusTo;
      updates.vendorName = optionalData.vendorName;
      updates.notificationTimestamp = serverTimestamp();
      break;
    }
    case WORKFLOW_ACTIONS.CANCEL: {
      ensureStatus(statusFrom, [
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
    timestamp: new Date(), // Use Date for history entries (arrays can't contain serverTimestamp)
    notes: optionalData.notes ?? null,
  };

  return {
    statusFrom,
    statusTo,
    updates,
    historyEntry,
  };
};
