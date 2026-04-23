import { REQUEST_STATUSES, type RequestRecord } from '../types/workflow';
import { getUnifiedStatusLabel } from './statusMapping';

export type RequestWithId = RequestRecord & { id?: string };

const LEGACY_STATUS_TO_UNIFIED: Record<string, string> = {
  [REQUEST_STATUSES.FO_CREATED]: REQUEST_STATUSES.PARALLEL_REVIEW,
  [REQUEST_STATUSES.PAYMENT_PENDING]: REQUEST_STATUSES.PARALLEL_REVIEW,
  [REQUEST_STATUSES.PAYMENT_APPROVED]: REQUEST_STATUSES.VENDOR_COORDINATION,
  [REQUEST_STATUSES.SERVICE_INITIATED]: REQUEST_STATUSES.COMPLETED,
};

const normalizeVehicleNumberKey = (value: unknown) =>
  String(value ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const toBooleanFlag = (value: unknown) => {
  if (value === true || value === false) {
    return value;
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

export const normalizeStatusValue = (value: unknown) => String(value || '').trim().toUpperCase();

type RequestIdSequenceStore = {
  createdAtById: Record<string, number>;
  seqById: Record<string, number>;
  backendSeqById: Record<string, number>;
};

const REQUEST_ID_SEQUENCE_STORAGE_KEY = 'requestIdSequenceMapV3';

const isLegacyNonNumericRequestId = (raw: string) => {
  if (!raw) {
    return false;
  }

  if (/^REQ[-_\s]?\d+$/i.test(raw)) {
    return false;
  }

  return !/^\d+$/.test(raw);
};

const loadRequestIdSequenceStore = (): RequestIdSequenceStore => {
  if (typeof window === 'undefined') {
    return { createdAtById: {}, seqById: {}, backendSeqById: {} };
  }

  try {
    const rawStored = window.localStorage.getItem(REQUEST_ID_SEQUENCE_STORAGE_KEY);
    if (!rawStored) {
      return { createdAtById: {}, seqById: {}, backendSeqById: {} };
    }

    const parsed = JSON.parse(rawStored);
    const createdAtById = parsed?.createdAtById && typeof parsed.createdAtById === 'object'
      ? parsed.createdAtById as Record<string, number>
      : {};
    const seqById = parsed?.seqById && typeof parsed.seqById === 'object'
      ? parsed.seqById as Record<string, number>
      : {};
    const backendSeqById = parsed?.backendSeqById && typeof parsed.backendSeqById === 'object'
      ? parsed.backendSeqById as Record<string, number>
      : {};

    return { createdAtById, seqById, backendSeqById };
  } catch {
    return { createdAtById: {}, seqById: {}, backendSeqById: {} };
  }
};

const saveRequestIdSequenceStore = (store: RequestIdSequenceStore) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(REQUEST_ID_SEQUENCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures and continue rendering.
  }
};

const recomputeRequestIdSequence = (createdAtById: Record<string, number>) => {
  const entries = Object.entries(createdAtById)
    .filter(([key]) => Boolean(key))
    .sort((left, right) => {
      const leftTs = Number(left[1] || 0);
      const rightTs = Number(right[1] || 0);
      if (leftTs === rightTs) {
        return left[0].localeCompare(right[0]);
      }
      return leftTs - rightTs;
    });

  const seqById: Record<string, number> = {};
  entries.forEach(([key], index) => {
    seqById[key] = index + 1;
  });

  return seqById;
};

const toPositiveInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const getBackendRequestSequence = (request: RequestWithId) => {
  const source = request as Record<string, unknown>;

  const fromSequence = toPositiveInteger(source?.requestSequence);
  if (fromSequence > 0) {
    return fromSequence;
  }

  const fromNumericId = toPositiveInteger(source?.numericId);
  if (fromNumericId > 0) {
    return fromNumericId;
  }

  const fromDisplay = String(source?.requestDisplayId || '').trim();
  const displayMatch = fromDisplay.toUpperCase().match(/^REQ[-_\s]?(\d+)$/);
  if (displayMatch?.[1]) {
    return toPositiveInteger(displayMatch[1]);
  }

  return 0;
};

export const formatRequestIdDisplay = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'N/A';
  }

  const reqMatch = raw.toUpperCase().match(/^REQ[-_\s]?(\d+)$/);
  if (reqMatch?.[1]) {
    return `REQ-${reqMatch[1].padStart(6, '0')}`;
  }

  if (/^\d+$/.test(raw)) {
    return `REQ-${raw.padStart(6, '0')}`;
  }

  if (!isLegacyNonNumericRequestId(raw)) {
    return raw;
  }

  const store = loadRequestIdSequenceStore();
  const backendSequence = Number(store.backendSeqById[raw] || 0);
  if (backendSequence > 0) {
    return `REQ-${String(backendSequence).padStart(6, '0')}`;
  }

  if (!store.createdAtById[raw]) {
    store.createdAtById[raw] = Number.MAX_SAFE_INTEGER;
    store.seqById = recomputeRequestIdSequence(store.createdAtById);
    saveRequestIdSequenceStore(store);
  }

  const sequence = Number(store.seqById[raw] || 0) || 1;
  return `REQ-${String(sequence).padStart(6, '0')}`;
};

