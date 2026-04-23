import {
  getPaymentDecision,
  getRequestCreatedAtMs,
  getRequestStatusLabel,
  getServiceLabel,
  isVehicleDropped,
  isPaymentActionable,
  isPaymentBulkStage,
  normalizeServiceType,
  normalizeStatusValue,
  normalizeVehicles,
  resolveLtpocForRequestVehicle,
  RequestWithId,
  toDisplayDate,
  toDisplayDateTime,
  toDateInputValue,
  formatRequestIdDisplay,
} from './workflowView';

export type PaymentRow = {
  requestId: string;
  request: RequestWithId;
  isBulkRequest: boolean;
  vehicleIndex: number | null;
  city: string;
  clientName: string;
  createdDate: string;
  createdDateTime: string;
  createdDateIso: string;
  createdAtMs: number;
  serviceType: string;
  serviceCost: number | null;
  vehicleNumber: string;
  vehicleAvailabilityLocation: string;
  vehicleAvailableTime: string;
  ltpocName: string;
  ltpocPhone: string;
  rowPaymentApproved: boolean;
  rowPaymentRejected: boolean;
  rowPaymentActionTaken: boolean;
  rejectionReason: string;
};

const normalizeRecordList = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => (((value as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>));
  }

  return [];
};

const toBooleanFlag = (value: unknown) => {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return false;
};

const parseNumericCost = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const getServiceCostByType = (serviceType: string, fallbackCost?: unknown) => {
  const fallback = parseNumericCost(fallbackCost);
  if (fallback !== null) {
    return fallback;
  }

  const normalized = normalizeServiceType(serviceType).toLowerCase();
  if (normalized === 'fleetx') {
    return 3000;
  }
  if (normalized === 'wheelseye') {
    return 2000;
  }
  return null;
};

const getPaymentRejectionReason = (request: RequestWithId, vehicle?: Record<string, unknown> | null) => {
  const fromVehicle = String(vehicle?.paymentRejectionReason || '').trim();
  if (fromVehicle) {
    return fromVehicle;
  }

  const fromRequest = String(request?.rejectionReason || '').trim();
  if (fromRequest) {
    return fromRequest;
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    const action = normalizeStatusValue((entry as Record<string, unknown>)?.action);
    if (!action.includes('PAYMENT') || !action.includes('REJECT')) {
      continue;
    }

    const notes = String((entry as Record<string, unknown>)?.notes || '').trim();
    if (!notes) {
      continue;
    }

    const reasonMatch = notes.match(/Reason:\s*(.+)$/i);
    if (reasonMatch?.[1]) {
      return reasonMatch[1].trim();
    }

    return notes;
  }

  return '';
};

