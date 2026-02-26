export const REQUEST_STATUSES = {
  // Single request workflow
  PARALLEL_REVIEW: 'PARALLEL_REVIEW',
  VENDOR_COORDINATION: 'VENDOR_COORDINATION',
  
  // Bulk request workflow
  FO_CREATED: 'FO_CREATED',           // Bulk: initial state
  PAYMENT_PENDING: 'PAYMENT_PENDING', // Bulk: waiting for payment team
  PAYMENT_APPROVED: 'PAYMENT_APPROVED', // Bulk: payment approved, ready for vendor
  SERVICE_INITIATED: 'SERVICE_INITIATED', // Bulk: vendor notified, service started
  
  // Common statuses (both workflows)
  HALTED: 'HALTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type RequestStatus =
  (typeof REQUEST_STATUSES)[keyof typeof REQUEST_STATUSES];

export const WORKFLOW_ACTIONS = {
  CREATE: 'CREATE',
  // Single request actions
  RH_APPROVE: 'RH_APPROVE',
  RH_REJECT: 'RH_REJECT',
  RH_EDIT_APPROVE: 'RH_EDIT_APPROVE',
  PAYMENT_APPROVE: 'PAYMENT_APPROVE',
  PAYMENT_REJECT: 'PAYMENT_REJECT',
  PAYMENT_EDIT_APPROVE: 'PAYMENT_EDIT_APPROVE',
  // Bulk request actions
  RH_BULK_APPROVE: 'RH_BULK_APPROVE',    // RH approves bulk request
  RH_BULK_REJECT: 'RH_BULK_REJECT',      // RH rejects bulk request
  PAYMENT_BULK_APPROVE: 'PAYMENT_BULK_APPROVE', // Payment approves bulk
  PAYMENT_BULK_REJECT: 'PAYMENT_BULK_REJECT',   // Payment rejects bulk
  VENDOR_BULK_NOTIFY: 'VENDOR_BULK_NOTIFY',     // Vendor notifies on bulk
  // Common actions
  VENDOR_NOTIFY: 'VENDOR_NOTIFY',
  FO_REMOVE_VEHICLE: 'FO_REMOVE_VEHICLE',
  CANCEL: 'CANCEL',
} as const;

export type WorkflowAction =
  (typeof WORKFLOW_ACTIONS)[keyof typeof WORKFLOW_ACTIONS];

export type UserRole = 'FO' | 'RH' | 'PAYMENT' | 'VENDOR' | 'ADMIN';

export type UserRef = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: UserRole;
};

export type HistoryEntry = {
  userId: string;
  userName: string | null;
  role: UserRole;
  action: WorkflowAction;
  statusFrom: string | null;
  statusTo: string | null;
  timestamp: unknown;
  notes?: string | null;
};

export type RequestRecord = {
  id?: string;
  
  // Vehicle data - ENHANCED for per-vehicle details in bulk
  vehicles?: Array<{
    vehicleNumber: string;
    isNewTrip?: boolean;
    // Per-vehicle bulk details (filled during FO creation)
    serviceType?: 'FleetX' | 'WheelsEye'; // Per-vehicle service type
    vehicleAvailabilityLocation?: string; // Per-vehicle location
    vehicleAvailableTime?: string; // Per-vehicle time
    ltpocName?: string; // Per-vehicle driver name
    ltpocPhone?: string; // Per-vehicle driver phone
  }>;
  
  city?: string | null;
  clientName?: string | null;
  serviceType?: 'FleetX' | 'WheelsEye' | null; // Legacy: single request only
  vendorType?: 'fleetx' | 'wheelseye' | null; // For vendor notifications
  serviceCost?: number | null;
  isRefundable?: boolean | null;
  vehicleAvailabilityLocation?: string | null; // Legacy: single request only
  vehicleAvailableTime?: string | null; // Legacy: single request only
  ltpocDetails?: Array<{
    vehicleNumber: string;
    ltpocName: string;
    ltpocPhone: string;
  }>;
  
  // Bulk request tracking
  isBulkRequest?: boolean; // true = bulk workflow (FO_CREATED → ...), false = single workflow (PARALLEL_REVIEW)
  vehicleCount?: number; // Total vehicles in request (auto-calculated)
  
  // Status tracking
  status?: RequestStatus | null; // Current workflow status
  
  // Single request workflow (PARALLEL_REVIEW path)
  rhApproval?: boolean;
  rhActionTaken?: boolean; // Prevent multiple RH actions
  paymentApproval?: boolean;
  paymentActionTaken?: boolean; // Prevent multiple payment actions
  
  // PARALLEL bulk workflow (FO_CREATED path) - Both teams review simultaneously
  rhStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'; // Bulk: RH independent review status
  rhApprovedAt?: unknown; // When RH approved (used for both single and bulk)
  paymentStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'; // Bulk: Payment independent review status
  paymentApprovedAt?: unknown; // When Payment approved (used for both single and bulk)
  bothApproved?: boolean; // Both RH and Payment must approve before vendor sees it
  vendorStatus?: 'PENDING' | 'NOTIFIED' | 'APPROVED'; // Bulk: Vendor status
  
  // Common approval fields
  approvedByVendor?: boolean; // For bulk vendor approval
  vendorName?: string | null;
  vendorApprovedBy?: string | null;
  vendorApprovedAt?: unknown;
  vendorActionTaken?: boolean; // Prevent multiple vendor actions
  vendorNotified?: boolean;
  foNotified?: boolean;
  
  // Rejection
  rejectionReason?: string | null;
  
  // Timestamps
  notificationTimestamp?: unknown;
  createdBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  
  // Audit trail
  history?: HistoryEntry[];
};

export type WorkflowUpdateResult = {
  statusFrom: string | null;
  statusTo: string | null;
  updates: Record<string, unknown>;
  historyEntry: HistoryEntry;
};

export type WorkflowOptionalData = {
  rejectionReason?: string;
  vendorName?: string;
  notes?: string;
  updates?: Record<string, unknown>;
  isBulkRequest?: boolean;
  vehicleCount?: number;
};