export const isVehicleDropped = (value: unknown) => {
  const vehicle = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

  if (!vehicle) {
    return false;
  }

  const vehicleStatus = normalizeStatusValue(vehicle.status);
  return (
    toBooleanFlag(vehicle.paymentRejected) ||
    toBooleanFlag(vehicle.isCancelled) ||
    toBooleanFlag(vehicle.cancelled) ||
    toBooleanFlag(vehicle.rhRejected) ||
    vehicleStatus === REQUEST_STATUSES.CANCELLED ||
    vehicleStatus === REQUEST_STATUSES.HALTED ||
    vehicleStatus === 'REJECTED'
  );
};

export const normalizeWorkflowStatus = (status: unknown) => {
  const normalized = normalizeStatusValue(status);
  if (!normalized) {
    return null;
  }
  return LEGACY_STATUS_TO_UNIFIED[normalized] || normalized;
};

export const toDateValue = (value: unknown) => {
  if (!value) {
    return null;
  }

  const dateCandidate = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return Number.isNaN(dateCandidate.getTime()) ? null : dateCandidate;
};

export const toDateInputValue = (value: unknown) => {
  const date = toDateValue(value);
  if (!date) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const toDisplayDateTime = (value: unknown) => {
  const date = toDateValue(value);
  return date ? date.toLocaleString() : 'N/A';
};

export const toDisplayDate = (value: unknown) => {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
};

export const normalizeVehicles = (value: unknown): Array<Record<string, unknown>> => {
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

export const normalizeServiceType = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'fleetx') {
    return 'FleetX';
  }
  if (normalized === 'wheelseye') {
    return 'WheelsEye';
  }
  return String(value || '').trim();
};

export const normalizeVendorName = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fleetx') {
    return 'FleetX';
  }
  if (normalized === 'wheelseye') {
    return 'WheelsEye';
  }
  return null;
};

const csvLtpocMissingWarnings = new Set<string>();

const getStringValue = (value: unknown) => String(value ?? '').trim();

const getRequestLtpocRows = (request: RequestWithId) =>
  normalizeVehicles(
    (request as unknown as Record<string, unknown>)?.ltpocDetails ||
      (request as unknown as Record<string, unknown>)?.lptocDetails
  );

const getRequestLevelLtpoc = (request: RequestWithId) => ({
  ltpocName: getStringValue(
    (request as unknown as Record<string, unknown>)?.ltpocName ||
      (request as unknown as Record<string, unknown>)?.lptocName
  ),
  ltpocPhone: getStringValue(
    (request as unknown as Record<string, unknown>)?.ltpocPhone ||
      (request as unknown as Record<string, unknown>)?.lptocPhone
  ),
});

const requestHasAnyLtpocData = (request: RequestWithId) => {
  const requestLevel = getRequestLevelLtpoc(request);
  if (requestLevel.ltpocName || requestLevel.ltpocPhone) {
    return true;
  }

  const rows = getRequestLtpocRows(request);
  if (rows.some((row) => getStringValue(row?.ltpocName || row?.lptocName || row?.ltpocPhone || row?.lptocPhone))) {
    return true;
  }

  const vehicles = normalizeVehicles(request?.vehicles);
  return vehicles.some((vehicle) => getStringValue(vehicle?.ltpocName || vehicle?.lptocName || vehicle?.ltpocPhone || vehicle?.lptocPhone));
};

