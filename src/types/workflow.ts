export const REQUEST_STATUSES = {
  PARALLEL_REVIEW: 'PARALLEL_REVIEW',
  VENDOR_COORDINATION: 'VENDOR_COORDINATION',
  HALTED: 'HALTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type RequestStatus =
  (typeof REQUEST_STATUSES)[keyof typeof REQUEST_STATUSES];

export const WORKFLOW_ACTIONS = {
  CREATE: 'CREATE',
  RH_APPROVE: 'RH_APPROVE',
  RH_REJECT: 'RH_REJECT',
  RH_EDIT_APPROVE: 'RH_EDIT_APPROVE',
  PAYMENT_APPROVE: 'PAYMENT_APPROVE',
  PAYMENT_REJECT: 'PAYMENT_REJECT',
  PAYMENT_EDIT_APPROVE: 'PAYMENT_EDIT_APPROVE',
  VENDOR_NOTIFY: 'VENDOR_NOTIFY',
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
  vehicles?: Array<{ vehicleNumber: string; isNewTrip?: boolean }>;
  city?: string | null;
  destination?: string | null;
  clientName?: string | null;
  serviceType?: 'FleetX' | 'WheelsEye' | null;
  serviceCost?: number | null;
  isRefundable?: boolean | null;
  driverName?: string | null;
  driverNumber?: string | null;
  driverDetails?: Array<{
    vehicleNumber: string;
    driverName: string;
    driverNumber: string;
  }>;
  tripFromDate?: string | null;
  tripFromTime?: string | null;
  tripToDate?: string | null;
  tripToTime?: string | null;
  status?: RequestStatus | null;
  rhApproval?: boolean;
  paymentApproval?: boolean;
  vendorName?: string | null;
  rejectionReason?: string | null;
  notificationTimestamp?: unknown;
  createdBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
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
};
