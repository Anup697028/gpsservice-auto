import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { functionsService } from '../services/functionsService';
import { showToast } from '../components/Toast';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import * as XLSX from 'xlsx';
import '../styles/dashboard.css';
import { REQUEST_STATUSES } from '../types/workflow';
import type { RequestRecord, UserRef } from '../types/workflow';
import { getUnifiedStatusClass, getUnifiedStatusLabel } from '../utils/statusMapping';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

type VendorExportRow = {
  requestId: string;
  foUserId: string;
  foEmail: string;
  foName: string;
  vendorNotified: boolean;
  foNotified: boolean;
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
  lpoNumber: string;
  lpoDate: string;
  lpoReferenceId: string;
  lpoAdditional: string;
  createdAt: string;
};

type FoContact = {
  email: string;
  name: string;
};

const SERVICE_COST_BY_TYPE: Record<string, number> = {
  FleetX: 3000,
  WheelsEye: 2000,
};

const toDateValue = (value: unknown) => {
  if (!value) {
    return null;
  }

  const dateValue = (value as { toDate?: () => Date }).toDate?.() ?? new Date(value as string);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
};

const toDateString = (value: unknown) => {
  const dateValue = toDateValue(value);
  return dateValue ? dateValue.toISOString().slice(0, 10) : '';
};

const normalizeVehicles = (vehicles: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(vehicles)) {
    return vehicles as Array<Record<string, unknown>>;
  }

  if (vehicles && typeof vehicles === 'object') {
    return Object.keys(vehicles as Record<string, unknown>)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ((vehicles as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>);
  }

  return [];
};

const normalizeExportValue = (value: unknown): string | number => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }

  if (typeof value === 'string') {
    return value;
  }

  const dateValue = toDateValue(value);
  if (dateValue) {
    return dateValue.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeExportValue(item))
      .filter((item) => String(item).trim() !== '')
      .join(' | ');
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const normalized = normalizeExportValue(item);
        return String(normalized).trim() ? `${key}: ${normalized}` : '';
      })
      .filter(Boolean)
      .join(', ');
  }

  return String(value);
};

const normalizeExportText = (value: unknown) => String(normalizeExportValue(value));

const toBoolean = (value: unknown) => value === true;

const getServiceCost = (serviceType?: string | null, fallback?: number | null) => {
  if (serviceType && SERVICE_COST_BY_TYPE[serviceType]) {
    return SERVICE_COST_BY_TYPE[serviceType];
  }

  return fallback ?? '';
};

const normalizeVendorName = (value?: string | null) => {
  if (!value) {
    return null;
  }

  if (value.toLowerCase() === 'fleetx' || value === 'FleetX') {
    return 'FleetX';
  }

  if (value.toLowerCase() === 'wheelseye' || value === 'WheelsEye') {
    return 'WheelsEye';
  }

  return null;
};

const pickLpoValue = (...values: Array<unknown>) => {
  const resolved = values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return resolved ? String(resolved) : '';
};

// Fix #4: strip driver-name bracket text from LPO values.
const sanitizeLpoDisplayValue = (value: string) =>
  value
    .replace(/\s*[\[(][^\])]*[\])]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

// Extract canonical + operational LPO fields from request/vehicle payloads.
const extractLpoFields = (request: RequestWithId, vehicle?: Record<string, unknown>) => {
  const requestAny = request as Record<string, unknown>;
  const vehicleAny = (vehicle ?? {}) as Record<string, unknown>;

  // Try to get LPO data from ltpocDetails array first
  const vehicleLtpoc = Array.isArray(vehicleAny.ltpocDetails) ? vehicleAny.ltpocDetails[0] : null;
  const requestLtpoc = Array.isArray(requestAny.ltpocDetails) ? requestAny.ltpocDetails[0] : null;

  const lpoNumber = pickLpoValue(
    vehicleLtpoc?.lpoNumber,
    vehicleAny.lpoNumber,
    vehicleAny.lpoNo,
    vehicleAny.lpo_number,
    requestLtpoc?.lpoNumber,
    requestAny.lpoNumber,
    requestAny.lpoNo,
    requestAny.lpo_number
  );

  const lpoDate = pickLpoValue(
    vehicleLtpoc?.lpoDate,
    vehicleAny.lpoDate,
    vehicleAny.lpo_date,
    requestLtpoc?.lpoDate,
    requestAny.lpoDate,
    requestAny.lpo_date
  );

  const lpoReferenceId = pickLpoValue(
    vehicleLtpoc?.lpoReferenceId,
    vehicleLtpoc?.lpoRefId,
    vehicleAny.lpoReferenceId,
    vehicleAny.lpoRefId,
    vehicleAny.lpoReference,
    vehicleAny.lpo_reference_id,
    requestLtpoc?.lpoReferenceId,
    requestLtpoc?.lpoRefId,
    requestAny.lpoReferenceId,
    requestAny.lpoRefId,
    requestAny.lpoReference,
    requestAny.lpo_reference_id
  );

  const lpoExtrasFromSource = (source: Record<string, unknown>) =>
    Object.entries(source)
      .filter(([key, value]) =>
        key.toLowerCase().startsWith('lpo') &&
        !['lponumber', 'lpodno', 'lpo_number', 'lpodate', 'lpo_date', 'lporeferenceid', 'lporefid', 'lporeference', 'lpo_reference_id', 'lpoadditional', 'lpo_additional']
          .includes(key.toLowerCase()) &&
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      )
      .map(([key, value]) => `${key}: ${sanitizeLpoDisplayValue(String(value))}`);

  // Collect additional LPO fields from all sources including ltpocDetails
  const additionalEntries = [
    ...lpoExtrasFromSource(requestAny),
    ...lpoExtrasFromSource(vehicleAny),
    ...(vehicleLtpoc?.lpoAdditional ? [sanitizeLpoDisplayValue(String(vehicleLtpoc.lpoAdditional))] : []),
    ...(requestLtpoc?.lpoAdditional ? [sanitizeLpoDisplayValue(String(requestLtpoc.lpoAdditional))] : []),
  ];

  return {
    lpoNumber: sanitizeLpoDisplayValue(lpoNumber),
    lpoDate: sanitizeLpoDisplayValue(lpoDate),
    lpoReferenceId: sanitizeLpoDisplayValue(lpoReferenceId),
    lpoAdditional: sanitizeLpoDisplayValue(additionalEntries.filter(Boolean).join(' | ')),
  };
};

