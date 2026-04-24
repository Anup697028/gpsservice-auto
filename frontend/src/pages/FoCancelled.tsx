import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import {
  formatRequestIdDisplay,
  getRequestStatusLabel,
  getServiceLabel,
  getVehicleCount,
  isVehicleDropped,
  normalizeRole,
  resolveLtpocForRequestVehicle,
  normalizeServiceType,
  normalizeStatusValue,
  normalizeVehicles,
  requestMatchesSearch,
  sortRequestsNewestFirst,
  toDateValue,
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

type HistoryRecord = Record<string, unknown>;

type CancelledRow = {
  key: string;
  requestId: string;
  scope: 'REQUEST' | 'VEHICLE';
  clientName: string;
  city: string;
  serviceType: string;
  vehicleNumber: string;
  ltpocName: string;
  ltpocPhone: string;
  statusLabel: string;
  cancelledBy: string;
  reason: string;
  cancelledAt: unknown;
};

const REQUEST_LEVEL_CANCEL_ACTIONS = new Set([
  'CANCEL',
  'RH_REJECT',
  'PAYMENT_REJECT',
  'RH_BULK_REJECT',
  'PAYMENT_BULK_REJECT',
]);

const formatRequestId = (requestId: string | undefined) => {
  return formatRequestIdDisplay(requestId);
};

const toHistory = (request: RequestWithId): HistoryRecord[] => {
  const value = (request as Record<string, unknown>)?.history;
  return Array.isArray(value) ? (value as HistoryRecord[]) : [];
};

const extractReasonFromNotes = (notes: unknown) => {
  const normalized = String(notes || '').trim();
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/Reason:\s*(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return normalized;
};

const getRoleLabel = (role: unknown) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'FO') {
    return 'FO';
  }
  if (normalizedRole === 'RH') {
    return 'RH';
  }
  if (normalizedRole === 'PAYMENT') {
    return 'PAYMENT';
  }
  if (normalizedRole === 'VENDOR') {
    return 'VENDOR';
  }
  return normalizedRole || 'SYSTEM';
};

const getActorLabel = (entry: HistoryRecord | null) => {
  if (!entry) {
    return 'SYSTEM';
  }

  const roleLabel = getRoleLabel(entry.role);
  const userName = String(entry.userName || '').trim();
  if (!userName) {
    return roleLabel;
  }

  return `${roleLabel} (${userName})`;
};

const getLatestRequestCancelEntry = (request: RequestWithId) => {
  const history = toHistory(request);

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const action = normalizeStatusValue(entry?.action);
    if (REQUEST_LEVEL_CANCEL_ACTIONS.has(action)) {
      return entry;
    }
  }

  return null;
};

const parseRemovedVehicleNumber = (notes: unknown) => {
  const text = String(notes || '').trim();
  if (!text) {
    return '';
  }

  const match = text.match(/removed vehicle\s+(.+?)\s+from\s+bulk/i);
  return match?.[1]?.trim() || '';
};

const isRequestCancelledOrRejected = (request: RequestWithId) => {
  const statusLabel = getRequestStatusLabel(request).toLowerCase();
  const hasCancelledState = statusLabel.includes('cancel') || statusLabel.includes('reject') || statusLabel.includes('halt');

  if (!hasCancelledState) {
    return false;
  }

  if (!request?.isBulkRequest) {
    return true;
  }

  if (statusLabel.includes('cancel')) {
    return true;
  }

  const latestCancelEntry = getLatestRequestCancelEntry(request);
  const latestAction = normalizeStatusValue(latestCancelEntry?.action);
  if (REQUEST_LEVEL_CANCEL_ACTIONS.has(latestAction)) {
    return true;
  }

  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  if (vehicles.length === 0) {
    return true;
  }

  const droppedCount = vehicles.filter((vehicle) => isVehicleDropped(vehicle)).length;
  return droppedCount >= vehicles.length;
};

const toMillis = (value: unknown) => {
  const date = toDateValue(value);
  return date ? date.getTime() : 0;
};

const getStatusPillClass = (label: string) => {
  const normalized = label.toLowerCase();
  if (normalized.includes('cancel') || normalized.includes('reject')) {
    return 'bg-red-100 text-red-700';
  }
  return 'bg-slate-100 text-slate-700';
};

const getScopePillClass = (scope: CancelledRow['scope']) =>
  scope === 'REQUEST'
    ? 'bg-orange-100 text-orange-700'
    : 'bg-amber-100 text-amber-700';

const toCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const exportFoCancelledCsv = (rows: CancelledRow[]) => {
  if (typeof window === 'undefined' || !Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const headers = [
    'Request ID',
    'Scope',
    'Client',
    'City',
    'Service Type',
    'Vehicle',
    'LTPOC Name',
    'LTPOC Phone',
    'Status',
    'Cancelled By',
    'Reason',
    'Cancelled At',
  ];

  const csvRows = rows.map((row) => [
    row.requestId,
    row.scope,
    row.clientName,
    row.city,
    row.serviceType,
    row.vehicleNumber,
    row.ltpocName,
    row.ltpocPhone,
    row.statusLabel,
    row.cancelledBy,
    row.reason,
    toDisplayDateTime(row.cancelledAt),
  ]);

  const csvContent = [
    headers.map(toCsvCell).join(','),
    ...csvRows.map((row) => row.map(toCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `fo_cancelled_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
};

const FoCancelled: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const profileUserId = String(userProfile?.id || '').trim();
  const stableUserId = profileUserId || String(user?.uid || '').trim();

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

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
        showToast(error.message || 'Unable to load cancelled requests.', 'error');
        setTableLoading(false);
      }
    );

    return unsubscribe;
  }, [stableUserId, user?.email, isFoRole]);

  const visibleRequests = useMemo(
    () => requests.filter((request) => requestMatchesSearch(request, searchTerm)),
    [requests, searchTerm]
  );

  const cancelledRows = useMemo(() => {
    const rows: CancelledRow[] = [];
    const seenKeys = new Set<string>();

    const pushRow = (row: CancelledRow) => {
      if (seenKeys.has(row.key)) {
        return;
      }
      seenKeys.add(row.key);
      rows.push(row);
    };

    visibleRequests.forEach((request) => {
      const requestId = String(request.id || '').trim();
      if (!requestId) {
        return;
      }

      const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
      const requestLevelLtpoc = resolveLtpocForRequestVehicle(request, vehicles[0] || null, 0, {
        warnOnMissing: true,
        context: 'FoCancelledRequestRow',
      });

      const latestCancelEntry = getLatestRequestCancelEntry(request);
      const statusLabel = getRequestStatusLabel(request);

      if (isRequestCancelledOrRejected(request)) {
        const requestReason =
          String((request as Record<string, unknown>)?.rejectionReason || '').trim() ||
          extractReasonFromNotes(latestCancelEntry?.notes) ||
          'Request dropped from workflow';

        pushRow({
          key: `request:${requestId}`,
          requestId,
          scope: 'REQUEST',
          clientName: String(request.clientName || 'N/A'),
          city: String(request.city || 'N/A'),
          serviceType: getServiceLabel(request),
          vehicleNumber: `All (${getVehicleCount(request)})`,
          ltpocName: requestLevelLtpoc.ltpocName,
          ltpocPhone: requestLevelLtpoc.ltpocPhone,
          statusLabel,
          cancelledBy: getActorLabel(latestCancelEntry),
          reason: requestReason,
          cancelledAt:
            latestCancelEntry?.timestamp ||
            (request as Record<string, unknown>)?.updatedAt ||
            (request as Record<string, unknown>)?.createdAt ||
            null,
        });
      }

      vehicles.forEach((vehicle, index) => {
        if (!isVehicleDropped(vehicle)) {
          return;
        }

        const vehicleNumber = String(vehicle?.vehicleNumber || `Vehicle ${index + 1}`);
        const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(request, vehicle, index, {
          warnOnMissing: true,
          context: 'FoCancelledVehicleRow',
        });
        const cancellationReason =
          String(vehicle?.paymentRejectionReason || vehicle?.rejectionReason || '').trim() ||
          String((request as Record<string, unknown>)?.rejectionReason || '').trim() ||
          extractReasonFromNotes(latestCancelEntry?.notes) ||
          'Vehicle dropped from workflow';

        let cancelledBy = getActorLabel(latestCancelEntry);
        if (vehicle?.paymentRejected === true) {
          cancelledBy = 'PAYMENT';
        } else if (vehicle?.rhRejected === true) {
          cancelledBy = 'RH';
        }

        pushRow({
          key: `vehicle:${requestId}:${vehicleNumber}:${index}`,
          requestId,
          scope: 'VEHICLE',
          clientName: String(request.clientName || 'N/A'),
          city: String(request.city || 'N/A'),
          serviceType: normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || request?.serviceType) || 'N/A',
          vehicleNumber,
          ltpocName: String(ltpocName || ''),
          ltpocPhone: String(ltpocPhone || ''),
          statusLabel: 'Cancelled Vehicle',
          cancelledBy,
          reason: cancellationReason,
          cancelledAt:
            vehicle?.paymentRejectedAt ||
            vehicle?.cancelledAt ||
            latestCancelEntry?.timestamp ||
            (request as Record<string, unknown>)?.updatedAt ||
            null,
        });
      });

      toHistory(request).forEach((entry, historyIndex) => {
        const action = normalizeStatusValue(entry?.action);
        if (action !== 'FO_REMOVE_VEHICLE') {
          return;
        }

        const removedVehicleNumber = parseRemovedVehicleNumber(entry?.notes);
        if (!removedVehicleNumber) {
          return;
        }

        const removedVehicle = vehicles.find(
          (vehicle) => String(vehicle?.vehicleNumber || '').trim().toUpperCase() === removedVehicleNumber.trim().toUpperCase()
        );
        const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(
          request,
          removedVehicle || ({ vehicleNumber: removedVehicleNumber } as Record<string, unknown>),
          removedVehicle ? vehicles.indexOf(removedVehicle) : undefined,
          {
            warnOnMissing: true,
            context: 'FoCancelledRemovedVehicleHistory',
          }
        );

        pushRow({
          key: `removed:${requestId}:${removedVehicleNumber}:${historyIndex}`,
          requestId,
          scope: 'VEHICLE',
          clientName: String(request.clientName || 'N/A'),
          city: String(request.city || 'N/A'),
          serviceType: getServiceLabel(request),
          vehicleNumber: removedVehicleNumber,
          ltpocName: String(ltpocName || ''),
          ltpocPhone: String(ltpocPhone || ''),
          statusLabel: 'Cancelled Vehicle',
          cancelledBy: getActorLabel(entry),
          reason: 'Removed from bulk request',
          cancelledAt: entry?.timestamp || (request as Record<string, unknown>)?.updatedAt || null,
        });
      });
    });

    return rows.sort((left, right) => toMillis(right.cancelledAt) - toMillis(left.cancelledAt));
  }, [visibleRequests]);

  const affectedRequestCount = useMemo(
    () => new Set(cancelledRows.map((row) => row.requestId)).size,
    [cancelledRows]
  );

  const handleExportCancelledCsv = () => {
    const exported = exportFoCancelledCsv(cancelledRows);
    if (!exported) {
      showToast('No cancelled rows available for CSV export.', 'info');
      return;
    }

    showToast('Cancelled CSV exported successfully.', 'success');
  };

  if (loading || tableLoading || !userRef || !isFoRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="FO"
      activePage="cancelled"
      title="Cancelled Requests"
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
              <h1 className="text-3xl font-semibold tracking-tight text-[#f26a21]">Cancelled Requests</h1>
              <p className="text-slate-500">Requests and vehicles dropped from workflow in your FO account.</p>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
              <div className="relative w-full sm:w-auto">
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs focus:ring-1 focus:ring-primary sm:w-72"
                  placeholder="Quick search ID or Client..."
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <button
                className="flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-50"
                type="button"
                onClick={handleExportCancelledCsv}
                disabled={cancelledRows.length === 0}
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Cancelled Entries</p>
            <p className="text-[20px] leading-tight font-bold text-[#f26a21]">{cancelledRows.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Affected Requests</p>
            <p className="text-[20px] leading-tight font-bold text-black">{affectedRequestCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            <p className="mb-0.5 text-[11px] font-bold uppercase tracking-tight text-slate-500">Visible Rows</p>
            <p className="text-[20px] leading-tight font-bold text-black">{cancelledRows.length}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70">
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Request ID</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Scope</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Client</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">City</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Service Type</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Vehicle</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Status</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Cancelled By</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Reason</th>
                  <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-primary">Cancelled At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cancelledRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">
                      No cancelled entries found.
                    </td>
                  </tr>
                ) : (
                  cancelledRows.map((row) => (
                    <tr key={row.key} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{formatRequestId(row.requestId)}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                        <span className={`rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-tight ${getScopePillClass(row.scope)}`}>
                          {row.scope}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-semibold text-[#12212a]">{row.clientName}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{row.city}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{row.serviceType || 'N/A'}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{row.vehicleNumber || 'N/A'}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">
                        <span className={`rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-tight ${getStatusPillClass(row.statusLabel)}`}>
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{row.cancelledBy}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{row.reason || 'N/A'}</td>
                      <td className="px-4 py-2 text-xs font-medium text-[#12212a]">{toDisplayDateTime(row.cancelledAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RolePageLayout>
  );
};

export default FoCancelled;
