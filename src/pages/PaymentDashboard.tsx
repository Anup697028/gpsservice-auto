import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import { showToast } from '../components/Toast';
import { AuditLog } from '../components/AuditLog';
import { Modal } from '../components/Modal';
import { Loader } from '../components/Loader';
import '../styles/dashboard.css';
import { REQUEST_STATUSES } from '../types/workflow';
import type { RequestRecord, UserRef } from '../types/workflow';
import { getUnifiedStatusLabel } from '../utils/statusMapping';

type RequestWithId = RequestRecord & { id?: string; auditLog?: Array<{ action: string; performedBy?: string; timestamp?: string }> };

type PaymentActionFilter = 'ALL' | 'APPROVED' | 'NOT_APPROVED';
type BulkPaymentAction = 'APPROVE' | 'REJECT';
type RejectTarget = {
  request: RequestWithId;
  vehicleIndex: number | null;
};

type PaymentServiceRow = {
  requestId: string;
  isBulkRequest: boolean;
  vehicleIndex: number | null;
  city: string;
  client: string;
  date: string;
  serviceType: string;
  serviceCost: number | null;
  action: 'Approved' | 'Not Approved';
  statusLabel: string;
  vehicleNumber: string;
  location: string;
  availableTime: string;
  ltpocName: string;
  ltpocPhone: string;
  rowPaymentActionTaken: boolean;
  rowPaymentApproved: boolean;
  rowPaymentRejected: boolean;
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

const extractVehicleNumbersFromHistory = (history: unknown): string[] => {
  if (!Array.isArray(history)) {
    return [];
  }

  const entries = history as Array<Record<string, unknown>>;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const notes = String(entries[index]?.notes || '');
    const match = notes.match(/vehicle\(s\):\s*(.+)$/i);
    if (!match?.[1]) {
      continue;
    }

    return match[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
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

const toDateString = (value: unknown) => {
  const dateValue = toDateValue(value);
  return dateValue ? dateValue.toISOString().slice(0, 10) : '';
};

const getVehicleServiceCost = (serviceType?: string | null, fallbackCost?: number | null) => {
  if (serviceType && SERVICE_COST_BY_TYPE[serviceType]) {
    return SERVICE_COST_BY_TYPE[serviceType];
  }
  return fallbackCost ?? null;
};

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

const normalizeRecordList = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ((value as Record<string, unknown>)[key] ?? {}) as Record<string, unknown>);
  }

  return [];
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeServiceType = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (raw === 'fleetx') {
    return 'FleetX';
  }
  if (raw === 'wheelseye') {
    return 'WheelsEye';
  }
  return String(value || '');
};

const resolveServiceType = (vehicle: Record<string, unknown>, request: RequestWithId) => {
  const requestServiceCost = Number(request.serviceCost || 0);
  const vehicleServiceCost = Number(vehicle?.serviceCost || 0);

  const inferredFromCost =
    requestServiceCost === 3000 || vehicleServiceCost === 3000
      ? 'FleetX'
      : requestServiceCost === 2000 || vehicleServiceCost === 2000
        ? 'WheelsEye'
        : '';

  return (
    normalizeServiceType(vehicle?.serviceType) ||
    normalizeServiceType(vehicle?.service_type) ||
    normalizeServiceType(vehicle?.serviceTypeName) ||
    normalizeServiceType(vehicle?.vendorType) ||
    normalizeServiceType(vehicle?.service) ||
    normalizeServiceType(vehicle?.vendor) ||
    normalizeServiceType(request.serviceType) ||
    normalizeServiceType((request as any).service_type) ||
    normalizeServiceType(request.vendorType) ||
    normalizeServiceType((request as any).vendor_type) ||
    inferredFromCost ||
    ''
  );
};

const resolveVehicleNumber = (vehicle: Record<string, unknown>) => {
  return String(
    vehicle?.vehicleNumber ||
      vehicle?.vehicleNo ||
      vehicle?.registrationNumber ||
      vehicle?.vehicle_num ||
      vehicle?.vehicle ||
      ''
  ).trim();
};

const resolveLocation = (vehicle: Record<string, unknown>, request: RequestWithId) => {
  return String(
    vehicle?.vehicleAvailabilityLocation ||
    vehicle?.availabilityLocation ||
    vehicle?.vehicleLocation ||
    vehicle?.location ||
    request.vehicleAvailabilityLocation ||
    ''
  ).trim();
};

const resolveAvailableTime = (vehicle: Record<string, unknown>, request: RequestWithId) => {
  return String(
    vehicle?.vehicleAvailableTime ||
    vehicle?.availableTime ||
    vehicle?.availabilityTime ||
    request.vehicleAvailableTime ||
    ''
  ).trim();
};

const resolvePaymentStatusLabel = (
  requestStatus: RequestWithId['status'],
  rowPaymentApproved: boolean,
  rowPaymentRejected: boolean
) => {
  if (requestStatus === REQUEST_STATUSES.CANCELLED) {
    return 'Cancelled';
  }

  if (rowPaymentRejected) {
    return 'Payment Rejected';
  }

  if (rowPaymentApproved) {
    return 'Payment Approved';
  }

  return getUnifiedStatusLabel(requestStatus);
};