export const buildPaymentRowsForRequest = (request: RequestWithId): PaymentRow[] => {
  const requestId = String(request?.id || '').trim();
  if (!requestId) {
    return [];
  }

  const requestIsBulkRequest = toBooleanFlag(request?.isBulkRequest);

  const city = String(request?.city || '').trim();
  const clientName = String(request?.clientName || '').trim();
  const createdAtMs = getRequestCreatedAtMs(request);
  const createdDate = toDisplayDate(createdAtMs || request?.createdAt);
  const createdDateTime = toDisplayDateTime(createdAtMs || request?.createdAt);
  const createdDateIso = toDateInputValue(createdAtMs || request?.createdAt);
  const requestPaymentStatus = normalizeStatusValue(request?.paymentStatus);
  const vehicles = normalizeVehicles(request?.vehicles);
  const ltpocRows = normalizeRecordList(
    (request as unknown as Record<string, unknown>)?.ltpocDetails ||
      (request as unknown as Record<string, unknown>)?.lptocDetails
  );
   const normalizeVehicleNumberKey = (value: unknown) =>
     String(value || '')
       .replace(/[^a-zA-Z0-9]/g, '')
       .toUpperCase();
  const ltpocByVehicle = new Map(
    ltpocRows
       .map((item) => [normalizeVehicleNumberKey(item?.vehicleNumber), item] as const)
      .filter(([vehicleNumber]) => Boolean(vehicleNumber))
  );

  if (requestIsBulkRequest && vehicles.length > 0) {
    const vehicleEntries = vehicles
      .map((vehicle, vehicleIndex) => ({
        vehicle: (vehicle || {}) as Record<string, unknown>,
        vehicleIndex,
      }))
      .filter(({ vehicle }) => !isVehicleDropped(vehicle));

    if (vehicleEntries.length === 0) {
      return [];
    }

    const hasVehiclePaymentSignals = vehicleEntries.some(
      (vehicle) =>
        vehicle.vehicle?.paymentApproved !== undefined ||
        vehicle.vehicle?.paymentRejected !== undefined ||
        vehicle.vehicle?.paymentActionTaken !== undefined ||
        vehicle.vehicle?.paymentApprovedAt !== undefined ||
        vehicle.vehicle?.paymentRejectedAt !== undefined
    );

    return vehicleEntries.map(({ vehicle: rowVehicle, vehicleIndex }) => {
      const vehicleNumber =
        String(rowVehicle?.vehicleNumber || '').trim() ||
        String(ltpocRows[vehicleIndex]?.vehicleNumber || '').trim() ||
        `Vehicle ${vehicleIndex + 1}`;
      const ltpoc = ltpocByVehicle.get(normalizeVehicleNumberKey(vehicleNumber)) || ltpocRows[vehicleIndex] || {};
      const resolvedLtpoc = resolveLtpocForRequestVehicle(request, rowVehicle, vehicleIndex, {
        warnOnMissing: true,
        context: 'buildPaymentRowsForRequest',
      });
      const vehiclePaymentStatus = normalizeStatusValue(rowVehicle?.paymentStatus);

      const legacyApproved = !hasVehiclePaymentSignals && requestPaymentStatus === 'APPROVED';
      const legacyRejected = !hasVehiclePaymentSignals && requestPaymentStatus === 'REJECTED';

      const rowPaymentApproved =
        toBooleanFlag(rowVehicle?.paymentApproved) ||
        Boolean(rowVehicle?.paymentApprovedAt) ||
        vehiclePaymentStatus === 'APPROVED' ||
        legacyApproved;

      const rowPaymentRejected =
        toBooleanFlag(rowVehicle?.paymentRejected) ||
        Boolean(rowVehicle?.paymentRejectedAt) ||
        vehiclePaymentStatus === 'REJECTED' ||
        legacyRejected;

      const rowPaymentActionTaken =
        toBooleanFlag(rowVehicle?.paymentActionTaken) || rowPaymentApproved || rowPaymentRejected;

      const serviceType = normalizeServiceType(rowVehicle?.serviceType || rowVehicle?.vendorType || '') || 'N/A';

      return {
        requestId,
        request,
        isBulkRequest: true,
        vehicleIndex,
        city,
        clientName,
        createdDate,
        createdDateTime,
        createdDateIso,
        createdAtMs,
        serviceType,
        serviceCost: getServiceCostByType(serviceType, rowVehicle?.serviceCost ?? request?.serviceCost),
        vehicleNumber,
        vehicleAvailabilityLocation: String(
          rowVehicle?.vehicleAvailabilityLocation || request?.vehicleAvailabilityLocation || ''
        ).trim(),
        vehicleAvailableTime: String(rowVehicle?.vehicleAvailableTime || request?.vehicleAvailableTime || '').trim(),
        ltpocName: resolvedLtpoc.ltpocName,
        ltpocPhone: resolvedLtpoc.ltpocPhone,
        rowPaymentApproved,
        rowPaymentRejected,
        rowPaymentActionTaken,
        rejectionReason: getPaymentRejectionReason(request, rowVehicle),
      };
    });
  }

  const primaryVehicle = vehicles[0] || {};
  const rowPaymentApproved =
    toBooleanFlag(request?.paymentApproval) ||
    toBooleanFlag((request as unknown as Record<string, unknown>)?.paymentApproved) ||
    requestPaymentStatus === 'APPROVED';
  const rowPaymentRejected =
    toBooleanFlag((request as unknown as Record<string, unknown>)?.paymentRejected) ||
    requestPaymentStatus === 'REJECTED';
  const rowPaymentActionTaken = toBooleanFlag(request?.paymentActionTaken) || rowPaymentApproved || rowPaymentRejected;
  const serviceType = normalizeServiceType(primaryVehicle?.serviceType || primaryVehicle?.vendorType || request?.serviceType) || 'N/A';
  const resolvedPrimaryLtpoc = resolveLtpocForRequestVehicle(request, primaryVehicle, 0, {
    warnOnMissing: true,
    context: 'buildPaymentRowsForRequest',
  });

  return [
    {
      requestId,
      request,
      isBulkRequest: false,
      vehicleIndex: null,
      city,
      clientName,
      createdDate,
      createdDateTime,
      createdDateIso,
      createdAtMs,
      serviceType,
      serviceCost: getServiceCostByType(serviceType, request?.serviceCost),
      vehicleNumber: String(primaryVehicle?.vehicleNumber || '').trim() || getServiceLabel(request),
      vehicleAvailabilityLocation: String(primaryVehicle?.vehicleAvailabilityLocation || request?.vehicleAvailabilityLocation || '').trim(),
      vehicleAvailableTime: String(primaryVehicle?.vehicleAvailableTime || request?.vehicleAvailableTime || '').trim(),
      ltpocName: resolvedPrimaryLtpoc.ltpocName,
      ltpocPhone: resolvedPrimaryLtpoc.ltpocPhone,
      rowPaymentApproved,
      rowPaymentRejected,
      rowPaymentActionTaken,
      rejectionReason: getPaymentRejectionReason(request, null),
    },
  ];
};

