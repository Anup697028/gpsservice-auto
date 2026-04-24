import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { Modal } from '../components/Modal';
import { RolePageLayout } from '../components/RolePageLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { functionsService } from '../services/functionsService';
import { requestService } from '../services/requestService';
import type { UserRef } from '../types/workflow';
import {
  buildFoRowsForRequest,
  buildVendorPendingRowsForRequest,
  canFoNotifyRequest,
  canVendorNotifyRequest,
  formatRequestIdDisplay,
  getRequestStatusLabel,
  getServiceLabel,
  getStatusPillClass,
  getVehicleLabel,
  isVehicleDropped,
  normalizeRole,
  normalizeVehicles,
  requestMatchesSearch,
  RequestWithId,
  sortRequestsNewestFirst,
  toDateInputValue,
  toDisplayDateTime,
} from '../utils/workflowView';

type AuthShape = {
  user: { uid: string; email?: string | null } | null;
  userRole: string | null;
  userProfile: { name?: string | null } | null;
  logout: () => Promise<void>;
  loading: boolean;
};

const csvEscape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const normalizeRequestIdKey = (value: unknown) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) {
    return '';
  }

  const reqMatch = raw.match(/^REQ[-_\s]?0*(\d+)$/);
  if (reqMatch?.[1]) {
    return String(Number(reqMatch[1]));
  }

  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }

  return raw.replace(/[^A-Z0-9]/g, '');
};

const normalizeVehicleNumberKey = (value: unknown) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

type RequestDetailVehicle = Record<string, unknown> & {
  vehicleNumber?: unknown;
  serviceType?: unknown;
  vehicleAvailabilityLocation?: unknown;
  ltpocName: string;
  ltpocPhone: string;
};

