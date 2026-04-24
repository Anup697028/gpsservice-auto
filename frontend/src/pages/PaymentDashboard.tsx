import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { PaymentConsoleLayout } from '../components/PaymentConsoleLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import {
  buildPaymentRowsForRequest,
  canTakePaymentRowAction,
  exportPaymentRowsToCsv,
  formatPaymentServiceCharge,
  getPaymentRowKey,
  getPaymentRowStatusClass,
  getPaymentRowStatusLabel,
  type PaymentRow,
} from '../utils/paymentRows';
import { RequestWithId, formatRequestIdDisplay, sortRequestsNewestFirst } from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  userProfile: { name?: string | null; title?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

type PaymentSharedFilters = {
  searchTerm: string;
  cityFilter: string;
  dateFrom: string;
  dateTo: string;
};

const PAYMENT_SHARED_FILTERS_KEY = 'paymentSharedFiltersV1';

const getDefaultPaymentSharedFilters = (): PaymentSharedFilters => ({
  searchTerm: '',
  cityFilter: 'all',
  dateFrom: '',
  dateTo: '',
});

const loadPaymentSharedFilters = (): PaymentSharedFilters => {
  if (typeof window === 'undefined') {
    return getDefaultPaymentSharedFilters();
  }

  try {
    const raw = window.localStorage.getItem(PAYMENT_SHARED_FILTERS_KEY);
    if (!raw) {
      return getDefaultPaymentSharedFilters();
    }

    const parsed = JSON.parse(raw) as Partial<PaymentSharedFilters>;
    return {
      searchTerm: String(parsed?.searchTerm || ''),
      cityFilter: String(parsed?.cityFilter || 'all'),
      dateFrom: String(parsed?.dateFrom || ''),
      dateTo: String(parsed?.dateTo || ''),
    };
  } catch {
    return getDefaultPaymentSharedFilters();
  }
};

const savePaymentSharedFilters = (filters: PaymentSharedFilters) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PAYMENT_SHARED_FILTERS_KEY, JSON.stringify(filters));
};

const matchesPaymentSearch = (row: PaymentRow, searchTerm: string) => {
  const normalized = String(searchTerm || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [row.requestId, row.clientName, row.city, row.vehicleNumber, row.serviceType]
    .some((value) => String(value || '').toLowerCase().includes(normalized));
};

const groupRowsForBulkAction = (rows: PaymentRow[]) => {
  const groups = new Map<string, { request: RequestWithId; vehicleIndexes: number[]; isBulkRequest: boolean }>();

  rows.forEach((row) => {
    if (!row.requestId) {
      return;
    }

    const existing = groups.get(row.requestId);
    if (!existing) {
      groups.set(row.requestId, {
        request: row.request,
        vehicleIndexes: Number.isInteger(row.vehicleIndex) ? [Number(row.vehicleIndex)] : [],
        isBulkRequest: row.isBulkRequest,
      });
      return;
    }

    if (Number.isInteger(row.vehicleIndex)) {
      existing.vehicleIndexes.push(Number(row.vehicleIndex));
    }
  });

  return Array.from(groups.entries()).map(([requestId, value]) => ({ requestId, ...value }));
};

const formatActionError = (error: unknown, fallbackMessage: string) => {
  const message =
    (error && typeof error === 'object' && 'message' in error && String((error as { message?: unknown }).message || '').trim()) ||
    fallbackMessage;

  const code =
    (error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code || '').trim()) ||
    '';

  return code ? `${message} (${code})` : message;
};

