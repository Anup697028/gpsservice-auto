import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import {
  canFoCancelRequest,
  formatRequestIdDisplay,
  getRequestStatusLabel,
  resolveLtpocForRequestVehicle,
  getServiceLabel,
  getVehicleCount,
  isVehicleDropped,
  normalizeRole,
  normalizeVehicles,
  requestMatchesSearch,
  sortRequestsNewestFirst,
  toDateInputValue,
  toDisplayDate,
  toDisplayDateTime,
  type RequestWithId,
} from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  userProfile: { id?: string | null; name?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

const SERVICE_COST_MAP: Record<string, number> = {
  fleetx: 3000,
  wheelseye: 2000,
};

const normalizeServiceToken = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');

const getServiceCostForType = (serviceType: unknown) => SERVICE_COST_MAP[normalizeServiceToken(serviceType)] || 0;

const getRequestCost = (request: RequestWithId) => {
  const directCost = Number((request as Record<string, unknown>)?.serviceCost || 0);

  if (!request?.isBulkRequest) {
    if (directCost > 0) {
      return directCost;
    }
    return getServiceCostForType((request as Record<string, unknown>)?.serviceType);
  }

  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  if (vehicles.length === 0) {
    return directCost > 0 ? directCost : 0;
  }

  return vehicles.reduce((sum, vehicle) => sum + getServiceCostForType(vehicle?.serviceType), 0);
};

const formatCost = (cost: number) => {
  if (!Number.isFinite(cost) || cost <= 0) {
    return 'N/A';
  }
  return `INR ${cost.toLocaleString('en-IN')}`;
};

const getRefundableLabel = (request: RequestWithId) => {
  if (!request?.isBulkRequest) {
    if (request?.isRefundable === true) {
      return 'YES';
    }
    if (request?.isRefundable === false) {
      return 'NO';
    }

    const token = normalizeServiceToken((request as Record<string, unknown>)?.serviceType);
    if (token === 'fleetx') {
      return 'YES';
    }
    if (token === 'wheelseye') {
      return 'NO';
    }
    return 'N/A';
  }

  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  if (vehicles.length === 0) {
    return 'N/A';
  }

  const flags = new Set(
    vehicles.map((vehicle) => {
      const token = normalizeServiceToken(vehicle?.serviceType);
      if (token === 'fleetx') {
        return 'YES';
      }
      if (token === 'wheelseye') {
        return 'NO';
      }
      return 'N/A';
    })
  );

  if (flags.size === 1) {
    return [...flags][0];
  }

  return 'MIXED';
};

const getAssignedRhDisplay = (request: RequestWithId) => {
  const email = String((request as Record<string, unknown>)?.assignedRhEmail || '')
    .trim()
    .toLowerCase();
  if (!email) {
    return { initials: 'NA', label: 'Unassigned', assigned: false };
  }

  const localPart = email.split('@')[0] || email;
  const words = localPart.split(/[._-]+/).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || 'RH';
  const label = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

  return { initials, label: label || email, assigned: true };
};

const formatRequestId = (requestId: string | undefined) => {
  return formatRequestIdDisplay(requestId);
};

const getNewTableStatusClass = (label: string) => {
  const normalized = label.toLowerCase();

  if (normalized.includes('parallel')) {
    return 'bg-blue-100 text-blue-700';
  }
  if (normalized.includes('fo created') || normalized.includes('payment')) {
    return 'bg-orange-100 text-orange-700';
  }
  if (normalized.includes('vendor')) {
    return 'bg-amber-100 text-amber-700';
  }
  if (normalized.includes('completed') || normalized.includes('fo notified')) {
    return 'bg-green-100 text-green-700';
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('halt')) {
    return 'bg-red-100 text-red-700';
  }

  return 'bg-slate-100 text-slate-700';
};

const getHistoryTableStatusClass = (label: string) => {
  const normalized = label.toLowerCase();

  if (normalized.includes('completed') || normalized.includes('fo notified')) {
    return 'bg-green-100 text-green-700';
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('halt')) {
    return 'bg-red-100 text-red-700';
  }
  if (normalized.includes('pending') || normalized.includes('parallel')) {
    return 'bg-blue-100 text-blue-700';
  }

  return 'bg-slate-100 text-slate-700';
};

const REQUEST_LEVEL_DROP_ACTIONS = new Set([
  'CANCEL',
  'RH_REJECT',
  'PAYMENT_REJECT',
  'RH_BULK_REJECT',
  'PAYMENT_BULK_REJECT',
]);

const hasRequestLevelDropAction = (request: RequestWithId) => {
  const history = Array.isArray((request as Record<string, unknown>)?.history)
    ? ((request as Record<string, unknown>).history as Array<Record<string, unknown>>)
    : [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const action = String(history[index]?.action || '').trim().toUpperCase();
    if (REQUEST_LEVEL_DROP_ACTIONS.has(action)) {
      return true;
    }
  }

  return false;
};

const isCancelledOrRejectedRequest = (request: RequestWithId) => {
  const normalized = getRequestStatusLabel(request).toLowerCase();
  const hasCancelledState = normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('halt');

  if (!hasCancelledState) {
    return false;
  }

  if (!request?.isBulkRequest) {
    return true;
  }

  if (normalized.includes('cancel')) {
    return true;
  }

  if (hasRequestLevelDropAction(request)) {
    return true;
  }

  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  if (vehicles.length === 0) {
    return true;
  }

  const droppedCount = vehicles.filter((vehicle) => isVehicleDropped(vehicle)).length;
  return droppedCount >= vehicles.length;
};

const toCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const exportFoHistoryCsv = (rows: RequestWithId[]) => {
  if (typeof window === 'undefined' || !Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const headers = [
    'Request ID',
    'Client',
    'City',
    'Service Type',
    'Vehicle Number',
    'Vehicle Location',
    'Vehicle Time',
    'LTPOC Name',
    'LTPOC Phone',
    'Cost',
    'Refundable',
    'Qty',
    'Final Status',
    'Created At',
    'Updated At',
  ];

  const csvRows = rows.flatMap((request) => {
    const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);

    const base = [
      formatRequestId(request.id),
      request.clientName || 'N/A',
      request.city || 'N/A',
      getServiceLabel(request),
    ];

    if (vehicles.length === 0) {
      return [[
        ...base,
        'N/A',
        String((request as Record<string, unknown>)?.vehicleAvailabilityLocation || ''),
        String((request as Record<string, unknown>)?.vehicleAvailableTime || ''),
        '',
        '',
        formatCost(getRequestCost(request)),
        getRefundableLabel(request),
        getVehicleCount(request),
        getRequestStatusLabel(request),
        toDisplayDate((request as Record<string, unknown>)?.createdAt),
        toDisplayDate((request as Record<string, unknown>)?.updatedAt),
      ]];
    }

    return vehicles.map((vehicle, index) => {
      const vehicleNumber = String(vehicle?.vehicleNumber || 'N/A');
      const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(request, vehicle, index, {
        warnOnMissing: true,
        context: 'FoHistoryCsv',
      });

      return [
        ...base,
        vehicleNumber,
        String(vehicle?.vehicleAvailabilityLocation || (request as Record<string, unknown>)?.vehicleAvailabilityLocation || ''),
        String(vehicle?.vehicleAvailableTime || (request as Record<string, unknown>)?.vehicleAvailableTime || ''),
        String(ltpocName || ''),
        String(ltpocPhone || ''),
        formatCost(getRequestCost(request)),
        getRefundableLabel(request),
        getVehicleCount(request),
        getRequestStatusLabel(request),
        toDisplayDate((request as Record<string, unknown>)?.createdAt),
        toDisplayDate((request as Record<string, unknown>)?.updatedAt),
      ];
    });
  });

  const csvContent = [
    headers.map(toCsvCell).join(','),
    ...csvRows.map((row) => row.map(toCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `fo_history_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
};

const FoHistory: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const profileUserId = String(userProfile?.id || '').trim();
  const stableUserId = profileUserId || String(user?.uid || '').trim();

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [viewRequest, setViewRequest] = useState<RequestWithId | null>(null);

  const [cancelRequestTarget, setCancelRequestTarget] = useState<RequestWithId | null>(null);
  const [cancelMode, setCancelMode] = useState<'all' | 'single'>('all');
  const [selectedVehicleNumber, setSelectedVehicleNumber] = useState('');
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const userRef = useMemo<UserRef | null>(() => {
    if (!user) {
      return null;
    }
    return {
      id: stableUserId,
      email: user.email ?? null,
      name: userProfile?.name ?? null,
      role: 'FO',
    };
  }, [user, stableUserId, userProfile?.name]);

  const isFoRole = normalizeRole(userRole) === 'FO';

  useEffect(() => {
    if (!stableUserId || !isFoRole) {
      setTableLoading(false);
      return () => {};
    }

    const unsubscribe = requestService.subscribeToFoRequests(
      stableUserId,
      user?.email,
      (data) => {
        setRequests(sortRequestsNewestFirst(data as RequestWithId[]));
        setTableLoading(false);
      },
      (error) => {
        showToast(error.message || 'Unable to load FO requests.', 'error');
        setTableLoading(false);
      }
    );

    return unsubscribe;
  }, [stableUserId, user?.email, isFoRole]);

  const visibleRequests = useMemo(
    () => requests.filter((request) => requestMatchesSearch(request, searchTerm)),
    [requests, searchTerm]
  );

  const newRequests = useMemo(() => visibleRequests.filter((request) => canFoCancelRequest(request)), [visibleRequests]);
  const historyRequests = useMemo(
    () => visibleRequests
      .filter((request) => !canFoCancelRequest(request))
      .filter((request) => !isCancelledOrRejectedRequest(request)),
    [visibleRequests]
  );

  const filteredHistoryRequests = useMemo(
    () =>
      historyRequests.filter((request) => {
        const rowDate = toDateInputValue((request as Record<string, unknown>)?.updatedAt || (request as Record<string, unknown>)?.createdAt);
        if (!rowDate) {
          return false;
        }

        if (historyDateFrom && rowDate < historyDateFrom) {
          return false;
        }
        if (historyDateTo && rowDate > historyDateTo) {
          return false;
        }

        return true;
      }),
    [historyRequests, historyDateFrom, historyDateTo]
  );

  const handleExportHistoryCsv = () => {
    const exported = exportFoHistoryCsv(filteredHistoryRequests);
    if (!exported) {
      showToast('No history records available for CSV export.', 'info');
      return;
    }

    showToast('History CSV exported successfully.', 'success');
  };

  const cancelVehicles = useMemo(
    () => (cancelRequestTarget ? normalizeVehicles((cancelRequestTarget as Record<string, unknown>)?.vehicles) : []),
    [cancelRequestTarget]
  );

  const canCancelSingleVehicle = Boolean(cancelRequestTarget?.isBulkRequest && cancelVehicles.length > 1);

  const disableConfirmCancel =
    cancelling ||
    !cancelConfirmed ||
    (cancelMode === 'single' && canCancelSingleVehicle && !selectedVehicleNumber);

  const closeCancelModal = () => {
    setCancelRequestTarget(null);
    setCancelMode('all');
    setSelectedVehicleNumber('');
    setCancelConfirmed(false);
  };

  const openCancelModal = (request: RequestWithId) => {
    setViewRequest(null);
    setCancelRequestTarget(request);
    setCancelMode('all');
    setSelectedVehicleNumber('');
    setCancelConfirmed(false);
  };

  const handleCancelRequest = async () => {
    if (!cancelRequestTarget?.id || !userRef) {
      return;
    }

    if (!cancelConfirmed) {
      showToast('Please confirm cancellation to proceed.', 'error');
      return;
    }

    setCancelling(true);
    const activeRequestId = cancelRequestTarget.id;
    try {
      if (cancelMode === 'single') {
        if (!canCancelSingleVehicle) {
          throw new Error('Single vehicle removal is not available for this request.');
        }

        if (!selectedVehicleNumber) {
          showToast('Please select a vehicle to remove from this request.', 'error');
          return;
        }

  await requestService.removeBulkVehicle(activeRequestId, selectedVehicleNumber, userRef);
  showToast(`Vehicle ${selectedVehicleNumber} removed from ${formatRequestId(activeRequestId)}.`, 'success');
        closeCancelModal();
        return;
      }

  await requestService.cancelRequest(activeRequestId, userRef);
  showToast(`Request ${formatRequestId(activeRequestId)} cancelled successfully.`, 'success');
      closeCancelModal();
    } catch (error) {
      showToast((error as Error).message || 'Failed to cancel request.', 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading || tableLoading || !userRef || !isFoRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="FO"
      activePage="history"
      title="History"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-8 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[#f26a21]">FO History &amp; Requests</h1>
              <p className="text-slate-500">Monitor field operations, manage service requests, and track installation timelines.</p>
            </div>
            <div className="relative w-full sm:w-auto">
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs focus:ring-1 focus:ring-primary sm:w-72"
                placeholder="Quick search ID or Client..."
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mb-6 flex border-b border-slate-200">
          <button className="border-b-2 border-primary px-6 py-3 text-sm font-semibold text-primary" type="button">
            New Requests ({newRequests.length})
          </button>
          <button className="border-b-2 border-transparent px-6 py-3 text-sm font-medium text-slate-500" type="button">
            Request History
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                placeholder="Date Range"
                type="text"
                readOnly
              />
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" defaultValue="All Statuses">
                <option>All Statuses</option>
              </select>
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" defaultValue="All Cities">
                <option>All Cities</option>
              </select>
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" defaultValue="Assigned RH">
                <option>Assigned RH</option>
              </select>
            </div>
            <button
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-all hover:bg-primary/90"
              style={{ backgroundColor: '#f26a21', borderColor: '#f26a21' }}
              type="button"
            >
              Apply Filters
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Request ID</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Client</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">City</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Assigned RH</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Service Type</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Cost</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Ref.</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Qty</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Created At</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-primary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {newRequests.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                      No new requests found.
                    </td>
                  </tr>
                ) : (
                  newRequests.map((request, index) => {
                    const statusLabel = getRequestStatusLabel(request);
                    const assignedRh = getAssignedRhDisplay(request);

                    return (
                      <tr key={request.id || `new-${index}`} className="transition-colors hover:bg-slate-50">
                        <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{formatRequestId(request.id)}</td>
                        <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{request.clientName || 'N/A'}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{request.city || 'N/A'}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                          {assignedRh.assigned ? (
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold">
                                {assignedRh.initials}
                              </div>
                              <span className="text-xs">{assignedRh.label}</span>
                            </div>
                          ) : (
                            <span className="text-xs italic text-slate-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getServiceLabel(request)}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{formatCost(getRequestCost(request))}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getRefundableLabel(request)}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getVehicleCount(request)}</td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                          <span
                            className={`rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-tight ${getNewTableStatusClass(
                              statusLabel
                            )}`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                          {toDisplayDateTime((request as Record<string, unknown>)?.createdAt)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              className="rounded border border-primary px-3 py-1 text-[9px] font-semibold text-primary transition-all hover:bg-primary/5"
                              type="button"
                              onClick={() => setViewRequest(request)}
                            >
                              VIEW
                            </button>
                            <button
                              className="rounded border border-primary bg-primary px-3 py-1 text-[9px] font-semibold text-white transition-all hover:bg-primary/90"
                              type="button"
                              onClick={() => openCancelModal(request)}
                            >
                              CANCEL
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">Showing {newRequests.length} new request(s)</p>
            <div className="flex gap-1">
              <button className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold" disabled type="button">
                Prev
              </button>
              <button
                className="rounded border border-primary bg-primary px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: '#f26a21', borderColor: '#f26a21' }}
                type="button"
              >
                1
              </button>
              <button className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold" type="button">
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[#f26a21]">Request History</h2>
            <div className="flex flex-wrap items-end justify-end gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">From Date</label>
                <input
                  type="date"
                  value={historyDateFrom}
                  onChange={(event) => setHistoryDateFrom(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">To Date</label>
                <input
                  type="date"
                  value={historyDateTo}
                  onChange={(event) => setHistoryDateTo(event.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                className="flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-50"
                type="button"
                onClick={handleExportHistoryCsv}
                disabled={filteredHistoryRequests.length === 0}
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Request ID</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Client</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">City</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Service Type</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Cost</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Ref.</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Qty</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Final Status</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Created At</th>
                    <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Updated At</th>
                    <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredHistoryRequests.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                        No history records found.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryRequests.map((request, index) => {
                      const statusLabel = getRequestStatusLabel(request);

                      return (
                        <tr key={request.id || `history-${index}`} className="transition-colors hover:bg-slate-50">
                          <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{formatRequestId(request.id)}</td>
                          <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{request.clientName || 'N/A'}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{request.city || 'N/A'}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getServiceLabel(request)}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{formatCost(getRequestCost(request))}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getRefundableLabel(request)}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{getVehicleCount(request)}</td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                            <span
                              className={`rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-tight ${getHistoryTableStatusClass(
                                statusLabel
                              )}`}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                            {toDisplayDate((request as Record<string, unknown>)?.createdAt)}
                          </td>
                          <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                            {toDisplayDate((request as Record<string, unknown>)?.updatedAt)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex justify-end">
                              <button
                                className="rounded border border-primary px-3 py-1 text-[9px] font-semibold text-primary transition-all hover:bg-primary/5"
                                type="button"
                                onClick={() => setViewRequest(request)}
                              >
                                VIEW
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {viewRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
              <h3 className="text-lg font-bold text-[#f26a21]">Request Details</h3>
              <button
                className="text-slate-400 transition-colors hover:text-slate-700"
                onClick={() => setViewRequest(null)}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="grid gap-3 p-5 text-sm text-[#12212a]">
              <div>
                <strong>Request ID:</strong> {formatRequestId(viewRequest.id)}
              </div>
              <div>
                <strong>Status:</strong> {getRequestStatusLabel(viewRequest)}
              </div>
              <div>
                <strong>Client:</strong> {viewRequest.clientName || 'N/A'}
              </div>
              <div>
                <strong>City:</strong> {viewRequest.city || 'N/A'}
              </div>
              <div>
                <strong>Service:</strong> {getServiceLabel(viewRequest)}
              </div>
              <div>
                <strong>Vehicles:</strong> {getVehicleCount(viewRequest)}
              </div>
              <div>
                <strong>Created:</strong> {toDisplayDateTime((viewRequest as Record<string, unknown>)?.createdAt)}
              </div>

              <div className="mt-2">
                <strong>Vehicle Details:</strong>
                <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-700 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Vehicle</th>
                        <th className="px-3 py-2 text-left">Service</th>
                        <th className="px-3 py-2 text-left">Location</th>
                        <th className="px-3 py-2 text-left">LTPOC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const vehicles = normalizeVehicles((viewRequest as Record<string, unknown>)?.vehicles);

                        if (vehicles.length === 0) {
                          return (
                            <tr>
                              <td className="px-3 py-3 text-slate-500" colSpan={4}>No vehicle rows available.</td>
                            </tr>
                          );
                        }

                        return vehicles.map((vehicle, index) => {
                          const vehicleNumber = String(vehicle?.vehicleNumber || 'N/A');
                          const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(viewRequest, vehicle, index, {
                            warnOnMissing: true,
                            context: 'FoHistoryDetailModal',
                          });

                          return (
                            <tr key={`${vehicleNumber}-${index}`}>
                              <td className="px-3 py-2">{vehicleNumber}</td>
                              <td className="px-3 py-2">{String(vehicle?.serviceType || 'N/A')}</td>
                              <td className="px-3 py-2">{String(vehicle?.vehicleAvailabilityLocation || 'N/A')}</td>
                              <td className="px-3 py-2">{ltpocName || 'N/A'}{ltpocPhone ? ` (${ltpocPhone})` : ''}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {cancelRequestTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" id="cancel-modal">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
              <h3 className="text-lg font-bold uppercase tracking-tight text-[#f26a21]">Cancel Request</h3>
              <button
                className="cursor-pointer text-slate-400 transition-colors hover:text-red-500"
                onClick={closeCancelModal}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 grid grid-cols-2 gap-4 border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Request ID</p>
                  <p className="font-bold">{formatRequestId(cancelRequestTarget.id)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Client</p>
                  <p className="font-bold">{cancelRequestTarget.clientName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Status</p>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${getNewTableStatusClass(getRequestStatusLabel(cancelRequestTarget))}`}>
                    {getRequestStatusLabel(cancelRequestTarget)}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Vehicles</p>
                  <p className="font-bold">{getVehicleCount(cancelRequestTarget)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Service</p>
                  <p className="font-bold">{getServiceLabel(cancelRequestTarget)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Total Cost</p>
                  <p className="font-bold">{formatCost(getRequestCost(cancelRequestTarget))}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Refundable</p>
                  <p className="font-bold text-green-600">{getRefundableLabel(cancelRequestTarget)}</p>
                </div>
              </div>

              <div className="mb-6 space-y-4">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    cancelMode === 'all' ? 'border-primary bg-primary/5' : 'border-slate-300'
                  }`}
                >
                  <input
                    checked={cancelMode === 'all'}
                    className="mt-1"
                    name="cancel_type"
                    onChange={() => setCancelMode('all')}
                    type="radio"
                  />
                  <div>
                    <p className="font-bold">Cancel entire request</p>
                    <p className="text-xs text-slate-600">
                      All {getVehicleCount(cancelRequestTarget)} vehicles in this request will be cancelled.
                    </p>
                  </div>
                </label>

                {canCancelSingleVehicle ? (
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                      cancelMode === 'single' ? 'border-primary bg-primary/5' : 'border-slate-300'
                    }`}
                  >
                    <input
                      checked={cancelMode === 'single'}
                      className="mt-1"
                      name="cancel_type"
                      onChange={() => setCancelMode('single')}
                      type="radio"
                    />
                    <div>
                      <p className="font-bold">Cancel one vehicle from bulk</p>
                      <p className="text-xs text-slate-600">Select a specific vehicle to remove from this request.</p>
                    </div>
                  </label>
                ) : null}
              </div>

              {canCancelSingleVehicle ? (
                <div className="mb-6 max-h-48 overflow-y-auto border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 border-b bg-slate-100 font-bold">
                      <tr>
                        <th className="px-3 py-2">Vehicle #</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Service</th>
                        <th className="px-3 py-2">Cost</th>
                        <th className="px-3 py-2 text-right">Select</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {cancelVehicles.map((vehicle, index) => {
                        const vehicleNumber = String(vehicle?.vehicleNumber || `Vehicle ${index + 1}`);
                        const vehicleType = String(vehicle?.vehicleType || vehicle?.type || 'N/A');
                        const serviceType = String(vehicle?.serviceType || 'N/A');
                        const cost = formatCost(getServiceCostForType(serviceType));

                        return (
                          <tr className="hover:bg-slate-50" key={`${vehicleNumber}-${index}`}>
                            <td className="px-3 py-2">{vehicleNumber}</td>
                            <td className="px-3 py-2">{vehicleType}</td>
                            <td className="px-3 py-2">{serviceType}</td>
                            <td className="px-3 py-2">{cost}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                checked={selectedVehicleNumber === vehicleNumber}
                                disabled={cancelMode !== 'single'}
                                name="single_v"
                                onChange={() => setSelectedVehicleNumber(vehicleNumber)}
                                type="radio"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="space-y-4 border-t border-slate-200 pt-4">
                <label className="flex items-center gap-3">
                  <input
                    checked={cancelConfirmed}
                    className="rounded border-slate-300"
                    onChange={(event) => setCancelConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="text-sm font-medium">
                    I understand that this action is permanent and may incur processing fees.
                  </span>
                </label>
                <div className="flex gap-3">
                  <button
                    className="flex-1 rounded-lg border-2 border-primary bg-white py-2.5 text-sm font-bold uppercase text-primary transition-colors hover:bg-orange-50"
                    onClick={closeCancelModal}
                    type="button"
                  >
                    Keep Request
                  </button>
                  <button
                    className="flex-1 rounded-lg border-2 border-primary bg-primary py-2.5 text-sm font-bold uppercase text-white transition-colors disabled:opacity-50"
                    disabled={disableConfirmCancel}
                    onClick={handleCancelRequest}
                    type="button"
                  >
                    {cancelling ? 'Processing...' : 'Confirm Cancellation'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </RolePageLayout>
  );
};

export default FoHistory;