export const resolveLtpocForRequestVehicle = (
  request: RequestWithId,
  vehicle?: Record<string, unknown> | null,
  vehicleIndex?: number,
  options?: { warnOnMissing?: boolean; context?: string }
) => {
  const requestLevel = getRequestLevelLtpoc(request);
  const rows = getRequestLtpocRows(request);

  const vehicleNumber = getStringValue(vehicle?.vehicleNumber);
  const vehicleKey = normalizeVehicleNumberKey(vehicleNumber);
  const rowByVehicle = rows.find(
    (row) => normalizeVehicleNumberKey((row as Record<string, unknown>)?.vehicleNumber || '') === vehicleKey
  );
  const rowByIndex = Number.isInteger(vehicleIndex) && vehicleIndex! >= 0 && vehicleIndex! < rows.length ? rows[vehicleIndex!] : null;
  const fallbackRow = rows.find((row) => getStringValue(row?.ltpocName || row?.lptocName || row?.ltpocPhone || row?.lptocPhone)) || null;

  const resolvedName = getStringValue(
    vehicle?.ltpocName ||
      vehicle?.lptocName ||
      rowByVehicle?.ltpocName ||
      rowByVehicle?.lptocName ||
      rowByIndex?.ltpocName ||
      rowByIndex?.lptocName ||
      fallbackRow?.ltpocName ||
      fallbackRow?.lptocName ||
      requestLevel.ltpocName
  );

  const resolvedPhone = getStringValue(
    vehicle?.ltpocPhone ||
      vehicle?.lptocPhone ||
      rowByVehicle?.ltpocPhone ||
      rowByVehicle?.lptocPhone ||
      rowByIndex?.ltpocPhone ||
      rowByIndex?.lptocPhone ||
      fallbackRow?.ltpocPhone ||
      fallbackRow?.lptocPhone ||
      requestLevel.ltpocPhone
  );

  if (options?.warnOnMissing && !resolvedName && !resolvedPhone && requestHasAnyLtpocData(request)) {
    const requestId = String(request?.id || 'unknown');
    const warningKey = `${requestId}:${vehicleNumber || String(vehicleIndex ?? 'n/a')}:${options?.context || 'CSV'}`;
    if (!csvLtpocMissingWarnings.has(warningKey)) {
      csvLtpocMissingWarnings.add(warningKey);
      console.warn(
        `[LPTOC CSV MISSING] context=${options?.context || 'CSV'} requestId=${requestId} vehicle=${vehicleNumber || 'N/A'} index=${String(vehicleIndex ?? 'N/A')}`
      );
    }
  }

  return {
    ltpocName: resolvedName,
    ltpocPhone: resolvedPhone,
  };
};