export const PaymentDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const initialFilters = useMemo(() => loadPaymentSharedFilters(), []);

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm);
  const [cityFilter, setCityFilter] = useState(initialFilters.cityFilter);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [showAdditionalColumns, setShowAdditionalColumns] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [viewRow, setViewRow] = useState<PaymentRow | null>(null);
  const [rejectRow, setRejectRow] = useState<PaymentRow | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actioningKeys, setActioningKeys] = useState<string[]>([]);
  const [bulkActioning, setBulkActioning] = useState(false);

  const userRef = useMemo<UserRef | null>(() => {
    if (!user) {
      return null;
    }

    return {
      id: user.uid,
      email: user.email ?? null,
      name: userProfile?.name ?? null,
      role: 'PAYMENT',
    };
  }, [user, userProfile?.name]);

  const isPaymentRole = String(userRole || '').trim().toUpperCase() === 'PAYMENT';

  useEffect(() => {
    if (!user?.uid || !isPaymentRole) {
      setTableLoading(false);
      return () => {};
    }

    const unsubscribe = requestService.subscribeToAllRequests((data) => {
      setRequests(sortRequestsNewestFirst(data as RequestWithId[]));
      setTableLoading(false);
    });

    return unsubscribe;
  }, [user?.uid, isPaymentRole]);

  useEffect(() => {
    savePaymentSharedFilters({ searchTerm, cityFilter, dateFrom, dateTo });
  }, [searchTerm, cityFilter, dateFrom, dateTo]);

  const allRows = useMemo(
    () => requests.flatMap((request) => buildPaymentRowsForRequest(request)).sort((left, right) => right.createdAtMs - left.createdAtMs),
    [requests]
  );

  const pendingRows = useMemo(
    () => allRows.filter((row) => canTakePaymentRowAction(row)),
    [allRows]
  );

  const filteredRows = useMemo(
    () =>
      pendingRows
        .filter((row) => matchesPaymentSearch(row, searchTerm))
        .filter((row) => cityFilter === 'all' || row.city === cityFilter)
        .filter((row) => !dateFrom || (row.createdDateIso && row.createdDateIso >= dateFrom))
        .filter((row) => !dateTo || (row.createdDateIso && row.createdDateIso <= dateTo)),
    [pendingRows, searchTerm, cityFilter, dateFrom, dateTo]
  );

  const cityOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.city).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [allRows]
  );

  const totalRequests = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.requestId))).length,
    [allRows]
  );

  const processedRowsCount = useMemo(
    () => allRows.filter((row) => !canTakePaymentRowAction(row)).length,
    [allRows]
  );

  const filteredRowKeys = useMemo(
    () => filteredRows.map((row) => getPaymentRowKey(row)),
    [filteredRows]
  );

  useEffect(() => {
    setSelectedRowKeys((previous) => previous.filter((key) => filteredRowKeys.includes(key)));
  }, [filteredRowKeys]);

  const allFilteredSelected = filteredRowKeys.length > 0 && filteredRowKeys.every((key) => selectedRowKeys.includes(key));

  const detailsRows = useMemo(
    () => (viewRow ? allRows.filter((row) => row.requestId === viewRow.requestId) : []),
    [allRows, viewRow]
  );

  const runApproveRow = async (row: PaymentRow) => {
    if (!userRef) {
      return;
    }

    if (row.isBulkRequest && Number.isInteger(row.vehicleIndex)) {
      await requestService.updateBulkPaymentVehicles(row.requestId, [Number(row.vehicleIndex)], 'APPROVE', userRef, undefined, row.request);
      return;
    }

    await requestService.approveRequest(row.requestId, userRef, 'PAYMENT');
  };

  const runRejectRow = async (row: PaymentRow, reason: string) => {
    if (!userRef) {
      return;
    }

    if (row.isBulkRequest && Number.isInteger(row.vehicleIndex)) {
      await requestService.updateBulkPaymentVehicles(row.requestId, [Number(row.vehicleIndex)], 'REJECT', userRef, reason, row.request);
      return;
    }

    await requestService.rejectRequest(row.requestId, userRef, 'PAYMENT', reason);
  };

  const handleApproveRow = async (row: PaymentRow) => {
    const rowKey = getPaymentRowKey(row);
    setActioningKeys((current) => (current.includes(rowKey) ? current : [...current, rowKey]));
    try {
      await runApproveRow(row);
      showToast(`Payment approved for ${formatRequestIdDisplay(row.requestId)}.`, 'success');
      setViewRow((current) => (current && getPaymentRowKey(current) === rowKey ? null : current));
    } catch (error) {
      console.error('Payment approve failed', {
        requestId: row.requestId,
        rowKey,
        isBulkRequest: row.isBulkRequest,
        vehicleIndex: row.vehicleIndex,
        userId: userRef?.id,
        userRole: userRef?.role,
        error,
      });
      showToast(formatActionError(error, 'Failed to approve payment row.'), 'error');
    } finally {
      setActioningKeys((current) => current.filter((key) => key !== rowKey));
    }
  };

  const handleRejectRow = async () => {
    if (!rejectRow) {
      return;
    }

    const reason = rejectionReason.trim();
    if (!reason) {
      showToast('Rejection reason is required.', 'error');
      return;
    }

    const rowKey = getPaymentRowKey(rejectRow);
    setActioningKeys((current) => (current.includes(rowKey) ? current : [...current, rowKey]));
    try {
      await runRejectRow(rejectRow, reason);
      showToast(`Payment rejected for ${formatRequestIdDisplay(rejectRow.requestId)}.`, 'success');
      setRejectRow(null);
      setRejectionReason('');
    } catch (error) {
      console.error('Payment reject failed', {
        requestId: rejectRow.requestId,
        rowKey,
        isBulkRequest: rejectRow.isBulkRequest,
        vehicleIndex: rejectRow.vehicleIndex,
        userId: userRef?.id,
        userRole: userRef?.role,
        error,
      });
      showToast(formatActionError(error, 'Failed to reject payment row.'), 'error');
    } finally {
      setActioningKeys((current) => current.filter((key) => key !== rowKey));
    }
  };

  const handleApproveMany = async (rows: PaymentRow[], successLabel: string) => {
    if (!userRef || rows.length === 0) {
      showToast('No payment rows selected.', 'info');
      return;
    }

    const grouped = groupRowsForBulkAction(rows);
    setBulkActioning(true);
    try {
      // Process all groups in parallel — each request is independent. Using
      // allSettled so one failure does not block the remaining approvals.
      const results = await Promise.allSettled(
        grouped.map((group) => {
          if (group.isBulkRequest) {
            return requestService.updateBulkPaymentVehicles(
              group.requestId,
              Array.from(new Set(group.vehicleIndexes)),
              'APPROVE',
              userRef,
              undefined,
              group.request,
            );
          }
          return requestService.approveRequest(group.requestId, userRef, 'PAYMENT');
        }),
      );

      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      if (rejected.length === 0) {
        showToast(`${successLabel}: ${rows.length} row(s) approved.`, 'success');
      } else if (succeeded > 0) {
        showToast(
          `${succeeded} of ${grouped.length} approved. ${rejected.length} failed — check console for details.`,
          'error',
        );
      } else {
        showToast(formatActionError(rejected[0]?.reason, 'Failed to approve selected rows.'), 'error');
      }

      if (rejected.length > 0) {
        console.error('Payment bulk approve partial/full failure', {
          successLabel,
          total: grouped.length,
          succeeded,
          errors: rejected.map((r) => r.reason),
        });
      }

      setSelectedRowKeys([]);
    } catch (error) {
      console.error('Payment bulk approve unexpected error', { error });
      showToast(formatActionError(error, 'Failed to approve selected rows.'), 'error');
    } finally {
      setBulkActioning(false);
    }
  };

  if (loading || tableLoading || !userRef || !isPaymentRole) {
    return <Loader />;
  }

  const displayName = String(userProfile?.name || 'Payment User');
  const displayTitle = String(userProfile?.title || 'Controller');

  return (
    <PaymentConsoleLayout
      activePage="dashboard"
      userName={displayName}
      userTitle={displayTitle}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
      topTitle="Payment Team Console"
      showTopRightLogout={false}
      showSidebarIdentity={false}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase text-slate-500">Total Requests</p>
          <p className="mt-1 text-3xl font-black text-slate-900">{totalRequests}</p>
        </div>
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-primary bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase text-slate-500">Pending Requests</p>
          <p className="mt-1 text-4xl font-black text-primary">{pendingRows.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium uppercase text-slate-500">Processed Requests</p>
          <p className="mt-1 text-3xl font-black text-slate-900">{processedRowsCount}</p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Search</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <span className="material-symbols-outlined text-sm">search</span>
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by Client or ID..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm focus:border-primary focus:ring-primary"
              />
            </div>
          </div>
          <div className="w-48">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">City Filter</label>
            <select
              value={cityFilter}
              onChange={(event) => setCityFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-sm focus:border-primary focus:ring-primary"
            >
              <option value="all">All Cities</option>
              {cityOptions.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-sm focus:border-primary focus:ring-primary"
            />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-sm focus:border-primary focus:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => exportPaymentRowsToCsv(filteredRows, 'dashboard')}
            disabled={filteredRows.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            Download CSV
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={showAdditionalColumns}
              onChange={(event) => setShowAdditionalColumns(event.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-slate-200 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
            <span className="ms-3 text-sm font-medium text-slate-600">Show extra details</span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          Pending Requests
          <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">{filteredRows.length} Actionable</span>
        </h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setSelectedRowKeys([])}
            disabled={selectedRowKeys.length === 0}
            className="rounded-lg border border-slate-300 px-4 py-2 font-bold transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            Clear Selection
          </button>
          <button
            type="button"
            onClick={() => {
              const selectedRows = filteredRows.filter((row) => selectedRowKeys.includes(getPaymentRowKey(row)));
              void handleApproveMany(selectedRows, 'Approve selected');
            }}
            disabled={bulkActioning || selectedRowKeys.length === 0}
            className="rounded-lg border border-primary/30 bg-primary/20 px-4 py-2 font-bold text-primary transition-colors hover:bg-primary/30 disabled:opacity-60"
          >
            Approve Selected
          </button>
          <button
            type="button"
            onClick={() => void handleApproveMany(pendingRows, 'Approve all pending')}
            disabled={bulkActioning || pendingRows.length === 0}
            className="rounded-lg bg-primary px-4 py-2 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Approve All Pending
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className={showAdditionalColumns ? 'overflow-x-auto' : 'overflow-x-hidden'}>
          <table className={`${showAdditionalColumns ? 'min-w-[1600px]' : 'w-full'} border-collapse text-left`}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-12 p-4">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-primary focus:ring-primary"
                    checked={allFilteredSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedRowKeys(filteredRowKeys);
                        return;
                      }
                      setSelectedRowKeys([]);
                    }}
                  />
                </th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Request ID</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Status</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Client</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Vehicle Number</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Service Type</th>
                <th className="p-4 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-700">Service Charge</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Date</th>
                <th className="p-4 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-700">Actions</th>
                {showAdditionalColumns ? (
                  <>
                    <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Location</th>
                    <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Available Time</th>
                    <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">LTPOC</th>
                    <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">LTPOC Phone</th>
                    <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Rejection Reason</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="p-10 text-center text-sm text-slate-500" colSpan={showAdditionalColumns ? 14 : 9}>
                    No payment requests found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const rowKey = getPaymentRowKey(row);
                  const isBusy = bulkActioning || actioningKeys.includes(rowKey);
                  return (
                    <tr key={rowKey} className="transition-colors hover:bg-slate-50/50">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-primary focus:ring-primary"
                          checked={selectedRowKeys.includes(rowKey)}
                          onChange={(event) => {
                            setSelectedRowKeys((current) => {
                              if (event.target.checked) {
                                return current.includes(rowKey) ? current : [...current, rowKey];
                              }
                              return current.filter((key) => key !== rowKey);
                            });
                          }}
                        />
                      </td>
                      <td className="p-4">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{formatRequestIdDisplay(row.requestId)}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPaymentRowStatusClass(row)}`}>
                          {getPaymentRowStatusLabel(row)}
                        </span>
                      </td>
                      <td className="p-4 text-slate-700">{row.clientName || 'N/A'}</td>
                      <td className="p-4 font-mono text-sm">
                        {row.vehicleNumber || 'N/A'}{' '}
                        <span className="font-sans text-[11px] text-slate-500">({row.isBulkRequest ? 'Bulk' : 'Single'})</span>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                          {row.serviceType || 'N/A'}
                        </span>
                      </td>
                      <td className="p-4 text-right text-slate-700">{formatPaymentServiceCharge(row.serviceCost)}</td>
                      <td className="p-4 text-sm text-slate-500">{row.createdDate || 'N/A'}</td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setViewRow(row)}
                            className="rounded border border-primary px-3 py-1 text-[10px] font-bold uppercase transition-colors hover:bg-primary/5"
                            style={{ color: '#f26a21', borderColor: '#f26a21' }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproveRow(row)}
                            disabled={isBusy}
                            className="rounded bg-primary px-3 py-1 text-[10px] font-bold uppercase text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                          >
                            {isBusy ? 'Working...' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectRow(row);
                              setRejectionReason('');
                            }}
                            disabled={isBusy}
                            className="rounded bg-red-600 px-3 py-1 text-[10px] font-bold uppercase text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                      {showAdditionalColumns ? (
                        <>
                          <td className="p-4 text-sm text-slate-600">{row.vehicleAvailabilityLocation || 'N/A'}</td>
                          <td className="p-4 text-sm text-slate-600">{row.vehicleAvailableTime || 'N/A'}</td>
                          <td className="p-4 text-sm text-slate-600">{row.ltpocName || 'N/A'}</td>
                          <td className="p-4 text-sm text-slate-600">{row.ltpocPhone || 'N/A'}</td>
                          <td className="p-4 text-sm text-slate-600">{row.rejectionReason || '—'}</td>
                        </>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 p-4">
          <p className="text-sm text-slate-500">Showing {Math.min(filteredRows.length, filteredRows.length)} of {pendingRows.length} pending requests</p>
          <div className="flex gap-2">
            <button type="button" disabled className="rounded border border-slate-200 px-3 py-1 opacity-50">Previous</button>
            <button type="button" className="rounded border border-primary bg-primary px-3 py-1 text-white">1</button>
            <button type="button" disabled className="rounded border border-slate-200 px-3 py-1 opacity-50">Next</button>
          </div>
        </div>
      </div>

      <Modal isOpen={Boolean(viewRow)} title="" onClose={() => setViewRow(null)} showFooter={false}>
        {viewRow ? (
          <div className="space-y-8">
            <header className="flex items-center justify-between border-b border-slate-100 pb-5">
              <h2 className="text-2xl font-bold tracking-tight text-primary">Payment Verification Details</h2>
              <button type="button" onClick={() => setViewRow(null)} className="group rounded-full p-2 transition-colors hover:bg-red-50">
                <span className="material-symbols-outlined text-slate-400 group-hover:text-red-600">close</span>
              </button>
            </header>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-6">
                <p className="mb-1 text-sm font-medium uppercase tracking-wider text-slate-500">Payment ID</p>
                <p className="text-xl font-bold text-slate-900">{formatRequestIdDisplay(viewRow.requestId)}</p>
              </div>
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-6">
                <p className="mb-1 text-sm font-medium uppercase tracking-wider text-slate-500">Status</p>
                <p className="text-xl font-bold text-slate-900">{getPaymentRowStatusLabel(viewRow)}</p>
              </div>
              <div className="rounded-xl border border-primary/10 bg-primary/5 p-6">
                <p className="mb-1 text-sm font-medium uppercase tracking-wider text-slate-500">Vehicle Count</p>
                <p className="text-xl font-bold text-slate-900">{detailsRows.length} Units</p>
              </div>
            </div>

            <div>
              <h3 className="mb-4 text-lg font-bold uppercase tracking-wide text-primary">Vehicle-Specific Details</h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-3 text-xs font-bold uppercase text-slate-600">Vehicle No.</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase text-slate-600">Type</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase text-slate-600">Cost (INR)</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase text-slate-600">Location</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase text-slate-600">LTPOC Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailsRows.map((row) => (
                      <tr key={getPaymentRowKey(row)} className="transition-colors hover:bg-slate-50/50">
                        <td className="px-4 py-4 text-sm font-semibold text-slate-900">
                          {row.vehicleNumber || 'N/A'}{' '}
                          <span className="text-xs font-medium text-slate-500">({row.isBulkRequest ? 'Bulk' : 'Single'})</span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">{row.serviceType || 'N/A'}</td>
                        <td className="px-4 py-4 text-sm font-bold text-slate-900">{formatPaymentServiceCharge(row.serviceCost)}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{row.vehicleAvailabilityLocation || 'N/A'}</td>
                        <td className="px-4 py-4 text-sm">
                          <div className="font-medium text-slate-900">{row.ltpocName || 'N/A'}</div>
                          <div className="text-xs text-slate-500">{row.ltpocPhone || 'N/A'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-2 py-6">
              <button type="button" onClick={() => setViewRow(null)} className="rounded-lg border border-slate-300 px-6 py-2.5 font-bold text-slate-700 transition-colors hover:bg-slate-100">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectRow(viewRow);
                  setRejectionReason('');
                  setViewRow(null);
                }}
                className="rounded-lg border border-red-200 px-6 py-2.5 font-bold text-red-600 transition-colors hover:bg-red-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => void handleApproveRow(viewRow)}
                disabled={actioningKeys.includes(getPaymentRowKey(viewRow))}
                className="rounded-lg bg-primary px-8 py-2.5 font-bold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                Approve
              </button>
            </footer>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={Boolean(rejectRow)} title="" onClose={() => { setRejectRow(null); setRejectionReason(''); }} showFooter={false}>
        {rejectRow ? (
          <div>
            <header className="flex items-center justify-between border-b border-slate-100 px-1 pb-4">
              <h2 className="text-xl font-bold text-primary">Reject Payment</h2>
              <button type="button" onClick={() => setRejectRow(null)} className="group rounded-full p-2 transition-colors hover:bg-red-50">
                <span className="material-symbols-outlined text-slate-400 group-hover:text-red-600">close</span>
              </button>
            </header>
            <div className="p-1 pt-6">
              <label className="mb-2 block text-sm font-bold text-slate-900">
                Reason for Rejection <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <textarea
                  rows={4}
                  maxLength={500}
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Provide details on why this payment is being rejected..."
                  className="w-full rounded-lg border border-slate-300 p-4 pr-16 text-sm focus:border-primary focus:ring-primary"
                />
                <div className="absolute bottom-3 right-3 text-xs font-medium text-slate-400">
                  {rejectionReason.length} / 500
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">This feedback will be shared with the requesting department.</p>
            </div>
            <footer className="mt-4 flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-1 py-4">
              <button
                type="button"
                onClick={() => {
                  setRejectRow(null);
                  setRejectionReason('');
                }}
                className="rounded-lg px-6 py-2 font-bold text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectRow}
                disabled={actioningKeys.includes(getPaymentRowKey(rejectRow))}
                className="rounded-lg bg-red-600 px-8 py-2 font-bold text-white shadow-lg shadow-red-200 transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                Confirm Reject
              </button>
            </footer>
          </div>
        ) : null}
      </Modal>
    </PaymentConsoleLayout>
  );
};

export default PaymentDashboard;