const getRequestDetailVehicles = (request: RequestWithId): RequestDetailVehicle[] => {
  const vehicles = normalizeVehicles((request as Record<string, unknown>)?.vehicles);
  const ltpocRows = normalizeVehicles(
    (request as Record<string, unknown>)?.ltpocDetails ||
    (request as Record<string, unknown>)?.lptocDetails
  );
  const fallbackLtpoc =
    ltpocRows.find((row) => String(row?.ltpocName || row?.lptocName || row?.ltpocPhone || row?.lptocPhone || '').trim()) || {};
  const ltpocByVehicle = new Map(
    ltpocRows
      .map((row) => [normalizeVehicleNumberKey(row?.vehicleNumber), row] as const)
      .filter(([vehicleKey]) => Boolean(vehicleKey))
  );

  return vehicles.map((vehicle, index): RequestDetailVehicle => {
    const vehicleNumber = String(vehicle?.vehicleNumber || '');
    const ltpoc =
      ltpocByVehicle.get(normalizeVehicleNumberKey(vehicleNumber)) ||
      ltpocRows[index] ||
      fallbackLtpoc;

    return {
      ...vehicle,
      ltpocName: String(vehicle?.ltpocName || vehicle?.lptocName || ltpoc?.ltpocName || ltpoc?.lptocName || ''),
      ltpocPhone: String(vehicle?.ltpocPhone || vehicle?.lptocPhone || ltpoc?.ltpocPhone || ltpoc?.lptocPhone || ''),
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
    .filter((vehicle) => !isVehicleDropped(vehicle))
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
    request?.serviceType || request?.vendorName || request?.vendorType || getServiceLabel(request)
  );
  const inferredCost = parseServiceCost(resolveCsvServiceCost(inferredType, request?.serviceCost));
  if (inferredCost !== null) {
    return formatServiceCost(inferredCost);
  }

  return 'N/A';
};

const exportVendorDashboardCsv = (requests: RequestWithId[]) => {
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
    'Created At',
  ];

  const rows = requests.flatMap((request) => {
    const requestVehicles = buildVendorPendingRowsForRequest(request);
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
        toDisplayDateTime(request.createdAt),
      ]];
    }

    return requestVehicles.map((vehicle) => {
      const vehicleNumber = String(vehicle?.vehicleNumber || '');
      const serviceType = normalizeCsvServiceType(
        vehicle?.serviceType || request?.serviceType || request?.vendorName || ''
      );
      const serviceCost = resolveCsvServiceCost(serviceType, request?.serviceCost);

      return [
        ...base,
        vehicleNumber,
        serviceType,
        serviceCost,
        String(vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || ''),
        String(vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || ''),
        String(vehicle?.ltpocName || ''),
        String(vehicle?.ltpocPhone || ''),
        toDisplayDateTime(request.createdAt),
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
  anchor.download = `vendor_dashboard_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

type VendorNotifySummary = {
  successfulRequestIds: string[];
  failedRequestIds: string[];
  totalServiceRowsEmailed: number;
  sentVendorGroupCount: number;
};

type FoNotifySummary = {
  successfulRequestIds: string[];
  failedRequestIds: string[];
  rowCount: number;
  groupCount: number;
};

export const VendorDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, logout, loading } = useAuth() as AuthShape;

  const [requests, setRequests] = useState<RequestWithId[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [viewRequest, setViewRequest] = useState<RequestWithId | null>(null);
  const [actioningRequestId, setActioningRequestId] = useState<string | null>(null);
  const [bulkActioning, setBulkActioning] = useState(false);

  const userRef = useMemo<UserRef | null>(() => {
    if (!user) {
      return null;
    }

    return {
      id: user.uid,
      email: user.email ?? null,
      name: userProfile?.name ?? null,
      role: 'VENDOR',
    };
  }, [user, userProfile?.name]);

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

  const actionableRequests = useMemo(
    () => requests.filter((request) => canVendorNotifyRequest(request) || canFoNotifyRequest(request)),
    [requests]
  );

  const visibleRequests = useMemo(
    () =>
      actionableRequests
        .filter((request) => requestMatchesSearch(request, searchTerm))
        .filter((request) => {
          const createdDate = toDateInputValue(request.createdAt);
          if (dateFrom && (!createdDate || createdDate < dateFrom)) {
            return false;
          }
          if (dateTo && (!createdDate || createdDate > dateTo)) {
            return false;
          }
          return true;
        }),
    [actionableRequests, searchTerm, dateFrom, dateTo]
  );

  useEffect(() => {
    const visibleIds = new Set(
      visibleRequests
        .map((request) => String(request.id || '').trim())
        .filter(Boolean)
    );

    setSelectedRequestIds((current) => current.filter((requestId) => visibleIds.has(requestId)));
  }, [visibleRequests]);

  const selectedRequests = useMemo(
    () =>
      visibleRequests.filter((request) => {
        const requestId = String(request.id || '').trim();
        return requestId && selectedRequestIds.includes(requestId);
      }),
    [visibleRequests, selectedRequestIds]
  );

  const allVisibleSelected =
    visibleRequests.length > 0 &&
    visibleRequests.every((request) => {
      const requestId = String(request.id || '').trim();
      return requestId ? selectedRequestIds.includes(requestId) : true;
    });

  const selectedVendorEligibleCount = selectedRequests.filter((request) => canVendorNotifyRequest(request)).length;
  const selectedFoEligibleCount = selectedRequests.filter((request) => canFoNotifyRequest(request)).length;

  const totalPendingCount = actionableRequests.length;

  const vendorPendingCount = useMemo(
    () => actionableRequests.filter((request) => canVendorNotifyRequest(request)).length,
    [actionableRequests]
  );

  const foPendingCount = useMemo(
    () => actionableRequests.filter((request) => canFoNotifyRequest(request)).length,
    [actionableRequests]
  );

  const completedCount = useMemo(
    () => requests.filter((request) => !canVendorNotifyRequest(request) && !canFoNotifyRequest(request)).length,
    [requests]
  );

  const handleDownloadCsv = () => {
    if (visibleRequests.length === 0) {
      showToast('No new requests available for CSV export.', 'info');
      return;
    }
    exportVendorDashboardCsv(visibleRequests);
    showToast(`Downloaded ${visibleRequests.length} dashboard row(s).`, 'success');
  };

  const notifyVendorForRequests = async (requestsToNotify: RequestWithId[]): Promise<VendorNotifySummary> => {
    if (!userRef) {
      throw new Error('User session not available. Please login again.');
    }

    const eligibleRequests = requestsToNotify.filter((request) => {
      const requestId = String(request.id || '').trim();
      return Boolean(requestId) && canVendorNotifyRequest(request);
    });

    if (eligibleRequests.length === 0) {
      throw new Error('Select at least one vendor-eligible request.');
    }

    const groupedByVendor = new Map<
      string,
      {
        requestIds: Set<string>;
        rows: Array<{
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
        }>;
      }
    >();
    const expectedVendorsByRequestId = new Map<string, Set<string>>();
    const failedIds: string[] = [];

    eligibleRequests.forEach((request) => {
      const requestId = String(request.id || '').trim();
      if (!requestId) {
        return;
      }

      const vendorRowsWithMeta = buildVendorPendingRowsForRequest(request);
      if (!Array.isArray(vendorRowsWithMeta) || vendorRowsWithMeta.length === 0) {
        failedIds.push(requestId);
        return;
      }

      const requestVendors = new Set<string>();
      vendorRowsWithMeta.forEach((row) => {
        const vendorName = String(row.vendorName || '').trim();
        if (!vendorName) {
          return;
        }

        requestVendors.add(vendorName);
        const existingGroup = groupedByVendor.get(vendorName) || {
          requestIds: new Set<string>(),
          rows: [],
        };

        existingGroup.requestIds.add(requestId);
        const { vendorName: _vendorName, ...payloadRow } = row;
        existingGroup.rows.push(payloadRow);
        groupedByVendor.set(vendorName, existingGroup);
      });

      if (requestVendors.size === 0) {
        failedIds.push(requestId);
        return;
      }

      expectedVendorsByRequestId.set(requestId, requestVendors);
    });

    if (groupedByVendor.size === 0) {
      throw new Error('Unable to build consolidated vendor payload for selected request(s).');
    }

    const requestVendorsSent = new Map<string, Set<string>>();
    const requestIdByKey = new Map<string, string>();

    eligibleRequests.forEach((request) => {
      const requestId = String(request.id || '').trim();
      const key = normalizeRequestIdKey(requestId);
      if (requestId && key) {
        requestIdByKey.set(key, requestId);
      }
    });
    let sentVendorGroupCount = 0;
    let totalServiceRowsEmailed = 0;

    for (const [vendorName, group] of groupedByVendor.entries()) {
      try {
        const response = await functionsService.sendVendorBulkNotification({
          vendorName,
          requestIds: [...group.requestIds],
          rows: group.rows,
        });

        const sentRows = Number(response?.count ?? 0);
        const sentRequestIds = Array.isArray(response?.requestIds)
          ? response.requestIds.map((requestId) => String(requestId || '').trim()).filter(Boolean)
          : [];

        if (response?.alreadySent === true || sentRows <= 0 || sentRequestIds.length === 0) {
          continue;
        }

        totalServiceRowsEmailed += sentRows;
        sentVendorGroupCount += 1;

        sentRequestIds.forEach((requestId) => {
          const requestIdKey = normalizeRequestIdKey(requestId);
          const resolvedRequestId = requestIdByKey.get(requestIdKey) || requestId;
          const existing = requestVendorsSent.get(resolvedRequestId) || new Set<string>();
          existing.add(vendorName);
          requestVendorsSent.set(resolvedRequestId, existing);
        });
      } catch (error) {
        console.error(`Vendor consolidated notification failed for ${vendorName}`, error);
      }
    }

    const finalizeItems: Array<{ requestId: string; vendorName: string; isBulkRequest: boolean }> = [];

    for (const request of eligibleRequests) {
      const requestId = String(request.id || '').trim();
      if (!requestId) {
        continue;
      }

      const expectedVendors = expectedVendorsByRequestId.get(requestId) || new Set<string>();
      if (expectedVendors.size === 0) {
        failedIds.push(requestId);
        continue;
      }

      const sentVendors = requestVendorsSent.get(requestId) || new Set<string>();
      const fullySent = [...expectedVendors].every((vendorName) => sentVendors.has(vendorName));
      if (!fullySent) {
        failedIds.push(requestId);
        continue;
      }

      const workflowVendorName = sentVendors.size === 1 ? [...sentVendors][0] : 'Mixed';

      finalizeItems.push({
        requestId,
        vendorName: workflowVendorName,
        isBulkRequest: Boolean(request.isBulkRequest),
      });
    }

    const successfulRequestIds: string[] = [];
    if (finalizeItems.length > 0) {
      try {
        const finalizeResponse = await functionsService.finalizeVendorNotifications({
          items: finalizeItems,
        });

        const finalizedRequestIds = Array.isArray(finalizeResponse?.updatedRequestIds)
          ? finalizeResponse.updatedRequestIds.map((requestId: string) => String(requestId || '').trim()).filter(Boolean)
          : finalizeItems.map((item) => item.requestId);

        const finalizedSet = new Set(finalizedRequestIds);
        successfulRequestIds.push(...finalizedRequestIds);

        finalizeItems.forEach((item) => {
          if (!finalizedSet.has(item.requestId)) {
            failedIds.push(item.requestId);
          }
        });
      } catch (error) {
        console.error('Vendor workflow finalize failed', error);
        finalizeItems.forEach((item) => failedIds.push(item.requestId));
      }
    }

    const uniqueSuccessfulIds = [...new Set(successfulRequestIds)];
    const uniqueFailedIds = [...new Set(failedIds)].filter((requestId) => !uniqueSuccessfulIds.includes(requestId));

    return {
      successfulRequestIds: uniqueSuccessfulIds,
      failedRequestIds: uniqueFailedIds,
      totalServiceRowsEmailed,
      sentVendorGroupCount,
    };
  };

  const notifyFoForRequests = async (requestsToNotify: RequestWithId[]): Promise<FoNotifySummary> => {
    const eligibleRequests = requestsToNotify.filter((request) => {
      const requestId = String(request.id || '').trim();
      return Boolean(requestId) && canFoNotifyRequest(request);
    });

    if (eligibleRequests.length === 0) {
      throw new Error('Select at least one FO-eligible request.');
    }

    const rows = eligibleRequests.flatMap((request) => buildFoRowsForRequest(request));
    const requestIds = [
      ...new Set(eligibleRequests.map((request) => String(request.id || '').trim()).filter(Boolean)),
    ];

    if (rows.length === 0 || requestIds.length === 0) {
      throw new Error('Unable to build consolidated FO payload for selected request(s).');
    }

    const response = await functionsService.sendFoBulkNotification({
      requestIds,
      rows,
    });

    const requestIdByKey = new Map<string, string>();
    requestIds.forEach((requestId) => {
      const key = normalizeRequestIdKey(requestId);
      if (key) {
        requestIdByKey.set(key, requestId);
      }
    });

    const sentRequestIds = Array.isArray(response?.requestIds)
      ? response.requestIds
          .map((requestId) => {
            const normalized = normalizeRequestIdKey(requestId);
            return requestIdByKey.get(normalized) || String(requestId || '').trim();
          })
          .filter(Boolean)
      : response?.alreadySent === true
        ? []
        : requestIds;

    const sentSet = new Set(sentRequestIds);
    const failedRequestIds = requestIds.filter((requestId) => !sentSet.has(requestId));

    return {
      successfulRequestIds: sentRequestIds,
      failedRequestIds,
      rowCount: Number(response?.rowCount ?? rows.length),
      groupCount: Number(response?.groupCount ?? 0),
    };
  };

  const handleNotifyVendor = async (request: RequestWithId) => {
    const requestId = String(request.id || '').trim();
    if (!requestId) {
      return;
    }

    setActioningRequestId(requestId);
    try {
      const result = await notifyVendorForRequests([request]);
      if (result.successfulRequestIds.includes(requestId)) {
        showToast(
          `Vendor notified for request ${formatRequestIdDisplay(requestId)} (${result.totalServiceRowsEmailed} service row(s), ${result.sentVendorGroupCount} vendor group(s)).`,
          'success'
        );
      } else {
        showToast('No vendor email was sent for this request.', 'error');
      }
    } catch (error) {
      showToast((error as Error).message || 'Failed to notify vendor.', 'error');
    } finally {
      setActioningRequestId(null);
    }
  };

  const handleNotifyFo = async (request: RequestWithId) => {
    const requestId = String(request.id || '').trim();
    if (!requestId) {
      return;
    }

    setActioningRequestId(requestId);
    try {
      const result = await notifyFoForRequests([request]);
      if (result.successfulRequestIds.includes(requestId)) {
        showToast(`FO notified for request ${formatRequestIdDisplay(requestId)}.`, 'success');
      } else {
        showToast('No FO email was sent for this request.', 'error');
      }
    } catch (error) {
      showToast((error as Error).message || 'Failed to notify FO.', 'error');
    } finally {
      setActioningRequestId(null);
    }
  };

  const handleBulkNotifyVendor = async () => {
    const eligible = selectedRequests.filter((request) => canVendorNotifyRequest(request));
    if (eligible.length === 0) {
      showToast('Select at least one vendor-eligible request.', 'info');
      return;
    }

    setBulkActioning(true);
    try {
      const result = await notifyVendorForRequests(eligible);
      const successCount = result.successfulRequestIds.length;
      const failedCount = result.failedRequestIds.length;

      setSelectedRequestIds(result.failedRequestIds);

      if (successCount > 0 && failedCount === 0) {
        showToast(
          `Consolidated vendor notification sent for ${successCount} request(s), ${result.totalServiceRowsEmailed} service row(s), across ${result.sentVendorGroupCount} vendor group(s).`,
          'success'
        );
        return;
      }

      if (successCount > 0) {
        showToast(
          `Consolidated vendor emails sent for ${successCount} request(s). ${failedCount} request(s) failed and remain selected.`,
          'error'
        );
        return;
      }

      showToast('Unable to notify vendors for selected request(s).', 'error');
    } catch (error) {
      showToast((error as Error).message || 'Failed to notify selected requests.', 'error');
    } finally {
      setActioningRequestId(null);
      setBulkActioning(false);
    }
  };

  const handleBulkNotifyFo = async () => {
    const eligible = selectedRequests.filter((request) => canFoNotifyRequest(request));
    if (eligible.length === 0) {
      showToast('Select at least one FO-eligible request.', 'info');
      return;
    }

    setBulkActioning(true);
    try {
      const result = await notifyFoForRequests(eligible);
      const successCount = result.successfulRequestIds.length;
      const failedCount = result.failedRequestIds.length;

      setSelectedRequestIds(result.failedRequestIds);

      if (successCount > 0 && failedCount === 0) {
        showToast(`Consolidated FO notification sent for ${successCount} request(s).`, 'success');
        return;
      }

      if (successCount > 0) {
        showToast(
          `Consolidated FO emails sent for ${successCount} request(s). ${failedCount} request(s) failed and remain selected.`,
          'error'
        );
        return;
      }

      showToast('Unable to notify FO for selected request(s).', 'error');
    } catch (error) {
      showToast((error as Error).message || 'Failed to notify selected requests.', 'error');
    } finally {
      setActioningRequestId(null);
      setBulkActioning(false);
    }
  };

  if (loading || tableLoading || !userRef || !isVendorRole) {
    return <Loader />;
  }

  return (
    <RolePageLayout
      role="VENDOR"
      activePage="dashboard"
      title="Vendor Coordinator Console"
      subtitle="New actionable requests only"
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={false}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="min-h-[96px] rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Pending</p>
          <p className="mt-1 text-[2rem] font-bold leading-none text-slate-900">{totalPendingCount}</p>
        </article>
        <article className="min-h-[96px] rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">FO Pending</p>
          <p className="mt-1 text-[2rem] font-bold leading-none text-slate-900">{foPendingCount}</p>
        </article>
        <article className="min-h-[96px] rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Completed</p>
          <p className="mt-1 text-[2rem] font-bold leading-none text-slate-900">{completedCount}</p>
        </article>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Request ID, Client, or City..."
              className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-primary focus:ring-primary"
            />
          </div>

          <div className="w-36">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-primary focus:ring-primary"
            />
          </div>

          <div className="w-36">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-primary focus:ring-primary"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="rounded-lg border-0 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            >
              Clear Dates
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="rounded-lg border-0 bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-tighter text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            >
              Download CSV
            </button>
          </div>
        </div>
      </section>

      {selectedRequestIds.length > 0 ? (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-4">
              <span className="text-xs font-bold text-slate-700">{selectedRequestIds.length} Items Selected</span>
              <div className="h-3 w-px bg-primary/20" />
              <button
                type="button"
                onClick={() => void handleBulkNotifyVendor()}
                disabled={bulkActioning || selectedVendorEligibleCount === 0}
                className="rounded border-0 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
              >
                {bulkActioning ? 'Processing...' : `Bulk Notify Vendor (${selectedVendorEligibleCount})`}
              </button>
              <button
                type="button"
                onClick={() => void handleBulkNotifyFo()}
                disabled={bulkActioning || selectedFoEligibleCount === 0}
                className="rounded border-0 bg-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-tighter text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
              >
                {bulkActioning ? 'Processing...' : `Notify FO (${selectedFoEligibleCount})`}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSelectedRequestIds([])}
              disabled={bulkActioning}
              className="rounded border-0 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-50"
            >
              Clear Selection
            </button>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-primary/10 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="border-b border-primary/10 bg-primary/5">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-primary focus:ring-primary"
                    checked={allVisibleSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedRequestIds(
                          visibleRequests
                            .map((request) => String(request.id || '').trim())
                            .filter(Boolean)
                        );
                        return;
                      }

                      setSelectedRequestIds([]);
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Request ID</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Status</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Client</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Service Type</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Vehicle Number</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Service Cost</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black">Date</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-black text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-primary/5">
              {visibleRequests.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={9}>
                    No new vendor requests found.
                  </td>
                </tr>
              ) : (
                visibleRequests.map((request, index) => {
                  const requestId = String(request.id || '').trim();
                  const statusLabel = getRequestStatusLabel(request);
                  const canVendorNotify = canVendorNotifyRequest(request);
                  const canFoNotify = canFoNotifyRequest(request);
                  const isBusy = actioningRequestId === request.id || bulkActioning;
                  const vehicleLabel = getVehicleLabel(request);
                  const requestTypeLabel = request?.isBulkRequest ? '(Bulk)' : '(Single)';
                  const serviceCostLabel = getRequestServiceCostLabel(request);

                  return (
                    <tr key={request.id || `vendor-dashboard-${index}`} className="align-top transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-primary focus:ring-primary"
                          checked={requestId ? selectedRequestIds.includes(requestId) : false}
                          disabled={!requestId || bulkActioning}
                          onChange={(event) => {
                            if (!requestId) {
                              return;
                            }

                            setSelectedRequestIds((current) => {
                              if (event.target.checked) {
                                return current.includes(requestId) ? current : [...current, requestId];
                              }
                              return current.filter((id) => id !== requestId);
                            });
                          }}
                        />
                      </td>
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
                      <td className="px-4 py-3 text-sm text-slate-700">{toDisplayDateTime(request.createdAt)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setViewRequest(request)}
                            className="rounded border-0 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                          >
                            View
                          </button>

                          {canVendorNotify ? (
                            <button
                              type="button"
                              onClick={() => handleNotifyVendor(request)}
                              disabled={isBusy}
                              className="rounded border-0 bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-60"
                            >
                              {isBusy ? 'Sending...' : 'Notify Vendor'}
                            </button>
                          ) : null}

                          {canFoNotify ? (
                            <button
                              type="button"
                              onClick={() => handleNotifyFo(request)}
                              disabled={isBusy}
                              className="rounded border-0 bg-primary px-2 py-1 text-[10px] font-bold uppercase tracking-tighter text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:opacity-60"
                            >
                              {isBusy ? 'Sending...' : 'Notify FO'}
                            </button>
                          ) : null}
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
      </div>

      <Modal
        isOpen={Boolean(viewRequest)}
        title="Vendor Request Details"
        subtitle={viewRequest?.id ? `Request ${formatRequestIdDisplay(viewRequest.id)}` : 'Request details'}
        onClose={() => setViewRequest(null)}
        showFooter={false}
      >
        {viewRequest ? (
          <div className="space-y-4 text-sm">
            {(() => {
              const activeVehicles = getRequestDetailVehicles(viewRequest).filter((vehicle) => !isVehicleDropped(vehicle));
              return (
                <>
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
                    {activeVehicles.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-slate-500" colSpan={4}>No vehicle rows available.</td>
                      </tr>
                    ) : (
                      activeVehicles.map((vehicle, index) => (
                        <tr key={`${String(vehicle.vehicleNumber || '')}-${index}`}>
                          <td className="px-3 py-2 text-slate-700">{String(vehicle.vehicleNumber || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String(vehicle.serviceType || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String(vehicle.vehicleAvailabilityLocation || 'N/A')}</td>
                          <td className="px-3 py-2 text-slate-700">{String(vehicle.ltpocName || 'N/A')} {vehicle.ltpocPhone ? `(${String(vehicle.ltpocPhone)})` : ''}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-[11px] text-slate-500">Created: {toDisplayDateTime(viewRequest.createdAt)}</div>
                </>
              );
            })()}
          </div>
        ) : null}
      </Modal>
    </RolePageLayout>
  );
};
