import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { PaymentConsoleLayout } from '../components/PaymentConsoleLayout';
import { useAuth } from '../context/AuthContext';
import { requestService } from '../services/requestService';
import {
  buildPaymentRowsForRequest,
  canTakePaymentRowAction,
  exportPaymentRowsToCsv,
  formatPaymentServiceCharge,
  getPaymentRowKey,
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

const matchesPaymentHistorySearch = (row: PaymentRow, searchTerm: string) => {
  const normalized = String(searchTerm || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [row.requestId, row.clientName, row.city, row.vehicleNumber, row.serviceType]
    .some((value) => String(value || '').toLowerCase().includes(normalized));
};

const PaymentHistory: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;
  const initialFilters = useMemo(() => loadPaymentSharedFilters(), []);

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm);
  const [cityFilter, setCityFilter] = useState(initialFilters.cityFilter);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'rejected'>('all');
  const [viewRow, setViewRow] = useState<PaymentRow | null>(null);

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

  const historyRows = useMemo(
    () => allRows.filter((row) => !canTakePaymentRowAction(row)),
    [allRows]
  );

  const visibleRows = useMemo(
    () =>
      historyRows
        .filter((row) => matchesPaymentHistorySearch(row, searchTerm))
        .filter((row) => cityFilter === 'all' || row.city === cityFilter)
        .filter((row) => !dateFrom || (row.createdDateIso && row.createdDateIso >= dateFrom))
        .filter((row) => !dateTo || (row.createdDateIso && row.createdDateIso <= dateTo))
        .filter((row) => {
          if (statusFilter === 'approved') {
            return row.rowPaymentApproved;
          }
          if (statusFilter === 'rejected') {
            return row.rowPaymentRejected;
          }
          return true;
        }),
    [historyRows, searchTerm, cityFilter, dateFrom, dateTo, statusFilter]
  );

  const cityOptions = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.city).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
    [allRows]
  );

  const detailsRows = useMemo(
    () => (viewRow ? allRows.filter((row) => row.requestId === viewRow.requestId) : []),
    [allRows, viewRow]
  );

  if (loading || tableLoading || !isPaymentRole) {
    return <Loader />;
  }

  const displayName = String(userProfile?.name || 'Payment User');
  const displayTitle = String(userProfile?.title || 'Controller');

  return (
    <PaymentConsoleLayout
      activePage="history"
      userName={displayName}
      userTitle={displayTitle}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
      topTitle="Payment History"
      showTopRightLogout={false}
      showSidebarIdentity={false}
      contentClassName="p-4 md:p-8"
    >
      <header className="pb-4">
        <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Payment History</h2>
        <p className="mt-1 text-sm text-slate-600">Review and audit all finalized transactions across the network.</p>
      </header>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
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
          <div className="w-48">
            <label className="mb-1 block text-xs font-bold uppercase text-slate-500">Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | 'approved' | 'rejected')}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 text-sm font-medium text-slate-700 focus:border-primary focus:ring-primary"
            >
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => exportPaymentRowsToCsv(visibleRows, 'history')}
            disabled={visibleRows.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">download</span>
            Download CSV
          </button>
        </div>
      </section>

      <section className="flex-1 overflow-auto py-8">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Request ID</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Status</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Client</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Vehicle Number</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Service Type</th>
                <th className="p-4 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-700">Service Charge</th>
                <th className="p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Date</th>
                <th className="p-4 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-700">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 ? (
                <tr>
                  <td className="p-10 text-center text-sm text-slate-500" colSpan={8}>
                    No payment history records found.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={getPaymentRowKey(row)} className="transition-colors hover:bg-slate-50/50">
                    <td className="p-4">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{formatRequestIdDisplay(row.requestId)}</span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold ${row.rowPaymentApproved ? 'bg-emerald-100 text-emerald-700' : row.rowPaymentRejected ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                        {getPaymentRowStatusLabel(row).toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-slate-700">{row.clientName || 'N/A'}</td>
                    <td className="p-4 font-mono text-sm text-slate-900">{row.vehicleNumber || 'N/A'}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                        {row.serviceType || 'N/A'}
                      </span>
                    </td>
                    <td className="p-4 text-right text-slate-700">{formatPaymentServiceCharge(row.serviceCost)}</td>
                    <td className="p-4 text-sm text-slate-500">{row.createdDate || 'N/A'}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => setViewRow(row)}
                        className="rounded border border-primary px-3 py-1 text-[10px] font-bold uppercase text-primary transition-colors hover:bg-primary/5"
                      >
                        View
                      </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs font-bold uppercase text-slate-500">Showing 1 to {visibleRows.length} of {historyRows.length} transactions</p>
          <div className="flex gap-2">
            <button type="button" disabled className="rounded border border-slate-200 px-3 py-1 opacity-50">Previous</button>
            <button type="button" className="rounded border border-primary bg-primary px-3 py-1 text-white">1</button>
            <button type="button" disabled className="rounded border border-slate-200 px-3 py-1 opacity-50">Next</button>
          </div>
        </div>
      </section>

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
                        <td className="px-4 py-4 text-sm font-semibold text-slate-900">{row.vehicleNumber || 'N/A'}</td>
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
            </footer>
          </div>
        ) : null}
      </Modal>
    </PaymentConsoleLayout>
  );
};

export default PaymentHistory;