const resolveVehicleLtpoc = (request: RequestWithId, vehicleNumber: unknown) => {
  const ltpocDetails = getRequestLtpocRows(request);
  if (ltpocDetails.length === 0) {
    const requestLevel = getRequestLevelLtpoc(request);
    if (!requestLevel.ltpocName && !requestLevel.ltpocPhone) {
      return null;
    }
    return requestLevel;
  }

  const target = normalizeVehicleNumberKey(vehicleNumber);
  const matched =
    ltpocDetails.find(
      (ltpoc) => normalizeVehicleNumberKey((ltpoc as Record<string, unknown>)?.vehicleNumber || '') === target
    ) || null;

  if (matched) {
    return matched;
  }

  const vehicles = normalizeVehicles(request?.vehicles);
  const vehicleIndex = vehicles.findIndex(
    (vehicle) => normalizeVehicleNumberKey((vehicle as Record<string, unknown>)?.vehicleNumber || '') === target
  );

  if (vehicleIndex >= 0 && vehicleIndex < ltpocDetails.length) {
    return ltpocDetails[vehicleIndex] || null;
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

export const getRequestCreatedAtMs = (request: RequestWithId) => {
  const created = toDateValue((request as Record<string, unknown>)?.createdAt)?.getTime();
  if (created && created > 0) {
    return created;
  }

  const updated = toDateValue((request as Record<string, unknown>)?.updatedAt)?.getTime();
  if (updated && updated > 0) {
    return updated;
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  if (history.length > 0) {
    const lastTimestamp = (history[history.length - 1] as Record<string, unknown>)?.timestamp;
    const fromHistory = toDateValue(lastTimestamp)?.getTime() ?? 0;
    if (fromHistory > 0) {
      return fromHistory;
    }
  }

  return 0;
};

const seedRequestIdSequenceFromRequests = (requests: RequestWithId[]) => {
  if (typeof window === 'undefined' || !Array.isArray(requests) || requests.length === 0) {
    return;
  }

  const store = loadRequestIdSequenceStore();
  let changed = false;

  requests.forEach((request) => {
    const rawId = String(request?.id || '').trim();
    if (!isLegacyNonNumericRequestId(rawId)) {
      return;
    }

    const backendSequence = getBackendRequestSequence(request);
    if (backendSequence > 0 && Number(store.backendSeqById[rawId] || 0) !== backendSequence) {
      store.backendSeqById[rawId] = backendSequence;
      changed = true;
    }

    const createdAtMs = getRequestCreatedAtMs(request) || Number.MAX_SAFE_INTEGER;
    const existing = Number(store.createdAtById[rawId] || 0);

    if (!existing || createdAtMs < existing) {
      store.createdAtById[rawId] = createdAtMs;
      changed = true;
    }
  });

  if (!changed) {
    return;
  }

  store.seqById = recomputeRequestIdSequence(store.createdAtById);
  saveRequestIdSequenceStore(store);
};

export const sortRequestsNewestFirst = <T extends RequestWithId>(requests: T[]) => {
  seedRequestIdSequenceFromRequests(requests);
  return [...requests].sort((left, right) => getRequestCreatedAtMs(right) - getRequestCreatedAtMs(left));
};

export const getRhDecision = (request: RequestWithId) => {
  const explicit = normalizeStatusValue(request?.rhStatus);
  if (explicit === 'APPROVED' || explicit === 'REJECTED') {
    return explicit;
  }

  if (request?.rhApproval === true) {
    return 'APPROVED';
  }

  if (request?.rhActionTaken === true && normalizeStatusValue(request?.status) === REQUEST_STATUSES.HALTED) {
    return 'REJECTED';
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const action = normalizeStatusValue((history[index] as Record<string, unknown>)?.action);
    if (['RH_APPROVE', 'RH_EDIT_APPROVE', 'RH_BULK_APPROVE'].includes(action)) {
      return 'APPROVED';
    }
    if (['RH_REJECT', 'RH_BULK_REJECT'].includes(action)) {
      return 'REJECTED';
    }
  }

  return 'PENDING';
};

export const getPaymentDecision = (request: RequestWithId) => {
  const explicit = normalizeStatusValue(request?.paymentStatus);
  if (explicit === 'APPROVED' || explicit === 'REJECTED') {
    return explicit;
  }

  if (request?.paymentRejected === true) {
    return 'REJECTED';
  }

  if (request?.paymentApproval === true || request?.paymentApproved === true) {
    return 'APPROVED';
  }

  if (request?.paymentActionTaken === true && request?.paymentApproval !== true) {
    return 'REJECTED';
  }

  return 'PENDING';
};

export const getDerivedStatus = (request: RequestWithId) => {
  const explicit = normalizeWorkflowStatus(request?.status);
  if (explicit) {
    return explicit;
  }

  const rhDecision = getRhDecision(request);
  const paymentDecision = getPaymentDecision(request);

  if (rhDecision === 'REJECTED' || paymentDecision === 'REJECTED') {
    return REQUEST_STATUSES.HALTED;
  }

  if (request?.foNotified === true) {
    return REQUEST_STATUSES.COMPLETED;
  }

  if (
    request?.vendorNotified === true ||
    request?.approvedByVendor === true ||
    normalizeStatusValue(request?.vendorStatus) === 'NOTIFIED'
  ) {
    return REQUEST_STATUSES.VENDOR_COORDINATION;
  }

  if (paymentDecision === 'APPROVED') {
    return REQUEST_STATUSES.VENDOR_COORDINATION;
  }

  return REQUEST_STATUSES.PARALLEL_REVIEW;
};

export const isClosedRequest = (request: RequestWithId) => {
  const status = getDerivedStatus(request);
  return status === REQUEST_STATUSES.HALTED || status === REQUEST_STATUSES.CANCELLED;
};

const getActiveVehicles = (request: RequestWithId) =>
  normalizeVehicles(request?.vehicles).filter((vehicle) => !isVehicleDropped(vehicle));

export const isRhActionable = (request: RequestWithId) => {
  if (isClosedRequest(request)) {
    return false;
  }

  if (request?.isBulkRequest) {
    if (getActiveVehicles(request).length === 0) {
      return false;
    }
    return getRhDecision(request) === 'PENDING';
  }

  const status = getDerivedStatus(request);
  const actionableStatus =
    status === REQUEST_STATUSES.PARALLEL_REVIEW ||
    status === REQUEST_STATUSES.VENDOR_COORDINATION ||
    status === REQUEST_STATUSES.COMPLETED;

  return actionableStatus && getRhDecision(request) === 'PENDING';
};

export const isPaymentBulkStage = (request: RequestWithId) => {
  const normalized = normalizeStatusValue(request?.status);
  if (
    normalized === REQUEST_STATUSES.PARALLEL_REVIEW ||
    normalized === REQUEST_STATUSES.FO_CREATED ||
    normalized === REQUEST_STATUSES.PAYMENT_PENDING
  ) {
    return true;
  }

  return getDerivedStatus(request) === REQUEST_STATUSES.PARALLEL_REVIEW;
};

export const isPaymentActionable = (request: RequestWithId) => {
  if (isClosedRequest(request)) {
    return false;
  }

  if (request?.isBulkRequest) {
    if (getActiveVehicles(request).length === 0) {
      return false;
    }
    return isPaymentBulkStage(request) && getPaymentDecision(request) === 'PENDING';
  }

  const status = getDerivedStatus(request);
  const paymentStage = status === REQUEST_STATUSES.PARALLEL_REVIEW;

  return paymentStage && getPaymentDecision(request) === 'PENDING';
};

export const hasVendorEligibleVehicles = (request: RequestWithId) => {
  if (!request?.isBulkRequest) {
    return true;
  }

  const vehicles = normalizeVehicles(request?.vehicles);
  if (vehicles.length === 0) {
    return true;
  }

  const activeVehicles = vehicles.filter((vehicle) => !isVehicleDropped(vehicle));
  if (activeVehicles.length === 0) {
    return false;
  }

  const hasPaymentSignals = activeVehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined
  );

  if (!hasPaymentSignals) {
    return true;
  }

  return activeVehicles.some((vehicle) => vehicle?.paymentApproved === true && vehicle?.paymentRejected !== true);
};

export const normalizeRole = (value: unknown) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'FIELD_OPERATOR') {
    return 'FO';
  }
  if (normalized === 'REGIONAL_HEAD') {
    return 'RH';
  }
  return normalized;
};

