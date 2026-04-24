import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import {
  formatRequestIdDisplay,
  getRequestStatusLabel,
  getServiceLabel,
  getStatusPillClass,
  getVehicleLabel,
  isRhActionable,
  normalizeRole,
  normalizeVehicles,
  requestMatchesSearch,
  RequestWithId,
  sortRequestsNewestFirst,
  toDisplayDate,
  toDisplayDateTime,
} from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  userProfile?: { id?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

type HistoryFilterKey = 'all' | 'completed' | 'halted';

const historyFilterMatches = (request: RequestWithId, filter: HistoryFilterKey) => {
  if (filter === 'all') {
    return true;
  }

  const statusLabel = getRequestStatusLabel(request);
  if (filter === 'completed') {
    return statusLabel === 'COMPLETED';
  }

  return ['HALTED', 'CANCELLED', 'REJECTED'].includes(statusLabel);
};

const normalizeVehicleNumberKey = (value: unknown) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const getRequestDetailVehicles = (request: RequestWithId) => {
  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  const ltpocRows = normalizeVehicles((request as Record<string, unknown>)?.ltpocDetails);
  const ltpocByVehicle = new Map(
    ltpocRows
      .map((row) => [normalizeVehicleNumberKey(row?.vehicleNumber), row] as const)
      .filter(([vehicleKey]) => Boolean(vehicleKey))
  );

  return vehicles.map((vehicle, index) => {
    const vehicleNumber = String(vehicle?.vehicleNumber || '');
    const ltpoc =
      ltpocByVehicle.get(normalizeVehicleNumberKey(vehicleNumber)) ||
      ltpocRows[index] ||
      {};

    return {
      ...vehicle,
      ltpocName: String(vehicle?.ltpocName || ltpoc?.ltpocName || ''),
      ltpocPhone: String(vehicle?.ltpocPhone || ltpoc?.ltpocPhone || ''),
    };
  });
};

const getHistorySummaryVehicles = (request: RequestWithId) => {
  const vehicles = getRequestDetailVehicles(request);
  if (vehicles.length > 0) {
    return vehicles;
  }

  return [
    {
      vehicleNumber: getVehicleLabel(request),
      serviceType: getServiceLabel(request),
      vehicleAvailabilityLocation: request.city || 'N/A',
      ltpocName: 'N/A',
      ltpocPhone: '',
    },
  ];
};

const RhHistory: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const profileUserId = String(userProfile?.id || '').trim();
  const stableUserId = profileUserId || String(user?.uid || '').trim();

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>('all');
  const [viewRequest, setViewRequest] = useState<RequestWithId | null>(null);

  const isRhRole = normalizeRole(userRole) === 'RH';

  useEffect(() => {
    if (!stableUserId || !isRhRole) {
      setTableLoading(false);
      return () => {};
    }

    const unsubscribe = requestService.subscribeToRhRequests(
      stableUserId,
      user?.email,
      (data) => {
        setRequests(sortRequestsNewestFirst(data as RequestWithId[]));
        setTableLoading(false);
      },
      (error) => {
        showToast(error.message || 'Unable to subscribe RH history.', 'error');
        setTableLoading(false);
      }
    );

    return unsubscribe;
  }, [stableUserId, user?.email, isRhRole]);

  const historyRequests = useMemo(
    () => requests.filter((request) => !isRhActionable(request)),
    [requests]
  );

  const visibleRequests = useMemo(
    () => historyRequests
      .filter((request) => requestMatchesSearch(request, searchTerm))
      .filter((request) => historyFilterMatches(request, historyFilter)),
    [historyRequests, searchTerm, historyFilter]
  );

  const completedCount = useMemo(
    () => historyRequests.filter((request) => getRequestStatusLabel(request) === 'COMPLETED').length,
    [historyRequests]
  );

  const haltedCount = useMemo(
    () => historyRequests.filter((request) => ['HALTED', 'CANCELLED', 'REJECTED'].includes(getRequestStatusLabel(request))).length,
    [historyRequests]
  );

  if (loading || tableLoading || !isRhRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="RH"
      activePage="history"
      title="History"
      subtitle="Regional compliance request timeline"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <section className="space-y-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-4xl font-black uppercase tracking-tighter text-primary">Installation History</h1>
            <p className="font-medium text-slate-500">Audit logs of all processed, completed, and halted requests.</p>
          </div>

          <div className="w-full max-w-xs">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search Request ID or Vehicle..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>

        <div className="flex overflow-x-auto border-b border-slate-200 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setHistoryFilter('all')}
            className={`px-6 py-3 text-xs font-black uppercase tracking-widest ${historyFilter === 'all' ? 'border-b-2 border-primary text-primary' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            All Processed ({historyRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setHistoryFilter('completed')}
            className={`px-6 py-3 text-xs font-black uppercase tracking-widest ${historyFilter === 'completed' ? 'border-b-2 border-primary text-primary' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Completed ({completedCount})
          </button>
          <button
            type="button"
            onClick={() => setHistoryFilter('halted')}
            className={`px-6 py-3 text-xs font-black uppercase tracking-widest ${historyFilter === 'halted' ? 'border-b-2 border-primary text-primary' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Halted/Cancelled ({haltedCount})
          </button>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Request ID</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Client</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Vehicle Number</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Service Type</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Date</th>
                  <th className="px-6 py-4 text-[11px] font-semibold uppercase tracking-widest text-slate-500 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visibleRequests.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-sm text-slate-500" colSpan={7}>
                      No RH history records found.
                    </td>
                  </tr>
                ) : (
                  visibleRequests.map((request, index) => {
                    const statusLabel = getRequestStatusLabel(request);

                    return (
                      <tr key={request.id || `rh-history-${index}`} className="transition-colors hover:bg-slate-50">
                        <td className="px-6 py-4 text-sm font-normal text-black">{formatRequestIdDisplay(request.id)}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-tight ${getStatusPillClass(statusLabel)}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-600">{request.clientName || 'N/A'}</td>
                        <td className="px-6 py-4 text-sm font-normal text-slate-800">{getVehicleLabel(request)}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{getServiceLabel(request)}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{toDisplayDate(request.createdAt)}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => setViewRequest(request)}
                            className="text-xs font-medium uppercase tracking-widest text-primary transition-colors hover:underline"
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
        </section>
      </section>

      <Modal isOpen={Boolean(viewRequest)} title="" onClose={() => setViewRequest(null)} showFooter={false}>
        {viewRequest ? (
          <div className="space-y-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black uppercase leading-none text-primary">{formatRequestIdDisplay(viewRequest.id)}</h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Processed Request Archive</p>
              </div>
              <button type="button" onClick={() => setViewRequest(null)} className="text-slate-400 transition-colors hover:text-slate-700">
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <section>
              <h3 className="mb-4 border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-widest text-primary">Request Summary</h3>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Client Name</p>
                  <p className="text-sm font-medium text-black">{viewRequest.clientName || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Vehicle ID</p>
                  <p className="text-sm font-mono font-medium text-black">{getVehicleLabel(viewRequest)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Service Type</p>
                  <p className="text-sm font-medium text-black">{getServiceLabel(viewRequest)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-500">Date Created</p>
                  <p className="text-sm font-medium text-black">{toDisplayDateTime(viewRequest.createdAt)}</p>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <section>
                <h3 className="mb-4 border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-widest text-primary">Location & Request</h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">City</p>
                    <p className="text-sm font-medium text-black">{viewRequest.city || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Current Status</p>
                    <p className="text-sm font-medium text-black">{getRequestStatusLabel(viewRequest)}</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-4 border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-widest text-primary">Regional Assignment</h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Assigned RH</p>
                    <p className="text-sm font-medium text-black">{String((viewRequest as Record<string, unknown>).assignedRhEmail || user?.email || 'N/A')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Request Type</p>
                    <p className="text-sm font-medium text-black">{viewRequest.isBulkRequest ? 'Bulk Request' : 'Single Request'}</p>
                  </div>
                </div>
              </section>
            </div>

            <section className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Vehicle</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">LPTOC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {getHistorySummaryVehicles(viewRequest).map((vehicle, index) => (
                    <tr key={`${String(vehicle.vehicleNumber || '')}-${index}`}>
                      <td className="px-3 py-2 text-slate-700">{String(vehicle.vehicleNumber || 'N/A')}</td>
                      <td className="px-3 py-2 text-slate-700">{String(vehicle.serviceType || 'N/A')}</td>
                      <td className="px-3 py-2 text-slate-700">{String(vehicle.vehicleAvailabilityLocation || 'N/A')}</td>
                      <td className="px-3 py-2 text-slate-700">{String(vehicle.ltpocName || 'N/A')} {vehicle.ltpocPhone ? `(${String(vehicle.ltpocPhone)})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ) : null}
      </Modal>
    </RolePageLayout>
  );
};

export default RhHistory;