import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import {
  canFoNotifyRequest,
  canVendorNotifyRequest,
  formatRequestIdDisplay,
  getRequestStatusLabel,
  resolveLtpocForRequestVehicle,
  getServiceLabel,
  getStatusPillClass,
  getVehicleLabel,
  normalizeRole,
  normalizeVehicles,
  RequestWithId,
  sortRequestsNewestFirst,
  toDateInputValue,
  toDisplayDateTime,
} from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  logout: () => Promise<void>;
  loading: boolean;
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const getRequestDetailVehicles = (request: RequestWithId): Array<Record<string, unknown>> => {
  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);

  return vehicles.map((vehicle, index) => {
    const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(request, vehicle, index, {
      warnOnMissing: true,
      context: 'VendorHistoryDetailModal',
    });

    return {
      ...vehicle,
      ltpocName: String(ltpocName || ''),
      ltpocPhone: String(ltpocPhone || ''),
    };
  });
};

const normalizeCsvServiceType = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'fleetx') {
    return 'FleetX';
  }
  if (normalized === 'wheelseye') {
    return 'WheelsEye';
  }
  return String(value || '').trim() || 'N/A';
};

const resolveCsvServiceCost = (serviceType: string, fallbackCost: unknown) => {
  const parsed = Number(String(fallbackCost ?? '').replace(/[^0-9.-]/g, ''));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  const normalized = String(serviceType || '').trim().toLowerCase();
  if (normalized === 'fleetx') {
    return 3000;
  }
  if (normalized === 'wheelseye') {
    return 2000;
  }
  return '';
};

const parseServiceCost = (value: unknown): number | null => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const formatServiceCost = (value: number) => {
  const rounded = Math.round(value);
  return `INR ${rounded.toLocaleString('en-IN')}`;
};

const getRequestServiceCostLabel = (request: RequestWithId) => {
  const vehicleCosts = normalizeVehicles(request?.vehicles)
    .map((vehicle) => parseServiceCost(vehicle?.serviceCost))
    .filter((value): value is number => value !== null);

  if (vehicleCosts.length > 0) {
    const totalCost = vehicleCosts.reduce((sum, cost) => sum + cost, 0);
    return formatServiceCost(totalCost);
  }

  const directCost = parseServiceCost(request?.serviceCost);
  if (directCost !== null) {
    return formatServiceCost(directCost);
  }

  const inferredType = normalizeCsvServiceType(
    request?.serviceType || request?.vendorName || (request as Record<string, unknown>)?.vendorType || getServiceLabel(request)
  );
  const inferredCost = parseServiceCost(resolveCsvServiceCost(inferredType, request?.serviceCost));
  if (inferredCost !== null) {
    return formatServiceCost(inferredCost);
  }

  return 'N/A';
};