export const getVehicleCount = (request: RequestWithId) => {
  const vehicles = normalizeVehicles(request?.vehicles);

  if (request?.isBulkRequest && vehicles.length > 0) {
    const activeVehicles = getActiveVehicles(request);
    return activeVehicles.length;
  }

  const declaredCount = Number(request?.vehicleCount);
  if (Number.isFinite(declaredCount) && declaredCount > 0) {
    return declaredCount;
  }

  if (vehicles.length > 0) {
    return vehicles.length;
  }

  return 0;
};

export const getVehicleLabel = (request: RequestWithId) => {
  const vehicles = request?.isBulkRequest
    ? getActiveVehicles(request)
    : normalizeVehicles(request?.vehicles);
  const numbers = vehicles
    .map((vehicle) => String(vehicle?.vehicleNumber || '').trim())
    .filter(Boolean);

  if (numbers.length === 0) {
    return 'N/A';
  }

  if (numbers.length === 1) {
    return numbers[0];
  }

  return `${numbers[0]} +${numbers.length - 1}`;
};

export const getVehicleLabelWithRequestType = (request: RequestWithId) => {
  const baseLabel = getVehicleLabel(request);
  const requestType = request?.isBulkRequest ? 'Bulk' : 'Single';
  return `${baseLabel} (${requestType})`;
};

export const getServiceLabel = (request: RequestWithId) => {
  const vehicles = request?.isBulkRequest
    ? getActiveVehicles(request)
    : normalizeVehicles(request?.vehicles);

  if (!request?.isBulkRequest) {
    return normalizeServiceType(request?.serviceType || vehicles[0]?.serviceType || '') || 'N/A';
  }

  if (vehicles.length === 0) {
    return normalizeServiceType(request?.serviceType || '') || 'N/A';
  }

  const uniqueServiceTypes = [
    ...new Set(
      vehicles
        .map((vehicle) => normalizeVendorName(vehicle?.serviceType) || normalizeServiceType(vehicle?.serviceType || ''))
        .filter(Boolean)
    ),
  ];

  if (uniqueServiceTypes.length === 1) {
    return uniqueServiceTypes[0];
  }

  if (uniqueServiceTypes.length > 1) {
    return 'Mixed';
  }

  return normalizeServiceType(request?.serviceType || '') || 'N/A';
};

