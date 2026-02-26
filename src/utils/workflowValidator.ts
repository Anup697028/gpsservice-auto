/**
 * Workflow Validation Helper Functions
 * 
 * Validates allowed state transitions in both single and bulk request workflows
 */

import { REQUEST_STATUSES } from '../types/workflow';

/**
 * SINGLE REQUEST WORKFLOW TRANSITIONS:
 * FO creates → PARALLEL_REVIEW
 *   RH can approve/reject at PARALLEL_REVIEW (stays at PARALLEL_REVIEW if approved)
 *   Payment can approve/reject at PARALLEL_REVIEW
 * Payment approves → VENDOR_COORDINATION
 *   Vendor can notify at VENDOR_COORDINATION
 * Vendor notifies → COMPLETED
 */
const SINGLE_REQUEST_TRANSITIONS: Record<string, string[]> = {
  [REQUEST_STATUSES.PARALLEL_REVIEW]: [
    REQUEST_STATUSES.PARALLEL_REVIEW, // RH approval doesn't change status
    REQUEST_STATUSES.VENDOR_COORDINATION, // Payment approval moves to vendor coordination
    REQUEST_STATUSES.HALTED, // Either RH or Payment can reject
  ],
  [REQUEST_STATUSES.VENDOR_COORDINATION]: [
    REQUEST_STATUSES.COMPLETED, // Vendor notifies
  ],
};

/**
 * BULK REQUEST WORKFLOW TRANSITIONS:
 * FO creates → FO_CREATED
 *   RH approves/rejects
 * RH approves → PAYMENT_PENDING
 *   Payment approves/rejects
 * Payment approves → PAYMENT_APPROVED
 *   Vendor notifies
 * Vendor notifies → SERVICE_INITIATED
 */
const BULK_REQUEST_TRANSITIONS: Record<string, string[]> = {
  [REQUEST_STATUSES.FO_CREATED]: [REQUEST_STATUSES.PAYMENT_PENDING, REQUEST_STATUSES.HALTED],
  [REQUEST_STATUSES.PAYMENT_PENDING]: [
    REQUEST_STATUSES.PAYMENT_APPROVED,
    REQUEST_STATUSES.HALTED,
  ],
  [REQUEST_STATUSES.PAYMENT_APPROVED]: [
    REQUEST_STATUSES.SERVICE_INITIATED,
    REQUEST_STATUSES.HALTED,
  ],
  [REQUEST_STATUSES.SERVICE_INITIATED]: [
    // Service initiated is an end state
  ],
};

/**
 * Validates if a status transition is allowed for single requests
 * @param fromStatus Current status
 * @param toStatus Desired status
 * @returns Object with valid flag and message
 */
export const validateSingleRequestTransition = (
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined
): { valid: boolean; message: string } => {
  if (!fromStatus || !toStatus) {
    return { valid: false, message: 'Invalid status values' };
  }

  const allowedTransitions = SINGLE_REQUEST_TRANSITIONS[fromStatus] || [];
  
  if (!allowedTransitions.includes(toStatus)) {
    return {
      valid: false,
      message: `Invalid workflow transition from ${fromStatus} to ${toStatus}. Allowed: ${allowedTransitions.join(', ') || 'None'}`,
    };
  }

  return { valid: true, message: '' };
};

/**
 * Validates if a status transition is allowed for bulk requests
 * @param fromStatus Current status
 * @param toStatus Desired status
 * @returns Object with valid flag and message
 */
export const validateBulkRequestTransition = (
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined
): { valid: boolean; message: string } => {
  if (!fromStatus || !toStatus) {
    return { valid: false, message: 'Invalid status values' };
  }

  const allowedTransitions = BULK_REQUEST_TRANSITIONS[fromStatus] || [];
  
  if (!allowedTransitions.includes(toStatus)) {
    return {
      valid: false,
      message: `Invalid bulk workflow transition from ${fromStatus} to ${toStatus}. Allowed: ${allowedTransitions.join(', ') || 'None'}`,
    };
  }

  return { valid: true, message: '' };
};

/**
 * Validates RH can approve at this status
 * - Single requests: PARALLEL_REVIEW only
 * - Bulk requests: FO_CREATED only
 */
export const canRhApprove = (
  status: string | null | undefined,
  isBulk: boolean
): { canApprove: boolean; message: string } => {
  if (!status) {
    return { canApprove: false, message: 'Status is required' };
  }

  if (isBulk) {
    if (status === REQUEST_STATUSES.FO_CREATED) {
      return { canApprove: true, message: '' };
    }
    return {
      canApprove: false,
      message: `RH bulk approval only allowed at FO_CREATED. Current: ${status}`,
    };
  }

  // Single request
  if (status === REQUEST_STATUSES.PARALLEL_REVIEW) {
    return { canApprove: true, message: '' };
  }

  return {
    canApprove: false,
    message: `RH approval only allowed at PARALLEL_REVIEW. Current: ${status}`,
  };
};