const exportVendorHistoryCsv = (requests: RequestWithId[]) => {
  const headers = [
    'Request ID',
    'Status',
    'Client',
    'City',
    'Vehicle Number',
    'Service Type',
    'Service Cost',
    'Location',
    'Available Time',
    'LTPOC Name',
    'LTPOC Phone',
    'Completion Date',
  ];

  const rows = requests.flatMap((request) => {
    const requestVehicles = normalizeVehicles(request.vehicles);
    const base = [
      formatRequestIdDisplay(request.id),
      getRequestStatusLabel(request),
      String(request.clientName || ''),
      String(request.city || ''),
    ];

    if (requestVehicles.length === 0) {
      const serviceType = normalizeCsvServiceType(request?.serviceType || request?.vendorName || '');
      const serviceCost = resolveCsvServiceCost(serviceType, request?.serviceCost);

      return [[
        ...base,
        '',
        serviceType,
        serviceCost,
        String(request.vehicleAvailabilityLocation || ''),
        String(request.vehicleAvailableTime || ''),
        '',
        '',
        toDisplayDateTime(request.updatedAt || request.createdAt),
      ]];
    }

    return requestVehicles.map((vehicle, index) => {
      const vehicleNumber = String(vehicle?.vehicleNumber || '');
      const { ltpocName, ltpocPhone } = resolveLtpocForRequestVehicle(request, vehicle, index, {
        warnOnMissing: true,
        context: 'VendorHistoryCsv',
      });
      const serviceType = normalizeCsvServiceType(
        vehicle?.serviceType || vehicle?.vendorType || request?.serviceType || request?.vendorName || ''
      );
      const serviceCost = resolveCsvServiceCost(serviceType, vehicle?.serviceCost ?? request?.serviceCost);

      return [
        ...base,
        vehicleNumber,
        serviceType,
        serviceCost,
        String(vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || ''),
        String(vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || ''),
        String(ltpocName || ''),
        String(ltpocPhone || ''),
        toDisplayDateTime(request.updatedAt || request.createdAt),
      ];
    });
  });

  const content = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ].join('\n');

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vendor_history_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const VendorHistory: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, logout, loading } = useAuth() as AuthShape;

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'cancelled' | 'archived'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewRequest, setViewRequest] = useState<RequestWithId | null>(null);

  const isVendorRole = normalizeRole(userRole) === 'VENDOR';

  useEffect(() => {
    if (!user?.uid || !isVendorRole) {
      setTableLoading(false);
      return () => {};
    }

    const unsubscribe = requestService.subscribeToAllRequests((data) => {
      setRequests(sortRequestsNewestFirst(data as RequestWithId[]));
      setTableLoading(false);
    });

    return unsubscribe;
  }, [user?.uid, isVendorRole]);

  const historyRequests = useMemo(
    () => requests.filter((request) => !canVendorNotifyRequest(request) && !canFoNotifyRequest(request)),
    [requests]
  );

  const visibleRequests = useMemo(() => {
    return historyRequests
      .filter((request) => {
        if (statusFilter === 'all') {
          return true;
        }

        const statusLabel = getRequestStatusLabel(request).toUpperCase();
        if (statusFilter === 'completed') {
          return statusLabel === 'FO NOTIFIED' || statusLabel === 'COMPLETED';
        }
        if (statusFilter === 'cancelled') {
          return statusLabel === 'CANCELLED';
        }
        return statusLabel === 'REJECTED' || statusLabel === 'HALTED';
      })
      .filter((request) => {
        const rowDate = toDateInputValue(request.updatedAt || request.createdAt);
        if (!rowDate) {
          return false;
        }

        if (dateFrom && rowDate < dateFrom) {
          return false;
        }
        if (dateTo && rowDate > dateTo) {
          return false;
        }

        return true;
      });
  }, [historyRequests, statusFilter, dateFrom, dateTo]);

  const handleDownloadCsv = () => {
    if (visibleRequests.length === 0) {
      showToast('No history rows available to download.', 'info');
      return;
    }

    exportVendorHistoryCsv(visibleRequests);
    showToast(`Downloaded ${visibleRequests.length} history row(s).`, 'success');
  };

  if (loading || tableLoading || !isVendorRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="VENDOR"
      activePage="history"
      title="Vendor Coordinator History"
      subtitle="Processed vendor request records"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <section className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | 'completed' | 'cancelled' | 'archived')}
            className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-primary"
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="archived">Archived</option>
          </select>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-primary"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadCsv}
          disabled={visibleRequests.length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          Download CSV
        </button>
      </section>

      <section className="rounded-xl border border-primary/10 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-primary/5 border-b border-primary/10">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Request ID</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Client</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Service Type</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Vehicle Number</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Service Cost</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Completion Date</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-primary/5">
              {visibleRequests.length === 0 ? (
                <tr>
                  <td className="px-6 py-10 text-center text-sm text-slate-500" colSpan={8}>
                    No vendor history records found.
                  </td>
                </tr>
              ) : (
                visibleRequests.map((request, index) => {
                  const statusLabel = getRequestStatusLabel(request);
                  const vehicleLabel = getVehicleLabel(request);
                  const requestTypeLabel = request?.isBulkRequest ? '(Bulk)' : '(Single)';
                  const serviceCostLabel = getRequestServiceCostLabel(request);

                  return (
                    <tr key={request.id || `vendor-history-${index}`} className="align-top transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{formatRequestIdDisplay(request.id)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusPillClass(statusLabel)}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">{request.clientName || 'N/A'}</td>
                      <td className="px-4 py-3 text-sm text-slate-900">{getServiceLabel(request)}</td>
                      <td className="px-4 py-3 text-sm text-slate-900">
                        <p className="leading-tight text-slate-900">{vehicleLabel}</p>
                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{requestTypeLabel}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">{serviceCostLabel}</td>
                      <td className="px-4 py-3 text-sm text-slate-900">{toDisplayDateTime(request.updatedAt || request.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setViewRequest(request)}
                          className="text-xs font-bold uppercase tracking-tighter text-primary hover:text-primary/70"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-primary/10 bg-primary/5 px-6 py-4">
          <span className="text-xs italic text-slate-500">
            Showing 1 to {visibleRequests.length} of {historyRequests.length} completed requests
          </span>

          <div className="flex gap-1">
            <button
              type="button"
              className="rounded border border-primary/20 bg-white px-3 py-1 text-xs hover:bg-primary/5"
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded border border-primary/20 bg-white px-3 py-1 text-xs font-bold text-primary hover:bg-primary/5"
            >
              1
            </button>
            <button
              type="button"
              className="rounded border border-primary/20 bg-white px-3 py-1 text-xs hover:bg-primary/5"
            >
              2
            </button>
            <button
              type="button"
              className="rounded border border-primary/20 bg-white px-3 py-1 text-xs hover:bg-primary/5"
            >
              3
            </button>
            <button
              type="button"
              className="rounded border border-primary/20 bg-white px-3 py-1 text-xs hover:bg-primary/5"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <Modal
        isOpen={Boolean(viewRequest)}
        title="Vendor History Details"
        subtitle={viewRequest?.id ? `Request ${formatRequestIdDisplay(viewRequest.id)}` : 'Request details'}
        onClose={() => setViewRequest(null)}
        showFooter={false}
      >
        {viewRequest ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-primary/10 bg-primary/5 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Request ID</p>
                  <p className="mt-1 font-semibold text-slate-800">{formatRequestIdDisplay(viewRequest.id)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Status</p>
                  <p className="mt-1 font-semibold text-slate-800">{getRequestStatusLabel(viewRequest)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">City</p>
                  <p className="mt-1 font-semibold text-slate-800">{viewRequest.city || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Client</p>
                  <p className="mt-1 font-semibold text-slate-800">{viewRequest.clientName || 'N/A'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Vehicles</p>
              <div className="overflow-hidden rounded-lg border border-primary/10">
                <table className="min-w-full text-xs">
                  <thead className="bg-primary/5 border-b border-primary/10 text-black uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider">Vehicle</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider">Service</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider">Location</th>
                      <th className="px-3 py-2 text-left text-[10px] font-bold tracking-wider">LTPOC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-primary/5">
                    {getRequestDetailVehicles(viewRequest).length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={4}>No vehicle rows available.</td>
                      </tr>
                    ) : (
                      getRequestDetailVehicles(viewRequest).map((vehicle, index) => (
                        <tr key={`${String((vehicle as Record<string, unknown>).vehicleNumber || '')}-${index}`}>
                          <td className="px-3 py-2 text-slate-700">{String((vehicle as Record<string, unknown>).vehicleNumber || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String((vehicle as Record<string, unknown>).serviceType || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String((vehicle as Record<string, unknown>).vehicleAvailabilityLocation || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String((vehicle as Record<string, unknown>).ltpocName || 'N/A')} {(vehicle as Record<string, unknown>).ltpocPhone ? `(${String((vehicle as Record<string, unknown>).ltpocPhone)})` : ''}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </RolePageLayout>
  );
};

export default VendorHistory;