export const resolveVendorNameForRequest = (request: RequestWithId) => {
  const direct = normalizeVendorName(request?.serviceType || request?.vendorType || request?.vendorName);
  if (direct) {
    return direct;
  }

  const vehicles = normalizeVehicles(request?.vehicles);
  for (const vehicle of vehicles) {
    const mapped = normalizeVendorName(vehicle?.serviceType || vehicle?.vendorName);
    if (mapped) {
      return mapped;
    }
  }

  return null;
};

export type VendorPendingRow = {
  requestId: string;
  city: string;
  clientName: string;
  date: string;
  serviceType: string;
  vehicleNumber: string;
  vehicleAvailabilityLocation: string;
  vehicleAvailableTime: string;
  ltpocName: string;
  ltpocPhone: string;
  ltpocEmail: string;
  lpoAdditional: string;
  vendorName: string;
};

export const buildVendorPendingRowsForRequest = (request: RequestWithId): VendorPendingRow[] => {
  const vehicles = normalizeVehicles(request?.vehicles);
  const shouldUseVehiclePaymentSignals = Boolean(request?.isBulkRequest);
  const hasPaymentSignals = shouldUseVehiclePaymentSignals && vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined ||
      vehicle?.paymentApprovedAt !== undefined ||
      vehicle?.paymentRejectedAt !== undefined ||
      vehicle?.paymentStatus !== undefined
  );

  const resolveVendorForServiceType = (serviceType: unknown, fallbackVendor: unknown) => {
    const canonicalServiceType = normalizeServiceType(serviceType || '');
    const mapped = normalizeVendorName(canonicalServiceType || fallbackVendor || '');
    return mapped || null;
  };

  if (vehicles.length > 0) {
    return vehicles
      .filter((vehicle) => {
        if (isVehicleDropped(vehicle)) {
          return false;
        }
        if (shouldUseVehiclePaymentSignals && toBooleanFlag(vehicle?.paymentRejected)) {
          return false;
        }
        if (hasPaymentSignals && !toBooleanFlag(vehicle?.paymentApproved)) {
          return false;
        }
        if (toBooleanFlag(vehicle?.vendorNotified)) {
          return false;
        }

        const serviceType = request?.isBulkRequest
          ? vehicle?.serviceType || vehicle?.vendorType || ''
          : vehicle?.serviceType || request?.serviceType || request?.vendorName || '';
        return Boolean(resolveVendorForServiceType(serviceType, request?.vendorName));
      })
      .map((vehicle) => {
        const ltpocRaw = (resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || {}) as Record<string, unknown>;
        const ltpoc = resolveLtpocForRequestVehicle(request, vehicle as Record<string, unknown>, undefined, {
          warnOnMissing: true,
          context: 'buildVendorPendingRowsForRequest',
        });
        const serviceType = request?.isBulkRequest
          ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '')
          : normalizeServiceType(vehicle?.serviceType || request?.serviceType || request?.vendorName || '');
        const vendorName = resolveVendorForServiceType(serviceType, request?.vendorName) || '';

        return {
          requestId: String(request.id || ''),
          city: String(request.city || ''),
          clientName: String(request.clientName || ''),
          date: toDisplayDate(request.createdAt),
          serviceType: serviceType || vendorName,
          vehicleNumber: String(vehicle?.vehicleNumber || ''),
          vehicleAvailabilityLocation: String(vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || ''),
          vehicleAvailableTime: String(vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || ''),
          ltpocName: ltpoc.ltpocName,
          ltpocPhone: ltpoc.ltpocPhone,
          ltpocEmail: String(ltpocRaw?.ltpocEmail || vehicle?.ltpocEmail || ''),
          lpoAdditional: String(ltpocRaw?.lpoAdditional || vehicle?.lpoAdditional || ''),
          vendorName,
        };
      })
      .filter((row) => Boolean(row.vendorName));
  }

  const fallbackServiceType = normalizeServiceType(request?.serviceType || request?.vendorName || '');
  const fallbackVendorName = resolveVendorForServiceType(fallbackServiceType, request?.vendorName);
  if (!fallbackVendorName) {
    return [];
  }

  return [
    {
      requestId: String(request.id || ''),
      city: String(request.city || ''),
      clientName: String(request.clientName || ''),
      date: toDisplayDate(request.createdAt),
      serviceType: fallbackServiceType || fallbackVendorName,
      vehicleNumber: '',
      vehicleAvailabilityLocation: String(request.vehicleAvailabilityLocation || ''),
      vehicleAvailableTime: String(request.vehicleAvailableTime || ''),
      ltpocName: '',
      ltpocPhone: '',
      ltpocEmail: '',
      lpoAdditional: '',
      vendorName: fallbackVendorName,
    },
  ];
};

