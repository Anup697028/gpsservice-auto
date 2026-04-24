import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import {
  formatRequestIdDisplay,
  getRequestStatusLabel,
  getServiceLabel,
  getStatusPillClass,
  getVehicleLabel,
  isVehicleDropped,
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
  userProfile: { id?: string | null; name?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

type EditDraft = {
  clientName: string;
  city: string;
};

type RejectMode = 'all' | 'single';

const createEditDraft = (request: RequestWithId | null): EditDraft => ({
  clientName: String(request?.clientName || ''),
  city: String(request?.city || ''),
});

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

const getRequestSummaryVehicles = (request: RequestWithId) => {
  const vehicles = getRequestDetailVehicles(request).filter((vehicle) => !isVehicleDropped(vehicle));
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

export const RhDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const profileUserId = String(userProfile?.id || '').trim();
  const stableUserId = profileUserId || String(user?.uid || '').trim();

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [viewRequest, setViewRequest] = useState<RequestWithId | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RequestWithId | null>(null);
  const [rejectMode, setRejectMode] = useState<RejectMode>('all');
  const [selectedRejectVehicleNumber, setSelectedRejectVehicleNumber] = useState('');
  const [rejectConfirmed, setRejectConfirmed] = useState(false);
  const [editTarget, setEditTarget] = useState<RequestWithId | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(createEditDraft(null));
  const [rejectionReason, setRejectionReason] = useState('');
  const [actioningRequestId, setActioningRequestId] = useState<string | null>(null);
  const [bulkActioning, setBulkActioning] = useState(false);

  const userRef = useMemo<UserRef | null>(() => {
    if (!user) {
      return null;
    }

    return {
      id: stableUserId,
      email: user.email ?? null,
      name: userProfile?.name ?? null,
      role: 'RH',
    };
  }, [user, stableUserId, userProfile?.name]);

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
        showToast(error.message || 'Unable to subscribe RH requests.', 'error');
        setTableLoading(false);
      }
    );

    return unsubscribe;
  }, [stableUserId, user?.email, isRhRole]);

  const actionableRequests = useMemo(
    () => requests.filter((request) => isRhActionable(request)),
    [requests]
  );

  const visibleRequests = useMemo(
    () => actionableRequests.filter((request) => requestMatchesSearch(request, searchTerm)),
    [actionableRequests, searchTerm]
  );

  const processedCount = useMemo(
    () => requests.filter((request) => !isRhActionable(request)).length,
    [requests]
  );

  const allVisibleIds = useMemo(
    () => visibleRequests.map((request) => String(request.id || '')).filter(Boolean),
    [visibleRequests]
  );

  useEffect(() => {
    setSelectedRequestIds((previous) => previous.filter((id) => allVisibleIds.includes(id)));
  }, [allVisibleIds]);

  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedRequestIds.includes(id));

  const rejectVehicles = useMemo(
    () => (rejectTarget
      ? normalizeVehicles((rejectTarget as Record<string, unknown>)?.vehicles).filter((vehicle) => !isVehicleDropped(vehicle))
      : []),
    [rejectTarget]
  );

  const canRejectSingleVehicle = Boolean(rejectTarget?.isBulkRequest && rejectVehicles.length > 1);

  const closeRejectModal = () => {
    setRejectTarget(null);
    setRejectMode('all');
    setSelectedRejectVehicleNumber('');
    setRejectConfirmed(false);
    setRejectionReason('');
  };

  const openRejectModal = (request: RequestWithId) => {
    setRejectTarget(request);
    setRejectMode('all');
    setSelectedRejectVehicleNumber('');
    setRejectConfirmed(false);
    setRejectionReason('');
  };

  const disableConfirmReject =
    !rejectConfirmed
    || actioningRequestId === rejectTarget?.id
    || (rejectMode === 'single' && canRejectSingleVehicle && !selectedRejectVehicleNumber)
    || (rejectMode === 'all' && !rejectionReason.trim());

  const approveRequestItem = async (request: RequestWithId) => {
    if (!request.id || !userRef) {
      return;
    }

    if (request.isBulkRequest) {
      await requestService.approveBulkRequest(request.id, userRef);
      return;
    }

    await requestService.approveRequest(request.id, userRef, 'RH');
  };

  const handleApprove = async (request: RequestWithId) => {
    if (!request.id || !userRef) {
      return;
    }

    setActioningRequestId(request.id);
    try {
      await approveRequestItem(request);
      showToast(`Request ${formatRequestIdDisplay(request.id)} approved.`, 'success');
      setViewRequest((current) => (current?.id === request.id ? null : current));
    } catch (error) {
      showToast((error as Error).message || 'Failed to approve request.', 'error');
    } finally {
      setActioningRequestId(null);
    }
  };

  const handleApproveMany = async (requestsToApprove: RequestWithId[], successLabel: string) => {
    if (!userRef) {
      return;
    }

    const actionable = requestsToApprove.filter((request) => Boolean(request.id));
    if (actionable.length === 0) {
      showToast('No pending RH requests available for approval.', 'info');
      return;
    }

    setBulkActioning(true);
    let approvedCount = 0;

    try {
      for (const request of actionable) {
        await approveRequestItem(request);
        approvedCount += 1;
      }

      showToast(`${successLabel}: ${approvedCount} request(s) approved.`, 'success');
      setSelectedRequestIds([]);
    } catch (error) {
      showToast((error as Error).message || 'Bulk approval failed.', 'error');
    } finally {
      setBulkActioning(false);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget?.id || !userRef) {
      return;
    }

    setActioningRequestId(rejectTarget.id);
    try {
      if (rejectMode === 'single') {
        if (!canRejectSingleVehicle) {
          throw new Error('Single vehicle rejection is not available for this request.');
        }

        if (!selectedRejectVehicleNumber) {
          showToast('Please select a vehicle to reject from this request.', 'error');
          return;
        }

        console.log(`[RhDashboard] Rejecting vehicle ${selectedRejectVehicleNumber} from request ${rejectTarget.id}`);
        await requestService.rhRejectSingleVehicle(rejectTarget.id, selectedRejectVehicleNumber, userRef);
        showToast(`Vehicle ${selectedRejectVehicleNumber} rejected in request ${formatRequestIdDisplay(rejectTarget.id)}.`, 'success');
        closeRejectModal();
        return;
      }

      const reason = rejectionReason.trim();
      if (!reason) {
        showToast('Rejection reason is required.', 'error');
        return;
      }

      if (rejectTarget.isBulkRequest) {
        console.log(`[RhDashboard] Rejecting bulk request ${rejectTarget.id} with reason: ${reason}`);
        console.log(`[RhDashboard] Current status: ${rejectTarget.status}, isBulkRequest: ${rejectTarget.isBulkRequest}`);
        await requestService.rejectBulkRequest(rejectTarget.id, reason, userRef);
      } else {
        console.log(`[RhDashboard] Rejecting single request ${rejectTarget.id} with reason: ${reason}`);
        console.log(`[RhDashboard] Current status: ${rejectTarget.status}, isBulkRequest: ${rejectTarget.isBulkRequest}`);
        await requestService.rejectRequest(rejectTarget.id, userRef, 'RH', reason);
      }

      showToast(`Request ${formatRequestIdDisplay(rejectTarget.id)} rejected.`, 'success');
      closeRejectModal();
    } catch (error) {
      console.error(`[RhDashboard] Rejection failed:`, error);
      showToast((error as Error).message || 'Failed to reject request.', 'error');
    } finally {
      setActioningRequestId(null);
    }
  };

  const handleEditApprove = async () => {
    if (!editTarget?.id || !userRef) {
      return;
    }

    if (editTarget.isBulkRequest) {
      showToast('Bulk requests cannot be edited at this stage.', 'info');
      return;
    }

    const nextClientName = editDraft.clientName.trim();
    const nextCity = editDraft.city.trim();
    if (!nextClientName || !nextCity) {
      showToast('Client name and city are required.', 'error');
      return;
    }

    setActioningRequestId(editTarget.id);
    try {
      await requestService.editAndApprove(
        editTarget.id,
        {
          clientName: nextClientName,
          city: nextCity,
        },
        userRef,
        'RH'
      );

      showToast(`Request ${formatRequestIdDisplay(editTarget.id)} saved and approved.`, 'success');
      setEditTarget(null);
      setEditDraft(createEditDraft(null));
    } catch (error) {
      showToast((error as Error).message || 'Failed to save and approve request.', 'error');
    } finally {
      setActioningRequestId(null);
    }
  };

  if (loading || tableLoading || !userRef || !isRhRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="RH"
      activePage="dashboard"
      title="Regional Head Dashboard"
      subtitle="Pending RH decisions only"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <section className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-primary">Overview</h2>
            <p className="text-sm text-slate-500">Regional snapshot for assigned installation requests.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleApproveMany(visibleRequests, 'Approve all pending')}
            disabled={bulkActioning || visibleRequests.length === 0}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white shadow-md transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {bulkActioning ? 'Approving...' : 'Approve All Pending'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Total Assigned</p>
            <p className="mt-2 text-3xl font-black text-black">{requests.length}</p>
          </article>
          <article className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-primary">New Requests</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-3xl font-black text-black">{actionableRequests.length}</p>
              <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">Pending RH Decision</span>
            </div>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">History</p>
            <p className="mt-2 text-3xl font-black text-black">{processedCount}</p>
          </article>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-black tracking-tight text-primary">Pending RH Decisions</h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">Active Status</span>
              </div>
              <div className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="material-symbols-outlined text-lg text-slate-400">search</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="ID, Client, or City..."
                  className="w-full border-none bg-transparent text-sm text-slate-700 outline-none focus:ring-0"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-primary focus:ring-primary"
                checked={allVisibleSelected}
                onChange={(event) => {
                  if (event.target.checked) {
                    setSelectedRequestIds(allVisibleIds);
                    return;
                  }
                  setSelectedRequestIds([]);
                }}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Selection Actions</span>
            </div>

            <button
              type="button"
              onClick={() => {
                const selectedRequests = visibleRequests.filter((request) => selectedRequestIds.includes(String(request.id || '')));
                void handleApproveMany(selectedRequests, 'Approve selected');
              }}
              disabled={bulkActioning || selectedRequestIds.length === 0}
              className="rounded bg-primary px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {bulkActioning ? 'Working...' : 'Approve All Selected'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Request ID</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Client</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Vehicle Number</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Service Type</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Date</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visibleRequests.length === 0 ? (
                  <tr>
                    <td className="px-4 py-12 text-center text-sm text-slate-500" colSpan={8}>
                      No new RH requests found.
                    </td>
                  </tr>
                ) : (
                  visibleRequests.map((request, index) => {
                    const statusLabel = getRequestStatusLabel(request);
                    const isBusy = actioningRequestId === request.id || bulkActioning;
                    const requestId = String(request.id || `rh-dashboard-${index}`);

                    return (
                      <tr key={requestId} className="transition-colors hover:bg-slate-50/80">
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-primary focus:ring-primary"
                            checked={selectedRequestIds.includes(requestId)}
                            onChange={(event) => {
                              setSelectedRequestIds((previous) => {
                                if (event.target.checked) {
                                  return previous.includes(requestId) ? previous : [...previous, requestId];
                                }
                                return previous.filter((id) => id !== requestId);
                              });
                            }}
                          />
                        </td>
                        <td className="px-4 py-4 text-sm font-bold text-black break-all max-w-[140px] sm:max-w-none">{formatRequestIdDisplay(request.id)}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${getStatusPillClass(statusLabel)}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-black">{request.clientName || 'N/A'}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-black">{getVehicleLabel(request)}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-black">{getServiceLabel(request)}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-black">{toDisplayDate(request.createdAt)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-nowrap items-center justify-end gap-1.5 sm:gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setViewRequest(request)}
                              className="rounded-lg border border-primary px-2.5 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/5 whitespace-nowrap"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleApprove(request)}
                              disabled={isBusy}
                              className="rounded-lg bg-primary px-2.5 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-primary/90 disabled:opacity-60 whitespace-nowrap"
                            >
                              {isBusy ? 'Working...' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                openRejectModal(request);
                              }}
                              disabled={isBusy}
                              className="rounded-lg bg-slate-900 px-2.5 sm:px-3 py-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                            >
                              Reject
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
        </section>
      </section>

      <Modal isOpen={Boolean(viewRequest)} title="" onClose={() => setViewRequest(null)} showFooter={false}>
        {viewRequest ? (
          <div className="space-y-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black uppercase leading-none text-primary">{formatRequestIdDisplay(viewRequest.id)}</h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Single Request Approval Review</p>
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
                    <p className="text-[10px] font-bold uppercase text-slate-500">Request Type</p>
                    <p className="text-sm font-medium text-black">{viewRequest.isBulkRequest ? 'Bulk Request' : 'Single Request'}</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-4 border-b border-slate-200 pb-2 text-xs font-black uppercase tracking-widest text-primary">Regional & Payment</h3>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">RH Assigned</p>
                    <p className="text-sm font-medium text-black">{String((viewRequest as Record<string, unknown>).assignedRhEmail || user?.email || 'N/A')}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Current Status</p>
                    <p className="text-sm font-medium text-black">{getRequestStatusLabel(viewRequest)}</p>
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
                  {getRequestSummaryVehicles(viewRequest).map((vehicle, index) => (
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

            <div className="flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  openRejectModal(viewRequest);
                  setViewRequest(null);
                }}
                className="rounded px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-slate-800"
                style={{ backgroundColor: '#C4382A' }}
              >
                Reject Request
              </button>
              {!viewRequest.isBulkRequest ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditTarget(viewRequest);
                    setEditDraft(createEditDraft(viewRequest));
                    setViewRequest(null);
                  }}
                  className="rounded border-2 border-primary bg-transparent px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/5"
                >
                  Edit & Approve
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleApprove(viewRequest)}
                disabled={actioningRequestId === viewRequest.id}
                className="rounded bg-primary px-8 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {actioningRequestId === viewRequest.id ? 'Approving...' : 'Approve'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={Boolean(rejectTarget)}
        title=""
        onClose={closeRejectModal}
        showFooter={false}
      >
        {rejectTarget ? (
          <div className="space-y-0">
            <header className="flex items-center justify-between border-b border-slate-200 px-1 pb-4">
              <h2 className="text-xl font-bold uppercase tracking-tight text-[#f26a21]">Reject Request</h2>
              <button type="button" onClick={closeRejectModal} className="text-slate-400 transition-colors hover:text-slate-700">
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </header>

            <div className="mt-4 grid grid-cols-2 gap-4 border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Request ID</p>
                <p className="font-bold">{formatRequestIdDisplay(rejectTarget.id)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Client</p>
                <p className="font-bold">{rejectTarget.clientName || 'N/A'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Status</p>
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusPillClass(getRequestStatusLabel(rejectTarget))}`}>
                  {getRequestStatusLabel(rejectTarget)}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Vehicles</p>
                <p className="font-bold">{rejectVehicles.length || 1}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Service</p>
                <p className="font-bold">{getServiceLabel(rejectTarget)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Total Cost</p>
                <p className="font-bold">
                  {Number((rejectTarget as Record<string, unknown>)?.serviceCost || 0) > 0
                    ? `INR ${Number((rejectTarget as Record<string, unknown>)?.serviceCost || 0).toLocaleString('en-IN')}`
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-500">Refundable</p>
                <p className="font-bold text-green-600">
                  {(rejectTarget as Record<string, unknown>)?.isRefundable === true
                    ? 'YES'
                    : (rejectTarget as Record<string, unknown>)?.isRefundable === false
                      ? 'NO'
                      : 'N/A'}
                </p>
              </div>
            </div>

            <div className="mb-6 mt-6 space-y-4">
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  rejectMode === 'all' ? 'border-primary bg-primary/5' : 'border-slate-300'
                }`}
              >
                <input
                  checked={rejectMode === 'all'}
                  className="mt-1"
                  name="rh_reject_type"
                  onChange={() => setRejectMode('all')}
                  type="radio"
                />
                <div>
                  <p className="font-bold">Reject entire request</p>
                  <p className="text-xs text-slate-600">
                    All {rejectVehicles.length || 1} vehicles in this request will be rejected.
                  </p>
                </div>
              </label>

              {canRejectSingleVehicle ? (
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    rejectMode === 'single' ? 'border-primary bg-primary/5' : 'border-slate-300'
                  }`}
                >
                  <input
                    checked={rejectMode === 'single'}
                    className="mt-1"
                    name="rh_reject_type"
                    onChange={() => setRejectMode('single')}
                    type="radio"
                  />
                  <div>
                    <p className="font-bold">Delete one vehicle from bulk</p>
                    <p className="text-xs text-slate-600">Select a specific vehicle to drop from this request.</p>
                  </div>
                </label>
              ) : null}
            </div>

            {canRejectSingleVehicle ? (
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
                    {rejectVehicles.map((vehicle, index) => {
                      const vehicleNumber = String(vehicle?.vehicleNumber || `Vehicle ${index + 1}`);
                      const vehicleType = String(vehicle?.vehicleType || vehicle?.type || 'N/A');
                      const serviceType = String(vehicle?.serviceType || 'N/A');
                      const rowCost = Number(vehicle?.serviceCost || (rejectTarget as Record<string, unknown>)?.serviceCost || 0);

                      return (
                        <tr className="hover:bg-slate-50" key={`${vehicleNumber}-${index}`}>
                          <td className="px-3 py-2">{vehicleNumber}</td>
                          <td className="px-3 py-2">{vehicleType}</td>
                          <td className="px-3 py-2">{serviceType}</td>
                          <td className="px-3 py-2">{rowCost > 0 ? `INR ${rowCost.toLocaleString('en-IN')}` : 'N/A'}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              checked={selectedRejectVehicleNumber === vehicleNumber}
                              disabled={rejectMode !== 'single'}
                              name="rh_single_v"
                              onChange={() => setSelectedRejectVehicleNumber(vehicleNumber)}
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

            {rejectMode === 'all' ? (
              <div className="space-y-2 pb-4">
                <label className="text-sm text-primary">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={5}
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Provide a detailed reason for rejecting this installation request..."
                  className="w-full resize-none rounded-lg border border-slate-200 p-4 text-sm text-slate-900 outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs italic text-slate-400">Minimum 20 characters recommended.</p>
                  <p className="text-xs text-slate-400">{rejectionReason.trim().length} / 500</p>
                </div>
              </div>
            ) : null}

            <div className="space-y-4 border-t border-slate-200 pt-4">
              <label className="flex items-center gap-3">
                <input
                  checked={rejectConfirmed}
                  className="rounded border-slate-300"
                  onChange={(event) => setRejectConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span className="text-sm font-medium">
                  I understand that this action is permanent and cannot be undone.
                </span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  className="w-full min-w-0 rounded-lg border-2 border-primary bg-white py-2 px-3 text-xs leading-tight sm:text-sm sm:py-2.5 font-bold uppercase text-primary transition-colors hover:bg-orange-50 whitespace-normal break-words"
                  onClick={closeRejectModal}
                  type="button"
                >
                  Keep Request
                </button>
                <button
                  className="w-full min-w-0 rounded-lg border-2 border-primary bg-primary py-2 px-3 text-xs leading-tight sm:text-sm sm:py-2.5 font-bold uppercase text-white transition-colors disabled:opacity-50 whitespace-normal break-words"
                  disabled={disableConfirmReject}
                  onClick={handleReject}
                  type="button"
                >
                  {actioningRequestId === rejectTarget.id ? 'Processing...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={Boolean(editTarget)}
        title=""
        onClose={() => {
          setEditTarget(null);
          setEditDraft(createEditDraft(null));
        }}
        showFooter={false}
      >
        {editTarget ? (
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 px-1 pb-6">
              <h1 className="text-2xl font-light tracking-tight text-primary">Edit & Approve Request</h1>
              <button type="button" onClick={() => setEditTarget(null)} className="text-slate-400 transition-colors hover:text-slate-900">
                <span className="material-symbols-outlined text-2xl">close</span>
              </button>
            </div>

            <div className="px-1 py-8">
              <div className="mb-8 border-l-4 border-primary bg-primary/5 p-4">
                <p className="text-sm text-slate-800">Editing allowed only during Parallel Review.</p>
              </div>

              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm uppercase tracking-wider text-slate-900">Client Name</label>
                  <input
                    type="text"
                    value={editDraft.clientName}
                    onChange={(event) => setEditDraft((current) => ({ ...current, clientName: event.target.value }))}
                    className="w-full border border-slate-300 bg-transparent px-4 py-3 text-slate-900 outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                    placeholder="Enter client name"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm uppercase tracking-wider text-slate-900">City</label>
                  <input
                    type="text"
                    value={editDraft.city}
                    onChange={(event) => setEditDraft((current) => ({ ...current, city: event.target.value }))}
                    className="w-full border border-slate-300 bg-transparent px-4 py-3 text-slate-900 outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                    placeholder="Enter city"
                  />
                </div>
                {editTarget.isBulkRequest ? (
                  <p className="text-xs italic text-slate-500">Note: Bulk requests cannot be edited at this stage.</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 px-1 pb-2 pt-4 sm:flex-row-reverse">
              <button
                type="button"
                onClick={handleEditApprove}
                disabled={actioningRequestId === editTarget.id || editTarget.isBulkRequest}
                className="w-full rounded bg-primary px-8 py-3 text-sm font-medium uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
              >
                {actioningRequestId === editTarget.id ? 'Saving...' : 'Save & Approve'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditTarget(null);
                  setEditDraft(createEditDraft(null));
                }}
                className="w-full border border-slate-300 px-8 py-3 text-sm font-medium uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </RolePageLayout>
  );
};

export default RhDashboard;