const getPaymentRejectionReason = (vehicle: Record<string, unknown>, request: RequestWithId) => {
  const fromVehicle = String(vehicle?.paymentRejectionReason || '').trim();
  if (fromVehicle) {
    return fromVehicle;
  }

  const fromRequest = String((request as Record<string, unknown>)?.rejectionReason || '').trim();
  if (fromRequest) {
    return fromRequest;
  }

  if (Array.isArray(request.history)) {
    for (let index = request.history.length - 1; index >= 0; index -= 1) {
      const entry = request.history[index] as Record<string, unknown>;
      const action = String(entry?.action || '').toUpperCase();
      if (!action.includes('PAYMENT') || !action.includes('REJECT')) {
        continue;
      }

      const notes = String(entry?.notes || '').trim();
      if (!notes) {
        continue;
      }

      const reasonMatch = notes.match(/Reason:\s*(.+)$/i);
      if (reasonMatch?.[1]) {
        return reasonMatch[1].trim();
      }

      return notes;
    }
  }

  return '';
};

export const VendorDashboard = () => {
  const { user, userRole } = useAuth();
  // Fix #2/#5: maintain full live snapshot and derive pending section rows from it.
  const [allRequests, setAllRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [foNotifiedRequestIds, setFoNotifiedRequestIds] = useState<Set<string>>(new Set());
  const [foDirectory, setFoDirectory] = useState<Map<string, FoContact>>(new Map());

  const userRef = useMemo<UserRef | null>(() => {
    if (!user || !userRole) {
      return null;
    }

    return {
      id: user.uid,
      email: user.email,
      role: userRole,
    };
  }, [user, userRole]);

  const getVendorEligibleVehicles = (request: RequestWithId) => {
    const vehicles = normalizeVehicles(request.vehicles);
    if (vehicles.length === 0) {
      return [] as Array<Record<string, unknown>>;
    }

    const hasVehiclePaymentSignals = vehicles.some(
      (vehicle) => vehicle.paymentApproved !== undefined || vehicle.paymentRejected !== undefined
    );

    return vehicles.filter((vehicle) => {
      if (toBoolean(vehicle.paymentRejected)) {
        return false;
      }

      if (hasVehiclePaymentSignals) {
        return toBoolean(vehicle.paymentApproved);
      }

      return request.paymentStatus === 'APPROVED' || request.status === REQUEST_STATUSES.PAYMENT_APPROVED;
    });
  };

  const isVendorNotified = (request: RequestWithId) =>
    request.isBulkRequest
      ? (() => {
          const eligibleVehicles = getVendorEligibleVehicles(request);
          if (eligibleVehicles.length === 0) {
            return (
              toBoolean(request.vendorNotified) ||
              Boolean((request as any).vendorBulkMailSentAt) ||
              request.status === REQUEST_STATUSES.SERVICE_INITIATED ||
              request.status === REQUEST_STATUSES.COMPLETED
            );
          }

          return eligibleVehicles.every((vehicle) => toBoolean(vehicle.vendorNotified));
        })()
      : toBoolean(request.vendorNotified) ||
        Boolean((request as any).vendorBulkMailSentAt) ||
        request.status === REQUEST_STATUSES.COMPLETED ||
        request.status === REQUEST_STATUSES.SERVICE_INITIATED;

  const isFoBulkNotified = (request: RequestWithId) =>
    request.isBulkRequest
      ? (() => {
          const eligibleVehicles = getVendorEligibleVehicles(request);
          if (eligibleVehicles.length === 0) {
            return (
              toBoolean(request.foNotified) ||
              foNotifiedRequestIds.has(request.id as string)
            );
          }

          return eligibleVehicles.every((vehicle) => toBoolean(vehicle.foNotified));
        })()
      : toBoolean(request.foNotified) ||
        foNotifiedRequestIds.has(request.id as string);

  const isVendorWorkflowStage = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      return request.status === REQUEST_STATUSES.PAYMENT_APPROVED && getVendorEligibleVehicles(request).length > 0;
    }

    return request.status === REQUEST_STATUSES.VENDOR_COORDINATION;
  };

  const hasResolvableVendorMapping = (request: RequestWithId) => {
    if (normalizeVendorName(request.serviceType || request.vendorName || null)) {
      return true;
    }

    if (!request.isBulkRequest) {
      return false;
    }

    const eligibleVehicles = getVendorEligibleVehicles(request);
    if (eligibleVehicles.length === 0) {
      return false;
    }

    return eligibleVehicles.some((vehicle) =>
      Boolean(normalizeVendorName((vehicle as any)?.serviceType || (vehicle as any)?.vendorName || null))
    );
  };

  const isClosedOrRejected = (request: RequestWithId) => {
    const approvalStatus = String((request as any).approvalStatus || '').toUpperCase();
    return (
      request.status === REQUEST_STATUSES.CANCELLED ||
      request.status === REQUEST_STATUSES.HALTED ||
      approvalStatus === 'REJECTED' ||
      approvalStatus === 'CLOSED'
    );
  };

  const canSelectForVendorNotify = (request: RequestWithId) => {
    const vendorCoordinationStatus = String((request as any).vendorCoordinationStatus || '').trim();
    const normalizedVendorStatus = vendorCoordinationStatus.toLowerCase();
    const isPendingStatus =
      normalizedVendorStatus === '' ||
      normalizedVendorStatus === 'pending' ||
      normalizedVendorStatus === 'pending vendor notification' ||
      normalizedVendorStatus === 'vendor pending' ||
      (normalizedVendorStatus.includes('pending') && !normalizedVendorStatus.includes('fo'));

    if (!isPendingStatus) {
      return false;
    }

    if (!hasResolvableVendorMapping(request)) {
      return false;
    }

    if (request.isBulkRequest) {
      const eligibleVehicles = getVendorEligibleVehicles(request);

      if (eligibleVehicles.length === 0) {
        return false;
      }

      const pendingEligibleCount = eligibleVehicles.filter((vehicle) => !toBoolean(vehicle.vendorNotified)).length;
      if (pendingEligibleCount === 0) {
        return false;
      }
    } else if (isVendorNotified(request)) {
      return false;
    }

    return isVendorWorkflowStage(request);
  };

  const canSelectForFoNotify = (request: RequestWithId) => {
    if (isFoBulkNotified(request)) {
      return false;
    }

    const vendorCoordinationStatus = String((request as any).vendorCoordinationStatus || '').trim();
    const normalizedVendorStatus = vendorCoordinationStatus.toLowerCase();
    const isFoPendingStatus =
      normalizedVendorStatus === 'pending fo notification' ||
      normalizedVendorStatus === 'fo pending' ||
      (vendorCoordinationStatus === '' && isVendorNotified(request));

    if (request.isBulkRequest) {
      if (!isVendorNotified(request)) {
        return false;
      }

      if (isFoBulkNotified(request)) {
        return false;
      }
    }

    // Fix #1: Notify FO is available only for pending-FO rows.
    return (
      !isClosedOrRejected(request) &&
      isVendorNotified(request) &&
      request.foNotified !== true &&
      isFoPendingStatus
    );
  };

  const canSelectRequest = (request: RequestWithId) => {
    if (isVendorWorkflowCompleted(request)) {
      return false;
    }

    return canSelectForVendorNotify(request) || canSelectForFoNotify(request);
  };

  const isPendingVendorCoordination = (request: RequestWithId) => {
    if (request.foNotified === true || isFoBulkNotified(request)) {
      return false;
    }

    const vendorCoordinationStatus = String((request as any).vendorCoordinationStatus || '').trim();
    const normalizedVendorStatus = vendorCoordinationStatus.toLowerCase();

    if (
      normalizedVendorStatus === 'pending' ||
      normalizedVendorStatus === 'pending fo notification' ||
      normalizedVendorStatus === 'fo pending' ||
      normalizedVendorStatus === 'pending vendor notification'
    ) {
      return true;
    }

    if (vendorCoordinationStatus) {
      return false;
    }

    if (isClosedOrRejected(request)) {
      return false;
    }

    if (isVendorNotified(request) && request.foNotified !== true) {
      return true;
    }

    return isVendorWorkflowStage(request) && (!isVendorNotified(request) || request.foNotified !== true);
  };

  const isVendorWorkflowCompleted = (request: RequestWithId) => {
    const vendorCoordinationStatus = String((request as any).vendorCoordinationStatus || '').trim();

    if (vendorCoordinationStatus === 'FO Notified') {
      return true;
    }

    if (request.foNotified === true || isFoBulkNotified(request)) {
      return true;
    }

    if (isPendingVendorCoordination(request)) {
      return false;
    }

    if (isVendorNotified(request) && !request.foNotified) {
      return false;
    }

    return (
      request.status === REQUEST_STATUSES.COMPLETED ||
      request.status === REQUEST_STATUSES.SERVICE_INITIATED
    );
  };

  const getVendorStageLabel = (request: RequestWithId) => {
    if (request.foNotified || isFoBulkNotified(request)) {
      return 'FO Notified';
    }

    const vendorCoordinationStatus = String((request as any).vendorCoordinationStatus || '').trim();
    if (vendorCoordinationStatus) {
      return vendorCoordinationStatus;
    }

    if (isVendorNotified(request)) {
      return 'Pending FO Notification';
    }

    if (request.paymentApproval === true || request.paymentStatus === 'APPROVED') {
      return 'Pending Vendor Notification';
    }

    return getUnifiedStatusLabel(request.status);
  };

  const getVendorStageClass = (request: RequestWithId) => {
    const stageLabel = getVendorStageLabel(request).toLowerCase();

    if (stageLabel.includes('fo notified') || stageLabel.includes('completed')) {
      return 'status-completed';
    }

    if (stageLabel.includes('cancel')) {
      return 'status-cancelled';
    }

    if (stageLabel.includes('reject') || stageLabel.includes('halt')) {
      return 'status-rejected';
    }

    if (stageLabel.includes('vendor') || stageLabel.includes('notification') || stageLabel.includes('pending')) {
      return 'status-pending';
    }

    return getUnifiedStatusClass(request.status);
  };

  useEffect(() => {
    if (!userRef) {
      return;
    }

    setLoading(true);

    const unsubscribe = requestService.subscribeToAllRequests((data) => {
      // Fix #5: always derive UI state from the latest Firestore snapshot.
      setAllRequests(data as RequestWithId[]);
      setLoading(false);
    });

    return unsubscribe;
  }, [userRef]);

  const pendingRequests = useMemo(
    () => allRequests.filter((request) => isPendingVendorCoordination(request)),
    [allRequests, foNotifiedRequestIds]
  );

  const applyDashboardFilters = (sourceRequests: RequestWithId[]) => {
    const term = searchTerm.toLowerCase();

    return sourceRequests
      .filter((request) => {
        const matchesSearch =
          request.id?.toLowerCase().includes(term) ||
          request.clientName?.toLowerCase().includes(term) ||
          request.city?.toLowerCase().includes(term);

        const requestDate = toDateValue(request.vendorApprovedAt ?? request.createdAt);
        const fromOk = fromDate ? (requestDate ? requestDate >= new Date(fromDate) : false) : true;
        const toDateObj = toDate ? new Date(toDate) : null;
        if (toDateObj) {
          toDateObj.setHours(23, 59, 59, 999);
        }
        const toOk = toDateObj ? (requestDate ? requestDate <= toDateObj : false) : true;

        return Boolean(matchesSearch) && fromOk && toOk;
      })
      .sort((a, b) => {
        const aTime = toDateValue(a.updatedAt ?? a.vendorApprovedAt ?? a.createdAt)?.getTime() ?? 0;
        const bTime = toDateValue(b.updatedAt ?? b.vendorApprovedAt ?? b.createdAt)?.getTime() ?? 0;
        return bTime - aTime;
      });
  };

  const filteredRequests = useMemo(
    () => applyDashboardFilters(pendingRequests),
    [pendingRequests, searchTerm, fromDate, toDate]
  );

  const historyRequests = useMemo(
    () => allRequests.filter((request) => isVendorWorkflowCompleted(request)),
    [allRequests, foNotifiedRequestIds]
  );

  const filteredHistoryRequests = useMemo(
    () => applyDashboardFilters(historyRequests),
    [historyRequests, searchTerm, fromDate, toDate]
  );

  const visibleRequests = useMemo(
    () => {
      const requests = pendingRequests.length > 0 ? filteredRequests : filteredHistoryRequests;
      // Sort by createdAt descending (newest first)
      return [...requests].sort((a, b) => {
        const aDate = (a.createdAt as any)?.toDate?.() || new Date(a.createdAt as any);
        const bDate = (b.createdAt as any)?.toDate?.() || new Date(b.createdAt as any);
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
    },
    [pendingRequests.length, filteredRequests, filteredHistoryRequests]
  );

  // Core flattening function:
  // converts mixed single + bulk selections into one row per vehicle.
  const buildVehicleLevelRows = (
    sourceRequests: RequestWithId[],
    directory: Map<string, FoContact> = foDirectory
  ): VendorExportRow[] => {
    return sourceRequests.flatMap((request) => {
      const createdAt = toDateString(request.createdAt);
      const defaultFo = directory.get((request.createdBy as string) || '') || { email: '', name: '' };
      const normalizedRequestVehicles = normalizeVehicles(request.vehicles);
      const eligibleRequestVehicles = request.isBulkRequest
        ? getVendorEligibleVehicles(request)
        : normalizedRequestVehicles;

      if (request.isBulkRequest && eligibleRequestVehicles.length > 0) {
        return eligibleRequestVehicles.map((vehicle: any) => {
          const vehicleLtpoc = Array.isArray(vehicle?.ltpocDetails) ? vehicle.ltpocDetails[0] : null;
          const lpo = extractLpoFields(request, vehicle);
          
          // Check vehicle-level status fields
          const vehicleVendorNotified = toBoolean(vehicle.vendorNotified);
          const vehicleFoNotified = toBoolean(vehicle.foNotified);
          const vehiclePaymentApproved = toBoolean(vehicle.paymentApproved);
          const vehiclePaymentRejected = toBoolean(vehicle.paymentRejected);
          const vehicleRhApproved = toBoolean(vehicle.rhApproved);
          
          // Determine display status based on vehicle-level fields
          let displayStatus = getUnifiedStatusLabel(request.status);
          if (vehiclePaymentRejected) {
            displayStatus = 'Payment Rejected';
          } else if (vehicleFoNotified) {
            displayStatus = 'FO Notified';
          } else if (vehicleVendorNotified) {
            displayStatus = 'Vendor Notified';
          } else if (vehiclePaymentApproved) {
            displayStatus = 'Payment Approved';
          } else if (vehicleRhApproved) {
            displayStatus = 'RH Approved';
          }
          
          return {
            requestId: request.id || '',
            foUserId: String(request.createdBy || ''),
            foEmail: defaultFo.email,
            foName: defaultFo.name,
            vendorNotified: toBoolean(vehicle.vendorNotified),
            foNotified: toBoolean(vehicle.foNotified),
            status: displayStatus,
            city: request.city || '',
            clientName: request.clientName || '',
            serviceType: vehicle.serviceType || request.serviceType || '',
            serviceCost: getServiceCost(vehicle.serviceType || request.serviceType, request.serviceCost),
            vehicleNumber: vehicle.vehicleNumber || '',
            vehicleAvailabilityLocation: vehicle.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || '',
            vehicleAvailableTime: vehicle.vehicleAvailableTime || request.vehicleAvailableTime || '',
            ltpocName: normalizeExportText(vehicle.ltpocName ?? vehicleLtpoc?.ltpocName ?? ''),
            ltpocPhone: normalizeExportText(vehicle.ltpocPhone ?? vehicleLtpoc?.ltpocPhone ?? ''),
            lpoNumber: lpo.lpoNumber,
            lpoDate: lpo.lpoDate,
            lpoReferenceId: lpo.lpoReferenceId,
            lpoAdditional: lpo.lpoAdditional,
            createdAt,
          };
        });
      }

      const firstVehicle = normalizedRequestVehicles[0] as any;
      const firstLtpoc = request.ltpocDetails?.[0];
      const lpo = extractLpoFields(request, firstVehicle);

      return [
        {
          requestId: request.id || '',
          foUserId: String(request.createdBy || ''),
          foEmail: defaultFo.email,
          foName: defaultFo.name,
          vendorNotified: toBoolean(request.vendorNotified),
          foNotified: toBoolean(request.foNotified),
          status: getUnifiedStatusLabel(request.status),
          city: request.city || '',
          clientName: request.clientName || '',
          serviceType: request.serviceType || '',
          serviceCost: getServiceCost(request.serviceType, request.serviceCost),
          vehicleNumber: firstVehicle?.vehicleNumber || '',
          vehicleAvailabilityLocation: request.vehicleAvailabilityLocation || '',
          vehicleAvailableTime: request.vehicleAvailableTime || '',
          ltpocName: normalizeExportText(firstLtpoc?.ltpocName || ''),
          ltpocPhone: normalizeExportText(firstLtpoc?.ltpocPhone || ''),
          lpoNumber: lpo.lpoNumber,
          lpoDate: lpo.lpoDate,
          lpoReferenceId: lpo.lpoReferenceId,
          lpoAdditional: lpo.lpoAdditional,
          createdAt,
        },
      ];
    });
  };

  const exportRows = useMemo<VendorExportRow[]>(() => {
    return buildVehicleLevelRows(visibleRequests);
  }, [visibleRequests, foDirectory]);

  // Build FO lookup map so Notify FO can group by FO email.
  const hydrateFoDirectory = async (sourceRequests: RequestWithId[]) => {
    const nextDirectory = new Map(foDirectory);

    sourceRequests.forEach((request) => {
      const foUserId = String(request.createdBy || '');
      if (!foUserId || nextDirectory.has(foUserId)) {
        return;
      }

      const requestAny = request as Record<string, unknown>;
      nextDirectory.set(foUserId, {
        email: String(requestAny.foEmail || requestAny.createdByEmail || requestAny.email || ''),
        name: String(requestAny.foName || requestAny.createdByName || requestAny.userName || ''),
      });
    });

    setFoDirectory(nextDirectory);
    return nextDirectory;
  };

  const notifyVendorForRequests = async (requestsToNotify: RequestWithId[]) => {
    if (!userRef || requestsToNotify.length === 0) {
      return;
    }

    const directory = await hydrateFoDirectory(requestsToNotify);

    const unmappedRequests = requestsToNotify.filter((request) => !hasResolvableVendorMapping(request));
    const mappableRequests = requestsToNotify.filter((request) => hasResolvableVendorMapping(request));

    if (mappableRequests.length === 0) {
      showToast('Selected request(s) are missing vendor mapping. Please fix service type/vendor data first.', 'info');
      return;
    }

    const rowsToNotify = buildVehicleLevelRows(mappableRequests, directory);
    
    // Pre-build request lookup map for O(1) access instead of O(n) find() calls
    const requestMapById = new Map(mappableRequests.map(r => [r.id, r]));
    
    // Filter out rows that are already vendor-notified OR payment-rejected
    const pendingRows = rowsToNotify.filter((row) => {
      if (row.vendorNotified) return false;
      
      // For bulk requests, check if the specific vehicle has been payment-rejected
      const request = requestMapById.get(row.requestId);
      if (request?.isBulkRequest) {
        const vehicles = normalizeVehicles(request.vehicles);
        const hasVehiclePaymentSignals = vehicles.some(
          (item: any) => item?.paymentApproved !== undefined || item?.paymentRejected !== undefined
        );
        const vehicle = vehicles.find((v: any) => v.vehicleNumber === row.vehicleNumber);
        if (vehicle?.paymentRejected === true) return false;

        if (hasVehiclePaymentSignals && vehicle?.paymentApproved !== true) return false;

        if (!hasVehiclePaymentSignals && request.status !== REQUEST_STATUSES.PAYMENT_APPROVED) return false;
      }
      
      return true;
    });

    if (pendingRows.length === 0) {
      showToast('Vendor already notified for selected request(s).', 'info');
      return;
    }

    // Group selected vehicle rows by vendor type for consolidated vendor emails.
    const vendorGroups = new Map<string, Array<{ request: RequestWithId; row: VendorExportRow }>>();
    
    // Pre-build pending rows lookup by requestId for O(1) access
    const pendingRowsByRequestId = new Map<string, VendorExportRow[]>();
    pendingRows.forEach(row => {
      if (!pendingRowsByRequestId.has(row.requestId)) {
        pendingRowsByRequestId.set(row.requestId, []);
      }
      pendingRowsByRequestId.get(row.requestId)!.push(row);
    });

    mappableRequests.forEach((request) => {
      if (!canSelectForVendorNotify(request)) {
        return;
      }

      const requestRows = pendingRowsByRequestId.get(request.id) || [];
      requestRows.forEach((row) => {
        const vendorName = normalizeVendorName(row.serviceType || request.serviceType || request.vendorName || null);
        if (!vendorName) {
          return;
        }

        if (!vendorGroups.has(vendorName)) {
          vendorGroups.set(vendorName, []);
        }
        vendorGroups.get(vendorName)?.push({ request, row });
      });
    });

    if (vendorGroups.size === 0) {
      showToast('No vendor-eligible service rows found in selected requests.', 'info');
      return;
    }

    const requiredVendorsByRequest = new Map<string, Set<string>>();
    mappableRequests.forEach((request) => {
      const requestId = request.id as string;
      const required = new Set<string>();

      if (request.isBulkRequest) {
        const requestRows = pendingRowsByRequestId.get(requestId) || [];
        requestRows.forEach((row) => {
          const vendorName = normalizeVendorName(row.serviceType || request.serviceType || request.vendorName || null);
          if (vendorName) {
            required.add(vendorName);
          }
        });
      } else {
        const vendorName = normalizeVendorName(request.serviceType || request.vendorName || null);
        if (vendorName) {
          required.add(vendorName);
        }
      }

      if (required.size > 0) {
        requiredVendorsByRequest.set(requestId, required);
      }
    });

    const notifiedVendorsByRequest = new Map<string, Set<string>>();
    const failedVendors: string[] = [];
    const failedRequestUpdates: string[] = [];
    const successfullyUpdatedRequestIds = new Set<string>();

    for (const [vendorName, records] of vendorGroups.entries()) {
      const rows = records.map(({ row }) => ({
        requestId: row.requestId,
        city: row.city,
        clientName: row.clientName,
        date: row.createdAt,
        serviceType: row.serviceType,
        vehicleNumber: row.vehicleNumber,
        vehicleAvailabilityLocation: row.vehicleAvailabilityLocation,
        vehicleAvailableTime: row.vehicleAvailableTime,
        ltpocName: row.ltpocName,
        ltpocPhone: row.ltpocPhone,
        lpoAdditional: row.lpoAdditional,
      }));

      const requestIds = Array.from(new Set(records.map(({ row }) => row.requestId).filter(Boolean)));

      try {
        const response = await functionsService.sendVendorBulkNotification({ vendorName, requestIds, rows });
        if (!response?.success) {
          throw new Error('Backend did not confirm success');
        }

        const sentRows = Number(response?.count ?? 0);
        if (sentRows <= 0 || response?.alreadySent === true) {
          continue;
        }

        const sentRequestIds = Array.isArray((response as any)?.requestIds)
          ? ((response as any).requestIds as string[])
          : [];

        if (sentRequestIds.length === 0) {
          continue;
        }

        records.forEach(({ request }) => {
          const requestId = request.id as string;
          if (!sentRequestIds.includes(requestId)) {
            return;
          }
          if (!notifiedVendorsByRequest.has(requestId)) {
            notifiedVendorsByRequest.set(requestId, new Set());
          }
          notifiedVendorsByRequest.get(requestId)?.add(vendorName);
        });
      } catch (error) {
        console.error(`Failed vendor bulk notify for ${vendorName}`, error);
        failedVendors.push(vendorName);
      }
    }

    let updatedRequests = 0;

    for (const request of mappableRequests.filter((item) => !isVendorNotified(item))) {
      const requestId = request.id as string;
      const required = requiredVendorsByRequest.get(requestId) || new Set<string>();
      const notified = notifiedVendorsByRequest.get(requestId) || new Set<string>();

      const allSent = Array.from(required).every((vendorName) => notified.has(vendorName));
      if (!allSent) {
        continue;
      }

      try {
        if (request.isBulkRequest) {
          await requestService.notifyBulkVendor(requestId, Array.from(required).join(', '), userRef);
        } else {
          const vendorName = Array.from(required)[0];
          if (vendorName) {
            await requestService.notifyVendor(requestId, vendorName, userRef);
          }
        }

        successfullyUpdatedRequestIds.add(requestId);
        updatedRequests += 1;
      } catch (error) {
        console.error('Failed to persist vendor notify status update', {
          requestId,
          error,
        });
        failedRequestUpdates.push(requestId);
      }
    }

    if (successfullyUpdatedRequestIds.size > 0) {
      setAllRequests((prev) =>
        prev.map((request) => {
          if (!successfullyUpdatedRequestIds.has(String(request.id || ''))) {
            return request;
          }

          return {
            ...request,
            vendorNotified: true,
            status: request.isBulkRequest ? REQUEST_STATUSES.SERVICE_INITIATED : REQUEST_STATUSES.COMPLETED,
          };
        })
      );

      setSelectedRequests((prev) => {
        const next = new Set(prev);
        successfullyUpdatedRequestIds.forEach((requestId) => next.delete(requestId));
        return next;
      });

      setSelectedRequest((prev) => {
        if (!prev?.id || !successfullyUpdatedRequestIds.has(String(prev.id))) {
          return prev;
        }

        return {
          ...prev,
          vendorNotified: true,
          status: prev.isBulkRequest ? REQUEST_STATUSES.SERVICE_INITIATED : REQUEST_STATUSES.COMPLETED,
        };
      });
    }

    if (updatedRequests > 0) {
      showToast(
        failedVendors.length > 0 || failedRequestUpdates.length > 0
          ? `${updatedRequests} request(s) notified. Failed vendor group(s): ${failedVendors.join(', ') || 'none'}. Failed request update(s): ${failedRequestUpdates.join(', ') || 'none'}. Skipped unmapped request(s): ${unmappedRequests.length}`
          : unmappedRequests.length > 0
            ? `${updatedRequests} request(s) notified. Skipped unmapped request(s): ${unmappedRequests.length}`
            : `${updatedRequests} request(s) notified successfully.`,
        failedVendors.length > 0 || failedRequestUpdates.length > 0 ? 'info' : 'success'
      );
    } else {
      showToast(
        unmappedRequests.length > 0
          ? `No requests were updated. Skipped unmapped request(s): ${unmappedRequests.length}.`
          : 'No requests were updated. Check selected records and vendor mapping.',
        'info'
      );
    }
  };

  const handleNotifyVendor = async () => {
    if (!selectedRequest) {
      return;
    }

    setNotifying(true);
    try {
      await notifyVendorForRequests([selectedRequest]);
      setShowModal(false);
    } catch (error) {
      showToast('Failed to notify vendor: ' + (error as Error).message, 'error');
    } finally {
      setNotifying(false);
    }
  };

  const handleBulkNotifyVendor = async () => {
    if (!userRef || selectedRequests.size === 0) {
      showToast('Please select requests to notify', 'info');
      return;
    }

    setNotifying(true);
    try {
      const selected = visibleRequests
        .filter((request) => selectedRequests.has(request.id as string))
        .filter((request) => canSelectForVendorNotify(request));

      if (selected.length === 0) {
        showToast('No selected request is eligible for Vendor notification.', 'info');
        return;
      }

      await notifyVendorForRequests(selected);
      setSelectedRequests(new Set());
    } catch (error) {
      showToast('Failed to bulk notify: ' + (error as Error).message, 'error');
    } finally {
      setNotifying(false);
    }
  };

  const handleNotifyFo = async (requestIds?: string[]) => {
    const selectedIds = requestIds ? new Set(requestIds) : selectedRequests;

    if (selectedIds.size === 0) {
      showToast('Select request(s) to notify FO', 'info');
      return;
    }

    const selected = visibleRequests
      .filter((request) => selectedIds.has(request.id as string))
      .filter((request) => canSelectForFoNotify(request));
    if (selected.length === 0) {
      showToast('No selected request is eligible for FO notification', 'info');
      return;
    }

    const alreadyNotified = selected.filter((request) => isFoBulkNotified(request));
    const pending = selected.filter((request) => !isFoBulkNotified(request));

    if (pending.length === 0) {
      showToast('FO already notified for selected request(s).', 'info');
      return;
    }

    setNotifying(true);
    try {
      const directory = await hydrateFoDirectory(pending);
      const pendingRows = buildVehicleLevelRows(pending, directory).filter((row) => !row.foNotified);
      // Group selected vehicle rows by FO email for consolidated FO emails.
      const rowsByFoGroup = new Map<string, VendorExportRow[]>();

      pendingRows.forEach((row) => {
        const groupKey = row.foEmail ? `mail:${row.foEmail}` : row.foUserId ? `uid:${row.foUserId}` : '';
        if (!groupKey) {
          return;
        }
        if (!rowsByFoGroup.has(groupKey)) {
          rowsByFoGroup.set(groupKey, []);
        }
        rowsByFoGroup.get(groupKey)?.push(row);
      });

      if (rowsByFoGroup.size === 0) {
        showToast('Unable to resolve FO identity for selected requests.', 'info');
        return;
      }

      const failedFoGroups: string[] = [];
      const successRequestIds = new Set<string>();

      for (const [groupKey, foRows] of rowsByFoGroup.entries()) {
        const requestIds = Array.from(new Set(foRows.map((row) => row.requestId)));
        try {
          const response = await functionsService.sendFoBulkNotification({
            requestIds,
            foEmail: foRows[0]?.foEmail || undefined,
            foName: foRows[0]?.foName || 'Field Operator',
            rows: foRows.map((row) => ({
              requestId: row.requestId,
              status: row.status,
              city: row.city,
              clientName: row.clientName,
              serviceType: row.serviceType,
              serviceCost: row.serviceCost,
              vehicleNumber: row.vehicleNumber,
              vehicleAvailabilityLocation: row.vehicleAvailabilityLocation,
              vehicleAvailableTime: row.vehicleAvailableTime,
              ltpocName: row.ltpocName,
              ltpocPhone: row.ltpocPhone,
              lpoAdditional: row.lpoAdditional,
              createdAt: row.createdAt,
            })),
          });

          if (!response?.success) {
            failedFoGroups.push(groupKey);
            continue;
          }

          const sentRequestIds = Array.isArray((response as any)?.requestIds)
            ? ((response as any).requestIds as string[])
            : [];

          if (sentRequestIds.length === 0) {
            if (response?.alreadySent !== true) {
              failedFoGroups.push(groupKey);
            }
            continue;
          }

          sentRequestIds.forEach((requestId) => successRequestIds.add(requestId));
        } catch (error) {
          console.error('Failed FO bulk notify group', {
            groupKey,
            requestIds,
            error,
          });
          failedFoGroups.push(groupKey);
        }
      }

      setFoNotifiedRequestIds((prev) => {
        const next = new Set(prev);
        Array.from(successRequestIds).forEach((requestId) => next.add(requestId));
        return next;
      });

      if (successRequestIds.size > 0) {
        setAllRequests((prev) =>
          prev.map((request) => {
            if (!successRequestIds.has(String(request.id || ''))) {
              return request;
            }

            return {
              ...request,
              foNotified: true,
              notifiedAt: new Date(),
            };
          })
        );
      }

      const successCount = successRequestIds.size;
      const skippedCount = alreadyNotified.length;
      const failedCount = failedFoGroups.length;

      const summaryLine = `Summary: Sent ${successCount}, Skipped ${skippedCount}, Failed ${failedCount}`;

      if (successCount === 0 && failedCount === 0) {
        showToast(
          skippedCount > 0
            ? `${summaryLine}. No new FO notifications were sent (already notified).`
            : `${summaryLine}. No FO notification was sent for the selected request(s). Please refresh and retry.`,
          'info'
        );
      } else {
        showToast(
          failedCount > 0
            ? `${summaryLine}. Failed FO group(s): ${failedFoGroups.join(', ')}`
            : skippedCount > 0
              ? `${summaryLine}. FO notified with consolidated CSV.`
              : `${summaryLine}. FO notified successfully with consolidated CSV.`,
          failedCount > 0 ? 'info' : 'success'
        );
      }

      if (!requestIds) {
        setSelectedRequests(new Set());
      }
    } catch (error) {
      console.error('Notify FO failed', error);
      showToast('Failed to notify FO: ' + (error as Error).message, 'error');
    } finally {
      setNotifying(false);
    }
  };

  const toggleRequestSelection = (requestId: string) => {
    const request = visibleRequests.find((item) => item.id === requestId);
    if (!request || !canSelectRequest(request)) {
      return;
    }

    setSelectedRequests((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  useEffect(() => {
    setSelectedRequests((prev) => {
      const next = new Set(
        Array.from(prev).filter((id) => visibleRequests.some((request) => request.id === id && canSelectRequest(request)))
      );
      return next.size === prev.size ? prev : next;
    });
  }, [visibleRequests]);

  const selectedVendorEligibleCount = useMemo(
    () => visibleRequests.filter((request) => selectedRequests.has(request.id as string) && canSelectForVendorNotify(request)).length,
    [visibleRequests, selectedRequests]
  );

  const selectedFoEligibleCount = useMemo(
    () => visibleRequests.filter((request) => selectedRequests.has(request.id as string) && canSelectForFoNotify(request)).length,
    [visibleRequests, selectedRequests]
  );

  const hasSelectableRequests = useMemo(
    () => visibleRequests.some((request) => canSelectRequest(request)),
    [visibleRequests]
  );

  // Fix #5: dashboard counters derived from live snapshot data.
  const totalPendingCount = useMemo(
    () => allRequests.filter((request) => isPendingVendorCoordination(request)).length,
    [allRequests]
  );

  const foPendingCount = useMemo(
    () =>
      allRequests.filter(
        (request) => getVendorStageLabel(request).toLowerCase() === 'pending fo notification'
      ).length,
    [allRequests, foNotifiedRequestIds]
  );

  const completedCount = useMemo(
    () => allRequests.filter((request) => isVendorWorkflowCompleted(request)).length,
    [allRequests, foNotifiedRequestIds]
  );

  const downloadExcel = () => {
    // Sort by date descending (newest first)
    const sortedRows = [...exportRows].sort((a, b) => {
      const dateA = new Date(a.createdAt || '').getTime();
      const dateB = new Date(b.createdAt || '').getTime();
      return dateB - dateA; // Descending order
    });

    const data = sortedRows
      .map((row) => {
        const rowData: Record<string, string | number> = {};
        // Only include non-empty fields
        const fields = {
          'Request ID': normalizeExportValue(row.requestId),
          Status: normalizeExportValue(row.status),
          City: normalizeExportValue(row.city),
          Client: normalizeExportValue(row.clientName),
          'Service Type': normalizeExportValue(row.serviceType),
          'Service Cost': normalizeExportValue(row.serviceCost),
          'Vehicle Number': normalizeExportValue(row.vehicleNumber),
          'Vehicle Availability Location': normalizeExportValue(row.vehicleAvailabilityLocation),
          'Vehicle Available Time': normalizeExportValue(row.vehicleAvailableTime),
          'LTPOC Name': normalizeExportValue(row.ltpocName),
          'LTPOC Phone': normalizeExportValue(row.ltpocPhone),
          'LPO Additional': normalizeExportValue(row.lpoAdditional),
          Date: normalizeExportValue(row.createdAt),
        };
        // Add only non-empty fields to rowData
        Object.entries(fields).forEach(([key, value]) => {
          if (value !== '' && value !== 0) {
            rowData[key] = value;
          }
        });
        return rowData;
      })
      .filter((row) => Object.keys(row).length > 0); // Remove completely empty rows

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Requests');
    XLSX.writeFile(workbook, `vendor_requests_${fromDate || 'all'}_to_${toDate || 'all'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadCsv = () => {
    // Sort by date descending (newest first)
    const sortedRows = [...exportRows].sort((a, b) => {
      const dateA = new Date(a.createdAt || '').getTime();
      const dateB = new Date(b.createdAt || '').getTime();
      return dateB - dateA; // Descending order
    });

    const data = sortedRows
      .map((row) => {
        // Always include all fields with empty strings as blanks
        const rowData: Record<string, string | number> = {
          'Request ID': normalizeExportValue(row.requestId),
          Status: normalizeExportValue(row.status),
          'Created Date': normalizeExportValue(row.createdAt),
          City: normalizeExportValue(row.city),
          Client: normalizeExportValue(row.clientName),
          'Service Type': normalizeExportValue(row.serviceType),
          'Service Cost': normalizeExportValue(row.serviceCost),
          'Vehicle Number': normalizeExportValue(row.vehicleNumber),
          'Vehicle Availability Location': normalizeExportValue(row.vehicleAvailabilityLocation),
          'Vehicle Available Time': normalizeExportValue(row.vehicleAvailableTime),
          'LTPOC Name': normalizeExportValue(row.ltpocName),
          'LTPOC Phone': normalizeExportValue(row.ltpocPhone),
          'LPO Additional': normalizeExportValue(row.lpoAdditional),
        };
        return rowData;
      })

    const worksheet = XLSX.utils.json_to_sheet(data);
    // Auto-fit column widths
    const columnWidths = Object.keys(data[0] || {}).map((col) => ({
      wch: Math.max(col.length + 2, 12),
    }));
    worksheet['!cols'] = columnWidths;
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `vendor_requests_${fromDate || 'all'}_to_${toDate || 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Vendor Coordinator Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="dashboard-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search by ID, client, or city..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>From Date:</label>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>To Date:</label>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>

          <button className="btn btn-secondary" onClick={() => { setFromDate(''); setToDate(''); }}>
            Clear Dates
          </button>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {selectedRequests.size > 0 && (
            <>
              {selectedVendorEligibleCount > 0 && (
                <button className="btn btn-primary" onClick={handleBulkNotifyVendor} disabled={notifying}>
                  {notifying ? 'Notifying...' : `Bulk Notify Vendor (${selectedVendorEligibleCount})`}
                </button>
              )}
              {selectedFoEligibleCount > 0 && (
                <button className="btn btn-secondary" onClick={() => void handleNotifyFo()} disabled={notifying}>
                  {notifying ? 'Notifying...' : `Notify FO (${selectedFoEligibleCount})`}
                </button>
              )}
            </>
          )}

          <button className="btn btn-primary" onClick={downloadExcel} disabled={exportRows.length === 0}>
            Download Excel
          </button>
          <button className="btn btn-secondary" onClick={downloadCsv} disabled={exportRows.length === 0}>
            Download CSV
          </button>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <strong>Total Pending: {totalPendingCount}</strong>
        <span style={{ marginLeft: 6, color: '#666', fontSize: '0.9rem' }}>(pending + pending FO)</span>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>FO Pending: {foPendingCount}</strong>
        <span style={{ marginLeft: 6, color: '#666', fontSize: '0.9rem' }}>(vendor notified, FO not yet notified)</span>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>Completed: {completedCount}</strong>
        <span style={{ marginLeft: 6, color: '#666', fontSize: '0.9rem' }}>(FO notified or service completed)</span>
      </div>

      <div className="dashboard-content">
        {visibleRequests.length === 0 ? (
          <p className="text-muted">No requests found</p>
        ) : (
          <div className="requests-table-wrapper">
            <table className="requests-table">
              <thead>
                <tr>
                  {hasSelectableRequests && (
                    <th>
                      <input
                        type="checkbox"
                        onChange={() => {
                          const selectableIds = visibleRequests
                            .filter((request) => canSelectRequest(request))
                            .map((request) => request.id as string);
                          if (selectableIds.length > 0 && selectableIds.every((id) => selectedRequests.has(id))) {
                            setSelectedRequests(new Set());
                          } else {
                            setSelectedRequests(new Set(selectableIds));
                          }
                        }}
                        checked={
                          visibleRequests.filter((request) => canSelectRequest(request)).length > 0 &&
                          visibleRequests
                            .filter((request) => canSelectRequest(request))
                            .every((request) => selectedRequests.has(request.id as string))
                        }
                      />
                    </th>
                  )}
                  <th>Request ID</th>
                  <th>Status</th>
                  <th>Client</th>
                  <th>City</th>
                  <th>Service</th>
                  <th>Vehicles</th>
                  <th>Created At</th>
                  <th style={{ minWidth: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRequests.map((request) => (
                  <tr key={request.id} style={{ backgroundColor: request.isBulkRequest ? '#e3f2fd' : 'transparent' }}>
                    {hasSelectableRequests && (
                      <td>
                        {canSelectRequest(request) ? (
                          <input
                            type="checkbox"
                            checked={selectedRequests.has(request.id as string)}
                            onChange={() => toggleRequestSelection(request.id as string)}
                          />
                        ) : null}
                      </td>
                    )}
                    <td className="request-id-cell">{request.id?.substring(0, 8)}...</td>
                    <td>
                      <span className={`status-badge ${getVendorStageClass(request)}`}>
                        {getVendorStageLabel(request)}
                      </span>
                    </td>
                    <td>{request.clientName || 'N/A'}</td>
                    <td>{request.city} {request.isBulkRequest ? '(BULK)' : ''}</td>
                    <td>{request.isBulkRequest ? 'Per-vehicle' : request.serviceType || 'N/A'}</td>
                    <td>{request.isBulkRequest ? getVendorEligibleVehicles(request).length || 0 : normalizeVehicles(request.vehicles).length || 0}</td>
                    <td>
                      {request.createdAt
                        ? new Date((request.createdAt as any)?.toDate?.() || request.createdAt).toLocaleDateString()
                        : 'N/A'}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          setSelectedRequest(request);
                          setShowModal(true);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedRequest && (
        <Modal
          isOpen={showModal}
          title="Request Details - Vendor Coordination"
          onClose={() => setShowModal(false)}
          onSubmit={() => setShowModal(false)}
          submitText="Close"
        >
          <div className="modal-details">
            <p><strong>Request ID:</strong> {selectedRequest.id}</p>
            <p><strong>Status:</strong> {getUnifiedStatusLabel(selectedRequest.status)}</p>
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}</p>
            <p><strong>Service:</strong> {selectedRequest.isBulkRequest ? 'Per-vehicle' : selectedRequest.serviceType || 'N/A'}</p>
            <p><strong>Vehicles:</strong> {selectedRequest.isBulkRequest ? getVendorEligibleVehicles(selectedRequest).length || 0 : normalizeVehicles(selectedRequest.vehicles).length || 0}</p>

            {selectedRequest.isBulkRequest && normalizeVehicles(selectedRequest.vehicles).length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h4 style={{ marginTop: 0 }}>Per-Vehicle Details</h4>
                {normalizeVehicles(selectedRequest.vehicles).map((vehicle, index, allVehicles) => {
                  const vehicleNumber = String(
                    vehicle?.vehicleNumber || vehicle?.vehicleNo || vehicle?.registrationNumber || 'N/A'
                  );
                  const isPaymentRejected = toBoolean(vehicle?.paymentRejected);
                  const isPaymentApproved = toBoolean(vehicle?.paymentApproved);
                  const rejectionReason = getPaymentRejectionReason(vehicle, selectedRequest);

                  return (
                    <div
                      key={`${vehicleNumber}-${index}`}
                      style={{
                        marginBottom: '12px',
                        paddingBottom: '12px',
                        borderBottom: index < allVehicles.length - 1 ? '1px solid #ddd' : 'none',
                      }}
                    >
                      <p><strong>Vehicle Number:</strong> {vehicleNumber}</p>
                      <p>
                        <strong>Payment Status:</strong>{' '}
                        <span
                          style={{
                            color: isPaymentRejected ? '#b71c1c' : isPaymentApproved ? '#2e7d32' : '#856404',
                            fontWeight: 600,
                          }}
                        >
                          {isPaymentRejected ? 'Rejected' : isPaymentApproved ? 'Approved' : 'Pending'}
                        </span>
                      </p>
                      {isPaymentRejected && rejectionReason && (
                        <p>
                          <strong>Rejection Reason:</strong>{' '}
                          <span className="rejection-reason-highlight">{rejectionReason}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {canSelectForVendorNotify(selectedRequest) && (
              <div className="action-buttons">
                <button className="btn btn-primary" onClick={handleNotifyVendor} disabled={notifying}>
                  {notifying ? 'Notifying...' : 'Notify Vendor'}
                </button>
              </div>
            )}

            {canSelectForFoNotify(selectedRequest) && (
              <div className="action-buttons" style={{ marginTop: '0.5rem' }}>
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    if (!selectedRequest.id) {
                      return;
                    }

                    await handleNotifyFo([selectedRequest.id]);
                    setShowModal(false);
                  }}
                  disabled={notifying}
                >
                  {notifying ? 'Notifying...' : 'Notify FO'}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