export type FoNotificationRow = {
  requestId: string;
  status: string;
  city: string;
  clientName: string;
  serviceType: string;
  serviceCost: number | '';
  vehicleNumber: string;
  vehicleAvailabilityLocation: string;
  vehicleAvailableTime: string;
  ltpocName: string;
  ltpocPhone: string;
  lpoAdditional: string;
  createdAt: string;
};

export const buildFoRowsForRequest = (request: RequestWithId): FoNotificationRow[] => {
  const vehicles = normalizeVehicles(request?.vehicles);
  const shouldUseVehiclePaymentSignals = Boolean(request?.isBulkRequest);
  const hasPaymentSignals = shouldUseVehiclePaymentSignals && vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined
  );

  if (vehicles.length > 0) {
    return vehicles
      .filter((vehicle) => {
        if (isVehicleDropped(vehicle)) {
          return false;
        }
        if (shouldUseVehiclePaymentSignals && vehicle?.paymentRejected === true) {
          return false;
        }
        if (hasPaymentSignals && vehicle?.paymentApproved !== true) {
          return false;
        }
        return true;
      })
      .map((vehicle) => {
        const ltpocRaw = (resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || {}) as Record<string, unknown>;
        const ltpoc = resolveLtpocForRequestVehicle(request, vehicle as Record<string, unknown>, undefined, {
          warnOnMissing: true,
          context: 'buildFoRowsForRequest',
        });
        const serviceType = request?.isBulkRequest
          ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '')
          : normalizeServiceType(vehicle?.serviceType || request?.serviceType || '');

        return {
          requestId: String(request.id || ''),
          status: getDerivedStatus(request),
          city: String(request.city || ''),
          clientName: String(request.clientName || ''),
          serviceType: serviceType || '',
          serviceCost: Number(request.serviceCost ?? 0) || '',
          vehicleNumber: String(vehicle?.vehicleNumber || ''),
          vehicleAvailabilityLocation: String(vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || ''),
          vehicleAvailableTime: String(vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || ''),
          ltpocName: ltpoc.ltpocName,
          ltpocPhone: ltpoc.ltpocPhone,
          lpoAdditional: String(ltpocRaw?.lpoAdditional || vehicle?.lpoAdditional || ''),
          createdAt: toDisplayDateTime(request.createdAt),
        };
      });
  }

  return [
    {
      requestId: String(request.id || ''),
      status: getDerivedStatus(request),
      city: String(request.city || ''),
      clientName: String(request.clientName || ''),
      serviceType: request?.isBulkRequest ? '' : normalizeServiceType(request?.serviceType || ''),
      serviceCost: Number(request.serviceCost ?? 0) || '',
      vehicleNumber: '',
      vehicleAvailabilityLocation: String(request.vehicleAvailabilityLocation || ''),
      vehicleAvailableTime: String(request.vehicleAvailableTime || ''),
      ltpocName: '',
      ltpocPhone: '',
      lpoAdditional: '',
      createdAt: toDisplayDateTime(request.createdAt),
    },
  ];
};

export const canVendorNotifyRequest = (request: RequestWithId) => {
  if (!request || isClosedRequest(request)) {
    return false;
  }

  if (request?.vendorNotified === true || request?.foNotified === true) {
    return false;
  }

  if (buildVendorPendingRowsForRequest(request).length === 0) {
    return false;
  }

  const status = getDerivedStatus(request);
  return status === REQUEST_STATUSES.VENDOR_COORDINATION || status === REQUEST_STATUSES.COMPLETED;
};