export const PaymentDashboard = () => {
  const { user, userRole } = useAuth();
  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actionFilter, setActionFilter] = useState<PaymentActionFilter>('ALL');
  const [showAdditionalColumns, setShowAdditionalColumns] = useState(false);
  const [processingRequestIds, setProcessingRequestIds] = useState<Set<string>>(new Set());
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const cityDropdownRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const unsubscribe = requestService.subscribeToAllRequests((data) => {
      setRequests(data as RequestWithId[]);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(event.target as Node)) {
        setCityDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cityOptions = useMemo(() => {
    return Array.from(new Set(requests.map((request) => request.city).filter(Boolean))) as string[];
  }, [requests]);

  const filteredCityOptions = useMemo(() => {
    const term = citySearchTerm.trim().toLowerCase();
    if (!term) {
      return cityOptions;
    }

    return cityOptions.filter((city) => city.toLowerCase().includes(term));
  }, [cityOptions, citySearchTerm]);

  const cityFilterLabel = useMemo(() => {
    if (cityFilter.length === 0) {
      return 'All Cities';
    }

    if (cityFilter.length <= 2) {
      return cityFilter.join(', ');
    }

    return `${cityFilter.length} cities selected`;
  }, [cityFilter]);

  const toggleCityFilterSelection = (city: string) => {
    setCityFilter((prev) => {
      if (prev.includes(city)) {
        return prev.filter((item) => item !== city);
      }
      return [...prev, city];
    });
  };

  const isPaymentApproved = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      return request.paymentStatus === 'APPROVED';
    }
    return Boolean(request.paymentApproval);
  };

  const canTakePaymentAction = (request: RequestWithId) => {
    if (request.isBulkRequest) {
      return request.status === REQUEST_STATUSES.FO_CREATED && request.paymentStatus !== 'APPROVED';
    }

    return request.status === REQUEST_STATUSES.PARALLEL_REVIEW && !request.paymentActionTaken;
  };

  const getRowSelectionKey = (row: PaymentServiceRow) =>
    row.isBulkRequest
      ? `B:${row.requestId}:${row.vehicleIndex ?? -1}`
      : `S:${row.requestId}`;

  const canTakeRowAction = (request: RequestWithId, row: PaymentServiceRow) => {
    const rowPending =
      row.rowPaymentActionTaken === false &&
      row.rowPaymentApproved === false &&
      row.rowPaymentRejected === false;

    if (!rowPending) {
      return false;
    }

    if (request.isBulkRequest) {
      return request.status === REQUEST_STATUSES.FO_CREATED;
    }

    return request.status === REQUEST_STATUSES.PARALLEL_REVIEW;
  };

  const filteredRequests = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return requests
      .filter((request) => {
        const matchesSearch =
          request.id?.toLowerCase().includes(term) ||
          request.clientName?.toLowerCase().includes(term) ||
          request.city?.toLowerCase().includes(term);

        const matchesCity = cityFilter.length > 0 ? cityFilter.includes(String(request.city || '')) : true;

        const requestDate = toDateValue(request.createdAt);
        const matchesFrom = fromDate ? (requestDate ? requestDate >= new Date(fromDate) : false) : true;
        const toDateValueObj = toDate ? new Date(toDate) : null;
        if (toDateValueObj) {
          toDateValueObj.setHours(23, 59, 59, 999);
        }
        const matchesTo = toDateValueObj ? (requestDate ? requestDate <= toDateValueObj : false) : true;

        const approved = isPaymentApproved(request);
        const matchesAction =
          actionFilter === 'ALL'
            ? true
            : actionFilter === 'APPROVED'
              ? approved
              : !approved;

        return Boolean(matchesSearch) && matchesCity && matchesFrom && matchesTo && matchesAction;
      })
      .sort((a, b) => {
        const aTime = toDateValue(a.createdAt)?.getTime() ?? 0;
        const bTime = toDateValue(b.createdAt)?.getTime() ?? 0;
        return bTime - aTime;
      });
  }, [requests, searchTerm, cityFilter, fromDate, toDate, actionFilter]);

  const exportRows = useMemo<PaymentServiceRow[]>(() => {
    return filteredRequests.flatMap((request) => {
      const actionLabel: 'Approved' | 'Not Approved' = isPaymentApproved(request) ? 'Approved' : 'Not Approved';
      const date = toDateString(request.createdAt);
      const normalizedVehicles = normalizeVehicles(request.vehicles);
      const normalizedLtpocDetails = normalizeRecordList(request.ltpocDetails);
      const normalizedDriverDetails = normalizeRecordList((request as any).driverDetails);
      const historyVehicleNumbers = extractVehicleNumbersFromHistory(request.history);

      const defaultServiceType =
        normalizeServiceType(request.serviceType) ||
        normalizeServiceType((request as any).service_type) ||
        normalizeServiceType(request.vendorType) ||
        normalizeServiceType((request as any).vendor_type) ||
        normalizeServiceType(
          normalizedVehicles.find((vehicle) => normalizeServiceType(vehicle?.serviceType))?.serviceType
        ) ||
        normalizeServiceType(
          normalizedVehicles.find((vehicle) => normalizeServiceType((vehicle as any)?.service_type))?.service_type
        ) ||
        normalizeServiceType(
          normalizedVehicles.find((vehicle) => normalizeServiceType(vehicle?.vendorType))?.vendorType
        ) ||
        '';

      const defaultLocation =
        String(request.vehicleAvailabilityLocation || '').trim() ||
        String(
          normalizedVehicles.find((vehicle) => String(vehicle?.vehicleAvailabilityLocation || '').trim())
            ?.vehicleAvailabilityLocation || ''
        ).trim();

      const defaultAvailableTime =
        String(request.vehicleAvailableTime || '').trim() ||
        String(
          normalizedVehicles.find((vehicle) => String(vehicle?.vehicleAvailableTime || '').trim())
            ?.vehicleAvailableTime || ''
        ).trim();

      const ltpocByVehicle = new Map(
        normalizedLtpocDetails.map((item) => [
          String(item.vehicleNumber ?? ''),
          item,
        ])
      );

      if (request.isBulkRequest && normalizedVehicles.length > 0) {
        return normalizedVehicles.map((vehicle: any, vehicleIndex: number) => {
          const vehicleData = vehicle as Record<string, unknown>;
          const ltpocAtIndex = (normalizedLtpocDetails[vehicleIndex] ?? null) as Record<string, unknown> | null;
          const driverAtIndex = (normalizedDriverDetails[vehicleIndex] ?? null) as Record<string, unknown> | null;
          const resolvedVehicleNumber =
            resolveVehicleNumber(vehicleData) ||
            String(ltpocAtIndex?.vehicleNumber || '').trim() ||
            String(driverAtIndex?.vehicleNumber || '').trim() ||
            String(historyVehicleNumbers[vehicleIndex] || '').trim();
          const matchedLtpoc = ltpocByVehicle.get(resolvedVehicleNumber) as Record<string, unknown> | undefined;
          const vehiclePaymentStatus = String(vehicleData?.paymentStatus || '').toUpperCase();
          const requestPaymentStatus = String((request as any)?.paymentStatus || '').toUpperCase();
          const hasVehiclePaymentFields =
            vehicleData?.paymentApproved !== undefined ||
            vehicleData?.paymentRejected !== undefined ||
            vehicleData?.paymentActionTaken !== undefined ||
            vehicleData?.paymentApprovedAt !== undefined ||
            vehicleData?.paymentRejectedAt !== undefined ||
            vehicleData?.paymentStatus !== undefined;

          const legacyParentApproved =
            !hasVehiclePaymentFields &&
            (requestPaymentStatus === 'APPROVED' || request.status === REQUEST_STATUSES.PAYMENT_APPROVED);
          const legacyParentRejected =
            !hasVehiclePaymentFields && requestPaymentStatus === 'REJECTED';

          const rowPaymentApproved =
            toBooleanFlag(vehicleData?.paymentApproved) ||
            Boolean(vehicleData?.paymentApprovedAt) ||
            vehiclePaymentStatus === 'APPROVED' ||
            legacyParentApproved;
          const rowPaymentRejected =
            toBooleanFlag(vehicleData?.paymentRejected) ||
            Boolean(vehicleData?.paymentRejectedAt) ||
            vehiclePaymentStatus === 'REJECTED' ||
            legacyParentRejected;
          const rowPaymentActionTaken =
            toBooleanFlag(vehicleData?.paymentActionTaken) ||
            vehiclePaymentStatus === 'APPROVED' ||
            vehiclePaymentStatus === 'REJECTED' ||
            rowPaymentApproved ||
            rowPaymentRejected;
          const statusLabel = resolvePaymentStatusLabel(
            request.status,
            rowPaymentApproved,
            rowPaymentRejected
          );
          const resolvedServiceType = resolveServiceType(vehicleData, request) || defaultServiceType || 'FleetX';
          const vehicleServiceCost =
            toNumberOrNull(vehicleData?.serviceCost) ||
            toNumberOrNull((vehicleData as any)?.service_cost) ||
            toNumberOrNull((vehicleData as any)?.cost);
          const resolvedLocation =
            resolveLocation(vehicleData, request) ||
            defaultLocation ||
            String((ltpocAtIndex as any)?.vehicleAvailabilityLocation || '') ||
            String((driverAtIndex as any)?.vehicleAvailabilityLocation || '');
          const resolvedAvailableTime =
            resolveAvailableTime(vehicleData, request) ||
            defaultAvailableTime ||
            String((ltpocAtIndex as any)?.vehicleAvailableTime || '') ||
            String((driverAtIndex as any)?.vehicleAvailableTime || '');

          return {
          requestId: request.id || '',
          isBulkRequest: Boolean(request.isBulkRequest),
          vehicleIndex,
          city: request.city || '',
          client: request.clientName || '',
          date,
          serviceType: resolvedServiceType || 'FleetX',
          serviceCost: getVehicleServiceCost(
            resolvedServiceType,
            vehicleServiceCost ??
              toNumberOrNull(request.serviceCost) ??
              toNumberOrNull((request as any).service_cost) ??
              toNumberOrNull((request as any).cost)
          ),
          action: actionLabel,
          statusLabel,
          vehicleNumber: resolvedVehicleNumber || `Vehicle ${vehicleIndex + 1}`,
          location: resolvedLocation,
          availableTime: resolvedAvailableTime,
          ltpocName: String(
            vehicleData?.ltpocName ||
            vehicleData?.driverName ||
            driverAtIndex?.driverName ||
            matchedLtpoc?.ltpocName ||
            ''
          ),
          ltpocPhone: String(
            vehicleData?.ltpocPhone ||
            vehicleData?.driverPhone ||
            driverAtIndex?.driverNumber ||
            matchedLtpoc?.ltpocPhone ||
            ''
          ),
          rowPaymentActionTaken,
          rowPaymentApproved,
          rowPaymentRejected,
        };
      });
      }

      const firstVehicle = normalizedVehicles[0] as any;
      const firstLtpoc = normalizedLtpocDetails[0];

      const singlePaymentApproved =
        toBooleanFlag((request as any).paymentApproved) ||
        toBooleanFlag(request.paymentApproval) ||
        Boolean((request as any).paymentApprovedAt);
      const singlePaymentRejected =
        toBooleanFlag((request as any).paymentRejected) ||
        Boolean((request as any).paymentRejectedAt);
      const singlePaymentActionTaken =
        toBooleanFlag(request.paymentActionTaken) ||
        singlePaymentApproved ||
        singlePaymentRejected;
      const statusLabel = resolvePaymentStatusLabel(
        request.status,
        singlePaymentApproved,
        singlePaymentRejected
      );

      return [
        {
          requestId: request.id || '',
          isBulkRequest: Boolean(request.isBulkRequest),
          vehicleIndex: 0,
          city: request.city || '',
          client: request.clientName || '',
          date,
          serviceType: request.serviceType || '',
          serviceCost: getVehicleServiceCost(request.serviceType, request.serviceCost),
          action: actionLabel,
          statusLabel,
          vehicleNumber: firstVehicle?.vehicleNumber || '',
          location: request.vehicleAvailabilityLocation || '',
          availableTime: request.vehicleAvailableTime || '',
          ltpocName: String(firstLtpoc?.ltpocName || ''),
          ltpocPhone: String(firstLtpoc?.ltpocPhone || ''),
          rowPaymentActionTaken: singlePaymentActionTaken,
          rowPaymentApproved: singlePaymentApproved,
          rowPaymentRejected: singlePaymentRejected,
        },
      ];
    });
  }, [filteredRequests]);

  useEffect(() => {
    setSelectedRowKeys((prev) => {
      const validKeys = new Set(
        exportRows
          .filter((row) => {
            const request = filteredRequests.find((item) => item.id === row.requestId);
            return request ? canTakeRowAction(request, row) : false;
          })
          .map((row) => getRowSelectionKey(row))
      );

      const next = new Set<string>();
      prev.forEach((key) => {
        if (validKeys.has(key)) {
          next.add(key);
        }
      });
      return next;
    });
  }, [exportRows, filteredRequests]);

  const approveRequest = async (request: RequestWithId) => {
    if (!request?.id || !userRef) {
      return;
    }

    if (processingRequestIds.has(request.id)) {
      return;
    }

    setProcessingRequestIds((prev) => new Set(prev).add(request.id as string));

    const isBulk = request.isBulkRequest;

    if (isBulk) {
      if (request.status !== REQUEST_STATUSES.FO_CREATED) {
        showToast(
          `Cannot approve: Bulk request is in ${request.status} status. Payment approval only allowed at FO_CREATED stage.`,
          'error'
        );
        setProcessingRequestIds((prev) => {
          const next = new Set(prev);
          next.delete(request.id as string);
          return next;
        });
        return;
      }

      try {
        await requestService.approveBulkPayment(request.id as string, userRef);

        if (request.rhStatus === 'APPROVED') {
          showToast(
            `✓ Payment Approved! Both teams approved - Bulk request (${request.vehicleCount} vehicles) ready for vendor`,
            'success'
          );
        } else {
          showToast('✓ Payment Approved! Waiting for RH team before sending to vendor...', 'success');
        }
        setShowModal(false);
      } catch (error) {
        showToast('Failed to approve bulk request: ' + (error as Error).message, 'error');
      } finally {
        setProcessingRequestIds((prev) => {
          const next = new Set(prev);
          next.delete(request.id as string);
          return next;
        });
      }
      return;
    }

    if (request.paymentActionTaken) {
      showToast('Payment action already completed for this request', 'info');
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
      return;
    }

    try {
      await requestService.approveRequest(request.id as string, userRef, 'PAYMENT');
      showToast('Request approved! Moved to Vendor team.', 'success');
      setShowModal(false);
    } catch (error) {
      showToast('Failed to approve request: ' + (error as Error).message, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
    }
  };

  const handleApprove = async () => {
    if (!selectedRequest) {
      return;
    }
    await approveRequest(selectedRequest);
  };

  const rejectRequest = async (request: RequestWithId, reason: string) => {
    if (!request?.id || !userRef || !reason.trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }

    if (processingRequestIds.has(request.id)) {
      return;
    }

    setProcessingRequestIds((prev) => new Set(prev).add(request.id as string));

    const isBulk = request.isBulkRequest;

    try {
      if (isBulk) {
        await requestService.rejectBulkPayment(request.id as string, reason, userRef);
      } else {
        await requestService.rejectRequest(request.id as string, userRef, 'PAYMENT', reason);
      }
      showToast('Request rejected!', 'success');
      setShowRejectModal(false);
      setShowModal(false);
      setRejectionReason('');
    } catch (error) {
      showToast('Failed to reject request: ' + (error as Error).message, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
    }
  };

  const handleReject = async () => {
    if (rejectTarget) {
      const reason = rejectionReason.trim();
      if (!reason) {
        showToast('Rejection reason is required', 'error');
        return;
      }

      const { request, vehicleIndex } = rejectTarget;
      if (request.isBulkRequest && vehicleIndex !== null) {
        await handleBulkRowAction(request, vehicleIndex, 'REJECT', reason);
      } else {
        await executeSingleRowReject(request, reason);
      }

      setShowRejectModal(false);
      setRejectTarget(null);
      setRejectionReason('');
      return;
    }

    if (!selectedRequest) {
      return;
    }
    await rejectRequest(selectedRequest, rejectionReason);
  };

  const handleBulkRowAction = async (
    request: RequestWithId,
    vehicleIndex: number,
    action: BulkPaymentAction,
    rejectionReasonValue?: string
  ) => {
    if (!request?.id || !userRef) {
      return;
    }

    if (userRef.role !== 'PAYMENT') {
      showToast('Only PAYMENT role can perform this action.', 'error');
      return;
    }

    if (!request.isBulkRequest) {
      showToast('This action is only available for bulk requests.', 'error');
      return;
    }

    if (request.status !== REQUEST_STATUSES.FO_CREATED) {
      showToast('Bulk payment action is only allowed when status is FO_CREATED.', 'error');
      return;
    }

    if (processingRequestIds.has(request.id)) {
      return;
    }

    const actionLabel = action === 'APPROVE' ? 'approve' : 'reject';
    const reasonText = action === 'REJECT' ? (rejectionReasonValue || '').trim() : '';
    if (action === 'REJECT' && !reasonText) {
      showToast('Rejection reason is required', 'error');
      return;
    }

    const confirmed = window.confirm(
      action === 'REJECT'
        ? `Are you sure you want to reject this bulk service row?`
        : `Are you sure you want to approve this bulk service row?`
    );

    if (!confirmed) {
      return;
    }

    setProcessingRequestIds((prev) => new Set(prev).add(request.id as string));

    try {
      await requestService.updateBulkPaymentVehicles(
        request.id,
        [vehicleIndex],
        action,
        userRef,
        reasonText
      );

      showToast(
        `${action === 'APPROVE' ? 'Approved' : 'Rejected'} bulk service row successfully.`,
        'success'
      );
      setSelectedRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(`B:${request.id as string}:${vehicleIndex}`);
        return next;
      });
    } catch (error) {
      showToast(`Failed to ${actionLabel} bulk service row: ${(error as Error).message}`, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
    }
  };

  const openRowRejectModal = (request: RequestWithId, vehicleIndex: number | null) => {
    setSelectedRequest(request);
    setRejectTarget({ request, vehicleIndex });
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const executeSingleRowReject = async (request: RequestWithId, reason: string) => {
    if (!request?.id || !userRef) {
      return;
    }

    if (processingRequestIds.has(request.id)) {
      return;
    }

    if (request.status !== REQUEST_STATUSES.PARALLEL_REVIEW) {
      showToast(`Cannot reject: request is in ${request.status} status.`, 'info');
      return;
    }

    const confirmed = window.confirm('Reject this request?');
    if (!confirmed) {
      return;
    }

    setProcessingRequestIds((prev) => new Set(prev).add(request.id as string));
    try {
      await requestService.rejectRequest(request.id as string, userRef, 'PAYMENT', reason.trim());
      showToast('Request rejected!', 'success');
      setSelectedRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(`S:${request.id as string}`);
        return next;
      });
    } catch (error) {
      showToast('Failed to reject request: ' + (error as Error).message, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
    }
  };

  const handleSingleRowApprove = async (request: RequestWithId) => {
    if (!request?.id || !userRef) {
      return;
    }

    if (processingRequestIds.has(request.id)) {
      return;
    }

    if (request.status !== REQUEST_STATUSES.PARALLEL_REVIEW) {
      showToast(`Cannot approve: request is in ${request.status} status.`, 'info');
      return;
    }

    const ok = window.confirm('Approve this request?');
    if (!ok) {
      return;
    }

    setProcessingRequestIds((prev) => new Set(prev).add(request.id as string));
    try {
      await requestService.approveRequest(request.id as string, userRef, 'PAYMENT');
      showToast('Request approved! Moved to Vendor team.', 'success');
      setSelectedRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(`S:${request.id as string}`);
        return next;
      });
    } catch (error) {
      showToast('Failed to approve request: ' + (error as Error).message, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        next.delete(request.id as string);
        return next;
      });
    }
  };

  const handleApproveAllSelected = async () => {
    if (!userRef || userRef.role !== 'PAYMENT') {
      showToast('Only PAYMENT role can perform this action.', 'error');
      return;
    }

    const selectedRows = exportRows.filter((row) => selectedRowKeys.has(getRowSelectionKey(row)));
    if (selectedRows.length === 0) {
      return;
    }

    const confirmed = window.confirm(`Approve all selected rows (${selectedRows.length})?`);
    if (!confirmed) {
      return;
    }

    const bulkSelections = new Map<string, number[]>();
    const singleRequestIds = new Set<string>();
    const allProcessingIds = new Set<string>();

    selectedRows.forEach((row) => {
      const request = filteredRequests.find((item) => item.id === row.requestId);
      if (!request || !canTakeRowAction(request, row) || !request.id) {
        return;
      }

      allProcessingIds.add(request.id);
      if (row.isBulkRequest && row.vehicleIndex !== null) {
        const existing = bulkSelections.get(request.id) ?? [];
        existing.push(row.vehicleIndex);
        bulkSelections.set(request.id, existing);
      } else {
        singleRequestIds.add(request.id);
      }
    });

    if (allProcessingIds.size === 0) {
      return;
    }

    setProcessingRequestIds((prev) => {
      const next = new Set(prev);
      allProcessingIds.forEach((id) => next.add(id));
      return next;
    });

    try {
      let approvedCount = 0;
      const failedItems: string[] = [];

      for (const [requestId, indexes] of bulkSelections.entries()) {
        try {
          await requestService.updateBulkPaymentVehicles(requestId, indexes, 'APPROVE', userRef);
          approvedCount += indexes.length;
        } catch (error) {
          failedItems.push(
            `Bulk ${requestId.substring(0, 8)}... (${indexes.length} row${indexes.length > 1 ? 's' : ''}): ${(error as Error).message}`
          );
        }
      }

      for (const requestId of singleRequestIds.values()) {
        try {
          await requestService.approveRequest(requestId, userRef, 'PAYMENT');
          approvedCount += 1;
        } catch (error) {
          failedItems.push(`Single ${requestId.substring(0, 8)}...: ${(error as Error).message}`);
        }
      }

      if (approvedCount > 0) {
        showToast(`Approved ${approvedCount} selected row(s).`, 'success');
      }

      if (failedItems.length > 0) {
        const preview = failedItems.slice(0, 2).join(' | ');
        showToast(
          `Failed ${failedItems.length} selected item(s). ${preview}`,
          'error'
        );
      }

      if (failedItems.length === 0) {
        setSelectedRowKeys(new Set());
      } else {
        setSelectedRowKeys((prev) => {
          const next = new Set(prev);
          selectedRows.forEach((row) => {
            const key = getRowSelectionKey(row);
            const belongsToFailedBulk = row.isBulkRequest && row.vehicleIndex !== null && failedItems.some((item) => item.includes(`Bulk ${row.requestId.substring(0, 8)}...`));
            const belongsToFailedSingle = !row.isBulkRequest && failedItems.some((item) => item.includes(`Single ${row.requestId.substring(0, 8)}...`));
            if (!belongsToFailedBulk && !belongsToFailedSingle) {
              next.delete(key);
            }
          });
          return next;
        });
      }
    } catch (error) {
      showToast('Failed to approve selected rows: ' + (error as Error).message, 'error');
    } finally {
      setProcessingRequestIds((prev) => {
        const next = new Set(prev);
        allProcessingIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleEditAndApprove = async () => {
    if (!selectedRequest || !userRef) {
      return;
    }

    try {
      await requestService.editAndApprove(selectedRequest.id as string, editData, userRef, 'PAYMENT');
      showToast('Request updated and approved!', 'success');
      setShowEditModal(false);
      setShowModal(false);
      setEditData({});
    } catch (error) {
      showToast('Failed to update request', 'error');
    }
  };

  const downloadCsv = () => {
    const escapeCSVCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    // Sort by date descending (newest first)
    const sortedRows = [...exportRows].sort((a, b) => {
      const dateA = new Date(a.date || '').getTime();
      const dateB = new Date(b.date || '').getTime();
      return dateB - dateA; // Descending order
    });

    // Build rows with only non-empty fields
    const headers = [
      'City',
      'Client',
      'Date',
      'Service Type',
      'Service Cost',
      'Action',
      'Request ID',
      'Status',
      'Vehicle Number',
      'Vehicle Availability Location',
      'Vehicle Available Time',
      'LTPOC Name',
      'LTPOC Phone',
    ];

    const rows = sortedRows.map((row) => [
      row.city || '',
      row.client || '',
      row.date || '',
      row.serviceType || (row.isBulkRequest ? 'Per-vehicle' : ''),
      row.serviceCost ?? '',
      row.action || '',
      row.requestId || '',
      row.statusLabel || '',
      row.vehicleNumber || '',
      row.location || '',
      row.availableTime || '',
      row.ltpocName || '',
      row.ltpocPhone || '',
    ]);

    // Filter out rows where all cells are empty
    const nonEmptyRows = rows.filter((row) => row.some((cell) => cell !== ''));

    const csvContent = [
      headers.map(escapeCSVCell).join(','),
      ...nonEmptyRows.map((row) => row.map(escapeCSVCell).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const fromPart = fromDate || 'all';
    const toPart = toDate || 'all';
    link.setAttribute('href', url);
    link.setAttribute('download', `payment_filtered_${fromPart}_to_${toPart}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading || !userRef) {
    return <Loader />;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Payment Team Dashboard</h1>
        <p>Welcome, {user?.email}</p>
      </div>

      <div className="dashboard-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'end' }}>
        <div className="search-box" style={{ margin: 0 }}>
          <input
            type="text"
            placeholder="Search by ID, client, or city..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div ref={cityDropdownRef} className={`city-multi-filter ${cityDropdownOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="btn btn-secondary city-multi-trigger"
            onClick={() => setCityDropdownOpen((prev) => !prev)}
            title={cityFilter.length > 0 ? cityFilter.join(', ') : 'All Cities'}
            style={{ minWidth: 420, maxWidth: 560 }}
          >
            {cityFilterLabel}
          </button>
          {cityDropdownOpen && (
            <div className="city-multi-menu">
              <div className="city-multi-header">
                <input
                  type="text"
                  className="city-multi-search"
                  placeholder="Type city..."
                  value={citySearchTerm}
                  onChange={(event) => setCitySearchTerm(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm city-multi-done"
                  onClick={() => setCityDropdownOpen(false)}
                >
                  Done
                </button>
              </div>

              <div className="city-multi-options">
                {filteredCityOptions.map((city) => (
                  <label key={city} className="city-multi-option">
                    <input
                      type="checkbox"
                      checked={cityFilter.includes(city)}
                      onChange={() => toggleCityFilterSelection(city)}
                    />
                    <span>{city}</span>
                  </label>
                ))}

                {filteredCityOptions.length === 0 && (
                  <div className="city-multi-empty">No city found</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <label>From</label>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </div>

        <div>
          <label>To</label>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </div>

        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as PaymentActionFilter)}>
          <option value="ALL">All Actions</option>
          <option value="APPROVED">Approved</option>
          <option value="NOT_APPROVED">Not Approved</option>
        </select>

        <button className="btn btn-secondary" onClick={() => {
          setCityFilter([]);
          setCitySearchTerm('');
          setFromDate('');
          setToDate('');
          setActionFilter('ALL');
        }}>
          Clear Filters
        </button>

        <button className="btn btn-secondary" onClick={() => setShowAdditionalColumns((prev) => !prev)}>
          {showAdditionalColumns ? 'Hide Additional Columns' : 'Show Additional Columns'}
        </button>

        <button className="btn btn-primary" onClick={downloadCsv} disabled={exportRows.length === 0}>
          Download CSV
        </button>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <strong>Total Requests in History: {requests.length}</strong>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>Filtered Requests: {filteredRequests.length}</strong>
        <span style={{ margin: '0 8px' }}>•</span>
        <strong>Total Service Rows: {exportRows.length}</strong>
      </div>

      <div className="dashboard-content">
        {exportRows.length === 0 ? (
          <p className="text-muted">No records found for selected filters</p>
        ) : (
          <>
            {selectedRowKeys.size > 0 && (
              <div style={{ marginBottom: '10px' }}>
                <button className="btn btn-success" onClick={handleApproveAllSelected}>
                  Approve All ({selectedRowKeys.size})
                </button>
              </div>
            )}

            <div className="requests-table-wrapper">
              <table className="requests-table">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Client</th>
                  <th>Date</th>
                  <th>Service Type</th>
                  <th>Service Cost</th>
                  <th>Vehicle Number</th>
                  <th>Action</th>
                  {showAdditionalColumns && (
                    <>
                      <th>Request ID</th>
                      <th>Status</th>
                      <th>Location</th>
                      <th>Available Time</th>
                      <th>LTPOC Name</th>
                      <th>LTPOC Phone</th>
                    </>
                  )}
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {exportRows.map((row, index) => (
                  <tr key={`${getRowSelectionKey(row)}:${index}`}>
                    <td>{row.city ? `${row.city}${row.isBulkRequest ? ' (Bulk)' : ''}` : 'N/A'}</td>
                    <td>{row.client || 'N/A'}</td>
                    <td>{row.date || 'N/A'}</td>
                    <td>{row.serviceType || (row.isBulkRequest ? 'Per-vehicle' : 'N/A')}</td>
                    <td>
                      {row.serviceCost !== null && row.serviceCost !== undefined
                        ? `₹${row.serviceCost}`
                        : row.isBulkRequest
                          ? '₹3000'
                          : 'N/A'}
                    </td>
                    <td>{row.vehicleNumber || 'N/A'}</td>
                    <td>
                      {(() => {
                        const request = filteredRequests.find((item) => item.id === row.requestId);
                        if (!request) {
                          return <span className="text-muted">N/A</span>;
                        }

                        const isProcessing = processingRequestIds.has(request.id as string);
                        const canTakeAction = canTakeRowAction(request, row);
                        const rowKey = getRowSelectionKey(row);
                        const isRowSelected = selectedRowKeys.has(rowKey);

                        if (row.rowPaymentApproved) {
                          return <span className="status-badge status-completed">APPROVED</span>;
                        }

                        if (row.rowPaymentRejected) {
                          return <span className="status-badge status-rejected">REJECTED</span>;
                        }

                        if (canTakeAction && row.rowPaymentActionTaken === false) {
                          const canShowCheckbox = row.rowPaymentActionTaken === false;
                          return (
                            <div className="action-buttons" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {canShowCheckbox ? (
                                <input
                                  type="checkbox"
                                  checked={isRowSelected}
                                  onChange={(event) => {
                                    const checked = event.target.checked;
                                    setSelectedRowKeys((prev) => {
                                      const next = new Set(prev);
                                      if (checked) {
                                        next.add(rowKey);
                                      } else {
                                        next.delete(rowKey);
                                      }
                                      return next;
                                    });
                                  }}
                                  disabled={isProcessing}
                                />
                              ) : null}

                              <button
                                className="btn btn-sm btn-success"
                                disabled={isProcessing || userRef.role !== 'PAYMENT'}
                                onClick={async () => {
                                  if (isProcessing) {
                                    return;
                                  }

                                  if (request.isBulkRequest && row.vehicleIndex !== null) {
                                    await handleBulkRowAction(request, row.vehicleIndex, 'APPROVE');
                                    return;
                                  }

                                  await handleSingleRowApprove(request);
                                }}
                              >
                                {isProcessing ? 'Processing...' : 'Approve'}
                              </button>

                              <button
                                className="btn btn-sm btn-danger"
                                disabled={isProcessing || userRef.role !== 'PAYMENT'}
                                onClick={async () => {
                                  if (isProcessing) {
                                    return;
                                  }

                                  if (request.isBulkRequest && row.vehicleIndex !== null) {
                                    openRowRejectModal(request, row.vehicleIndex);
                                    return;
                                  }

                                  openRowRejectModal(request, null);
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          );
                        }

                        if (request.status === REQUEST_STATUSES.CANCELLED) {
                          return <span className="status-badge status-cancelled">CANCELLED</span>;
                        }

                        return <span className="text-muted">—</span>;
                      })()}
                    </td>
                    {showAdditionalColumns && (
                      <>
                        <td className="request-id-cell">{row.requestId ? `${row.requestId.substring(0, 8)}...` : 'N/A'}</td>
                        <td>{row.statusLabel}</td>
                        <td>{row.location || 'N/A'}</td>
                        <td>{row.availableTime || 'N/A'}</td>
                        <td>{row.ltpocName || 'N/A'}</td>
                        <td>{row.ltpocPhone || 'N/A'}</td>
                      </>
                    )}
                    <td>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          const req = filteredRequests.find((item) => item.id === row.requestId);
                          if (!req) {
                            return;
                          }
                          setSelectedRequest(req);
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
          </>
        )}
      </div>

      {selectedRequest && (
        <Modal
          isOpen={showModal}
          title="Request Details - Payment Verification"
          onClose={() => setShowModal(false)}
          onSubmit={() => setShowModal(false)}
          submitText="Close"
        >
          <div className="modal-details">
            <p><strong>Request ID:</strong> {selectedRequest.id}</p>
            <p><strong>Status:</strong> {getUnifiedStatusLabel(selectedRequest.status)}</p>
            <p><strong>Client:</strong> {selectedRequest.clientName}</p>
            <p><strong>City:</strong> {selectedRequest.city}{selectedRequest.isBulkRequest ? ' (Bulk)' : ''}</p>
            <p><strong>Service Type:</strong> {selectedRequest.isBulkRequest ? 'Per-vehicle' : selectedRequest.serviceType || 'N/A'}</p>
            {(() => {
              const selectedVehicles = normalizeVehicles(selectedRequest.vehicles);
              return <p><strong>Vehicles:</strong> {selectedVehicles.length || 0}</p>;
            })()}

            {selectedRequest.isBulkRequest && normalizeVehicles(selectedRequest.vehicles).length > 0 && (
              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                <h4 style={{ marginTop: '0' }}>Per-Vehicle Details</h4>
                {(() => {
                  const selectedVehicles = normalizeVehicles(selectedRequest.vehicles);
                  const ltpocByVehicle = new Map(
                    ((selectedRequest.ltpocDetails ?? []) as Array<Record<string, unknown>>).map((item) => [
                      String(item.vehicleNumber ?? ''),
                      item,
                    ])
                  );

                  return selectedVehicles.map((vehicle: any, idx: number) => {
                    const matchedLtpoc = ltpocByVehicle.get(String(vehicle?.vehicleNumber ?? '')) as Record<string, unknown> | undefined;
                    const isPaymentRejected = toBooleanFlag(vehicle?.paymentRejected) || Boolean(vehicle?.paymentRejectedAt);
                    const paymentRejectionReason = getPaymentRejectionReason(vehicle as Record<string, unknown>, selectedRequest);
                    return (
                  <div key={idx} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < selectedVehicles.length - 1 ? '1px solid #ddd' : 'none' }}>
                    <p><strong>Vehicle Number:</strong> {vehicle.vehicleNumber || 'N/A'}</p>
                    {vehicle.serviceType && <p><strong>Service Type:</strong> {vehicle.serviceType}</p>}
                    <p><strong>Service Cost:</strong> {getVehicleServiceCost(vehicle.serviceType, selectedRequest.serviceCost) ? `₹${getVehicleServiceCost(vehicle.serviceType, selectedRequest.serviceCost)}` : 'N/A'}</p>
                    {vehicle.vehicleAvailabilityLocation && <p><strong>Location:</strong> {vehicle.vehicleAvailabilityLocation}</p>}
                    {vehicle.vehicleAvailableTime && <p><strong>Available Time:</strong> {vehicle.vehicleAvailableTime}</p>}
                    {(vehicle.ltpocName || matchedLtpoc?.ltpocName) && <p><strong>LTPOC Name:</strong> {vehicle.ltpocName || matchedLtpoc?.ltpocName}</p>}
                    {(vehicle.ltpocPhone || matchedLtpoc?.ltpocPhone) && <p><strong>LTPOC Phone:</strong> {vehicle.ltpocPhone || matchedLtpoc?.ltpocPhone}</p>}
                    <p>
                      <strong>Payment State:</strong>{' '}
                      {toBooleanFlag(vehicle?.paymentApproved) || Boolean(vehicle?.paymentApprovedAt)
                        ? 'Approved'
                        : isPaymentRejected
                          ? 'Rejected'
                          : 'Pending'}
                    </p>
                    {isPaymentRejected && paymentRejectionReason && (
                      <p>
                        <strong>Rejection Reason:</strong>{' '}
                        <span className="rejection-reason-highlight">{paymentRejectionReason}</span>
                      </p>
                    )}
                  </div>
                    );
                  });
                })()}
              </div>
            )}

            <AuditLog history={selectedRequest.history} legacyLogs={selectedRequest.auditLog} />

            {!selectedRequest.paymentApproval &&
              !selectedRequest.paymentActionTaken &&
              selectedRequest.status === REQUEST_STATUSES.PARALLEL_REVIEW && (
              <div className="action-buttons">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowEditModal(true)}
                >
                  Edit & Approve
                </button>
              </div>
            )}

            {selectedRequest.paymentActionTaken && (
              <div className="info-box" style={{ marginTop: '1rem', padding: '12px', background: '#e7f1ff', borderRadius: '4px' }}>
                <p style={{ margin: 0, color: '#0c5460' }}>✓ Payment Action Completed</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal
          isOpen={showEditModal}
          title="Edit Request"
          onClose={() => setShowEditModal(false)}
          onSubmit={handleEditAndApprove}
          submitText="Save & Approve"
        >
          <div className="edit-form">
            <div className="form-group">
              <label>Client Name</label>
              <input
                type="text"
                value={(editData.clientName as string) || selectedRequest.clientName || ''}
                onChange={(event) =>
                  setEditData({ ...editData, clientName: event.target.value })
                }
              />
            </div>
            <div className="form-group">
              <label>City</label>
              <input
                type="text"
                value={(editData.city as string) || selectedRequest.city || ''}
                onChange={(event) => setEditData({ ...editData, city: event.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal
          isOpen={showRejectModal}
          title="Reject Request"
          onClose={() => {
            setShowRejectModal(false);
            setRejectTarget(null);
            setRejectionReason('');
          }}
          onSubmit={handleReject}
          submitText="Reject"
        >
          <div className="form-group">
            <label>Rejection Reason</label>
            <textarea
              rows={4}
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Provide a reason for rejection"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
