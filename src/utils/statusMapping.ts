import { REQUEST_STATUSES } from '../types/workflow';

const STATUS_LABELS: Record<string, string> = {
  [REQUEST_STATUSES.FO_CREATED]: 'Pending RH & Payment Approval',
  [REQUEST_STATUSES.PAYMENT_PENDING]: 'Pending Payment Approval',
  [REQUEST_STATUSES.PAYMENT_APPROVED]: 'Pending Vendor Action',
  [REQUEST_STATUSES.PARALLEL_REVIEW]: 'Pending RH & Payment Approval',
  [REQUEST_STATUSES.VENDOR_COORDINATION]: 'Pending Vendor Action',
  [REQUEST_STATUSES.SERVICE_INITIATED]: 'Pending FO Notification',
  [REQUEST_STATUSES.COMPLETED]: 'Completed',
  [REQUEST_STATUSES.HALTED]: 'Rejected',
  [REQUEST_STATUSES.CANCELLED]: 'Cancelled',
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  [REQUEST_STATUSES.FO_CREATED]: 'status-pending',
  [REQUEST_STATUSES.PAYMENT_PENDING]: 'status-pending',
  [REQUEST_STATUSES.PAYMENT_APPROVED]: 'status-vendor-coordination',
  [REQUEST_STATUSES.PARALLEL_REVIEW]: 'status-parallel-review',
  [REQUEST_STATUSES.VENDOR_COORDINATION]: 'status-vendor-coordination',
  [REQUEST_STATUSES.SERVICE_INITIATED]: 'status-pending',
  [REQUEST_STATUSES.COMPLETED]: 'status-completed',
  [REQUEST_STATUSES.HALTED]: 'status-rejected',
  [REQUEST_STATUSES.CANCELLED]: 'status-cancelled',
};

export const getUnifiedStatusLabel = (status: string | null | undefined) => {
  if (!status) {
    return 'Unknown';
  }

  return STATUS_LABELS[status] ?? status;
};

export const getUnifiedStatusClass = (status: string | null | undefined) => {
  if (!status) {
    return 'status-pending';
  }

  return STATUS_BADGE_CLASSES[status] ?? `status-${status.toLowerCase().replace(/_/g, '-')}`;
};