/**
 * Validates Payment can approve at this status
 * - Single requests: PARALLEL_REVIEW only
 * - Bulk requests: PAYMENT_PENDING only
 */
export const canPaymentApprove = (
  status: string | null | undefined,
  isBulk: boolean
): { canApprove: boolean; message: string } => {
  if (!status) {
    return { canApprove: false, message: 'Status is required' };
  }

  if (isBulk) {
    if (status === REQUEST_STATUSES.PAYMENT_PENDING) {
      return { canApprove: true, message: '' };
    }
    return {
      canApprove: false,
      message: `Payment bulk approval only allowed at PAYMENT_PENDING. Current: ${status}`,
    };
  }

  // Single request
  if (status === REQUEST_STATUSES.PARALLEL_REVIEW) {
    return { canApprove: true, message: '' };
  }

  return {
    canApprove: false,
    message: `Payment approval only allowed at PARALLEL_REVIEW. Current: ${status}`,
  };
};

/**
 * Validates Vendor can notify at this status
 * - Single requests: VENDOR_COORDINATION only
 * - Bulk requests: PAYMENT_APPROVED only
 */
export const canVendorNotify = (
  status: string | null | undefined,
  isBulk: boolean
): { canNotify: boolean; message: string } => {
  if (!status) {
    return { canNotify: false, message: 'Status is required' };
  }

  if (isBulk) {
    if (status === REQUEST_STATUSES.PAYMENT_APPROVED) {
      return { canNotify: true, message: '' };
    }
    return {
      canNotify: false,
      message: `Bulk vendor notification only allowed at PAYMENT_APPROVED. Current: ${status}`,
    };
  }

  // Single request
  if (status === REQUEST_STATUSES.VENDOR_COORDINATION) {
    return { canNotify: true, message: '' };
  }

  return {
    canNotify: false,
    message: `Vendor notification only allowed at VENDOR_COORDINATION. Current: ${status}`,
  };
};

/**
 * Gets the next expected status after an approval action
 * Useful for UI predictive displays
 */
export const getNextStatusAfterApproval = (
  currentStatus: string | null | undefined,
  isBulk: boolean,
  role: 'RH' | 'PAYMENT' | 'VENDOR'
): string | null => {
  if (!currentStatus) return null;

  if (isBulk) {
    switch (currentStatus) {
      case REQUEST_STATUSES.FO_CREATED:
        return role === 'RH' ? REQUEST_STATUSES.PAYMENT_PENDING : null;
      case REQUEST_STATUSES.PAYMENT_PENDING:
        return role === 'PAYMENT' ? REQUEST_STATUSES.PAYMENT_APPROVED : null;
      case REQUEST_STATUSES.PAYMENT_APPROVED:
        return role === 'VENDOR' ? REQUEST_STATUSES.SERVICE_INITIATED : null;
      default:
        return null;
    }
  }

  // Single request
  switch (currentStatus) {
    case REQUEST_STATUSES.PARALLEL_REVIEW:
      return role === 'RH' ? REQUEST_STATUSES.PARALLEL_REVIEW : // RH stays at PARALLEL_REVIEW
             role === 'PAYMENT' ? REQUEST_STATUSES.VENDOR_COORDINATION : null;
    case REQUEST_STATUSES.VENDOR_COORDINATION:
      return role === 'VENDOR' ? REQUEST_STATUSES.COMPLETED : null;
    default:
      return null;
  }
};

/**
 * Summarizes workflow state for UI display
 */
export const getWorkflowSummary = (
  status: string | null | undefined,
  isBulk: boolean
): string => {
  if (!status) return 'Status Unknown';

  if (isBulk) {
    switch (status) {
      case REQUEST_STATUSES.FO_CREATED:
        return '🆕 FO Created - Awaiting RH Review';
      case REQUEST_STATUSES.PAYMENT_PENDING:
        return '💳 RH Approved - Awaiting Payment Review';
      case REQUEST_STATUSES.PAYMENT_APPROVED:
        return '✅ Payment Approved - Ready for Vendor';
      case REQUEST_STATUSES.SERVICE_INITIATED:
        return '🚀 Service Initiated - Vendor Notified';
      case REQUEST_STATUSES.HALTED:
        return '⛔ Request Halted';
      default:
        return status;
    }
  }

  // Single request
  switch (status) {
    case REQUEST_STATUSES.PARALLEL_REVIEW:
      return '📋 RH Review & Payment Pending';
    case REQUEST_STATUSES.VENDOR_COORDINATION:
      return '🏢 Vendor Coordination';
    case REQUEST_STATUSES.COMPLETED:
      return '✅ Service Completed';
    case REQUEST_STATUSES.HALTED:
      return '⛔ Request Halted';
    default:
      return status;
  }
};