export const canFoNotifyRequest = (request: RequestWithId) => {
  if (!request || isClosedRequest(request)) {
    return false;
  }

  if (request?.foNotified === true) {
    return false;
  }

  if (request?.vendorNotified !== true) {
    return false;
  }

  if (!hasVendorEligibleVehicles(request)) {
    return false;
  }

  const status = getDerivedStatus(request);
  return status === REQUEST_STATUSES.VENDOR_COORDINATION || status === REQUEST_STATUSES.COMPLETED;
};

export const canFoCancelRequest = (request: RequestWithId) => {
  if (!request?.id) {
    return false;
  }

  const status = getDerivedStatus(request);
  if (
    status === REQUEST_STATUSES.CANCELLED ||
    status === REQUEST_STATUSES.COMPLETED ||
    status === REQUEST_STATUSES.HALTED
  ) {
    return false;
  }

  if (request?.foNotified === true) {
    return false;
  }

  return true;
};

export const getRequestStatusLabel = (request: RequestWithId) => {
  const status = getDerivedStatus(request);
  const rhDecision = getRhDecision(request);
  const paymentDecision = getPaymentDecision(request);

  if (status === REQUEST_STATUSES.CANCELLED) {
    return 'Cancelled';
  }

  if (status === REQUEST_STATUSES.HALTED || rhDecision === 'REJECTED' || paymentDecision === 'REJECTED') {
    return 'Rejected';
  }

  if (request.foNotified === true) {
    return 'FO Notified';
  }

  if (canFoNotifyRequest(request)) {
    return 'FO Pending';
  }

  if (canVendorNotifyRequest(request)) {
    return 'Vendor Pending';
  }

  if (request.vendorNotified === true) {
    return 'Pending FO Notification';
  }

  if (status === REQUEST_STATUSES.VENDOR_COORDINATION || paymentDecision === 'APPROVED') {
    return 'Pending Vendor Action';
  }

  if (rhDecision === 'APPROVED' && paymentDecision === 'PENDING') {
    return 'Pending Payment Approval';
  }

  return getUnifiedStatusLabel(status);
};

const STATUS_STYLES: Record<string, string> = {
  'pending rh & payment approval': 'bg-orange-50 text-orange-700 border border-orange-100',
  'pending payment approval': 'bg-orange-50 text-orange-700 border border-orange-100',
  'pending vendor action': 'bg-amber-50 text-amber-700 border border-amber-100',
  'vendor pending': 'bg-amber-50 text-amber-700 border border-amber-100',
  'fo pending': 'bg-blue-50 text-blue-700 border border-blue-100',
  'pending fo notification': 'bg-blue-50 text-blue-700 border border-blue-100',
  completed: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  'fo notified': 'bg-emerald-50 text-emerald-600 border border-emerald-100',
  cancelled: 'bg-red-50 text-red-600 border border-red-100',
  rejected: 'bg-rose-50 text-rose-600 border border-rose-100',
};

export const getStatusPillClass = (label: string) =>
  STATUS_STYLES[label.toLowerCase()] ?? 'bg-slate-100 text-slate-600 border border-slate-200';

export const requestMatchesSearch = (request: RequestWithId, searchTerm: string) => {
  const normalizedSearch = String(searchTerm || '').trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  const vehicleNumbers = normalizeVehicles(request?.vehicles)
    .map((vehicle) => String(vehicle?.vehicleNumber || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  return [
    String(request?.id || '').toLowerCase(),
    String(request?.clientName || '').toLowerCase(),
    String(request?.city || '').toLowerCase(),
    String(getServiceLabel(request) || '').toLowerCase(),
    vehicleNumbers,
  ].some((value) => value.includes(normalizedSearch));
};

export const groupVendorRowsByVendor = (rows: VendorPendingRow[]) => {
  const grouped = new Map<string, Array<Omit<VendorPendingRow, 'vendorName'>>>();

  rows.forEach((row) => {
    const vendorName = String(row.vendorName || '').trim();
    if (!vendorName) {
      return;
    }

    const existing = grouped.get(vendorName) || [];
    const { vendorName: _vendorName, ...payloadRow } = row;
    existing.push(payloadRow);
    grouped.set(vendorName, existing);
  });

  return grouped;
};

export const getPaymentRejectionLabel = (request: RequestWithId) => getPaymentRejectionReason(request, null);