export const canTakePaymentRowAction = (row: PaymentRow) => {
  if (!row?.request) {
    return false;
  }

  if (row.rowPaymentApproved || row.rowPaymentRejected || row.rowPaymentActionTaken) {
    return false;
  }

  const requestDecision = getPaymentDecision(row.request);
  if (!row.isBulkRequest) {
    return requestDecision === 'PENDING' && isPaymentActionable(row.request);
  }

  if (!Number.isInteger(row.vehicleIndex)) {
    return false;
  }

  return isPaymentBulkStage(row.request);
};

export const getPaymentRowKey = (row: PaymentRow) => {
  if (row.isBulkRequest) {
    return `B:${row.requestId}:${Number(row.vehicleIndex)}`;
  }
  return `S:${row.requestId}`;
};

export const getPaymentRowStatusLabel = (row: PaymentRow) => {
  if (row.rowPaymentRejected) {
    return 'Rejected';
  }
  if (row.rowPaymentApproved) {
    return 'Approved';
  }
  if (canTakePaymentRowAction(row)) {
    return 'Pending Approval';
  }
  return getRequestStatusLabel(row.request);
};

export const getPaymentRowStatusClass = (row: PaymentRow) => {
  if (row.rowPaymentRejected) {
    return 'bg-red-100 text-red-700';
  }
  if (row.rowPaymentApproved) {
    return 'bg-emerald-100 text-emerald-700';
  }
  return 'bg-amber-100 text-amber-800';
};

export const formatPaymentServiceCharge = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `₹${value.toLocaleString('en-IN')}`;
};

const getCsvServiceCharge = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `INR ${value.toLocaleString('en-IN')}`;
};

export const exportPaymentRowsToCsv = (rows: PaymentRow[], viewLabel = 'dashboard') => {
  if (!Array.isArray(rows) || rows.length === 0 || typeof window === 'undefined') {
    return;
  }

  const escapeCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const headers = [
    'Request ID',
    'Status',
    'Client',
    'City',
    'Service Type',
    'Vehicle Number',
    'Service Charge',
    'Availability Location',
    'Available Time',
    'LTPOC Name',
    'LTPOC Phone',
    'Payment Approved',
    'Payment Rejected',
    'Rejection Reason',
    'Date',
  ];

  const csvRows = rows.map((row) => [
    formatRequestIdDisplay(row.requestId),
    getPaymentRowStatusLabel(row),
    row.clientName,
    row.city,
    row.serviceType,
    row.vehicleNumber,
    getCsvServiceCharge(row.serviceCost),
    row.vehicleAvailabilityLocation,
    row.vehicleAvailableTime,
    row.ltpocName,
    row.ltpocPhone,
    row.rowPaymentApproved ? 'Yes' : 'No',
    row.rowPaymentRejected ? 'Yes' : 'No',
    row.rejectionReason,
    row.createdDateTime,
  ]);

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeViewLabel = String(viewLabel || 'dashboard').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  link.setAttribute('href', url);
  link.setAttribute('download', `payment_${safeViewLabel}_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};