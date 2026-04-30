import { auth } from './firebase';
import { functionsService } from './functionsService';
import { fetchWithApiFallback } from './apiBase';
import BACKEND_API_URL from '../../../config/api.js';
import {
  WORKFLOW_ACTIONS,
  type RequestRecord,
  type UserRef,
} from '../types/workflow';
import { updateRequestState } from './workflowService';

const REQUEST_POLL_INTERVAL_MS = 4000;
const LEGACY_RH_FALLBACK_EMAIL = 'anupgogeri697@gmail.com';

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const toMillis = (value: unknown) => {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const maybeDate = (value as { toDate?: () => Date })?.toDate?.();
  if (maybeDate instanceof Date) {
    return maybeDate.getTime();
  }

  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortRequestsByCreatedAtDesc = <T extends RequestRecord & { id?: string }>(requests: T[]) =>
  [...requests].sort(
    (left, right) => toMillis((right as Record<string, unknown>).createdAt) - toMillis((left as Record<string, unknown>).createdAt)
  );

const getAuthHeaders = async (includeJson = true) => {
  const token = auth.currentUser ? await auth.currentUser.getIdToken(true) : '';
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const apiRequest = async (path: string, init: RequestInit = {}) => {
  const headers = await getAuthHeaders(!((init.method || 'GET').toUpperCase() === 'GET'));
  const response = await fetchWithApiFallback(
    path,
    {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {}),
      },
    },
    BACKEND_API_URL,
    import.meta.env.VITE_API_BASE_URL,
    import.meta.env.VITE_FUNCTIONS_BASE_URL,
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String((payload as { details?: unknown; error?: unknown })?.details || (payload as { error?: unknown })?.error || `Request failed (${response.status})`);
    throw new Error(message);
  }

  return payload;
};

const normalizeRequestRecord = (row: Record<string, unknown>): RequestRecord => {
  const requestId = String(row.id || row.requestId || '').trim();
  const requestSequence = Number(row.requestSequence || row.numericId || 0);
  const requestDisplayId = String(row.requestDisplayId || row.requestId || requestId || '').trim();
  const vehicles = Array.isArray(row.vehicles) ? (row.vehicles as Array<Record<string, unknown>>) : [];
  const ltpocDetails = Array.isArray(row.ltpocDetails)
    ? (row.ltpocDetails as Array<Record<string, unknown>>)
    : Array.isArray(row.lptocDetails)
    ? (row.lptocDetails as Array<Record<string, unknown>>)
    : [];

  const normalizedVehicles: NonNullable<RequestRecord['vehicles']> = vehicles.map((vehicle) => {
    const ltpocName = String(vehicle.ltpocName ?? vehicle.lptocName ?? '').trim();
    const ltpocPhone = String(vehicle.ltpocPhone ?? vehicle.lptocPhone ?? '').trim();
    const vehicleNumber = String(vehicle.vehicleNumber || '').trim();

    return {
      ...vehicle,
      vehicleNumber,
      ltpocName,
      ltpocPhone,
    } as NonNullable<RequestRecord['vehicles']>[number];
  });

  const normalizedLtpocDetails: NonNullable<RequestRecord['ltpocDetails']> = ltpocDetails.map((entry) => ({
    ...entry,
    vehicleNumber: String(entry.vehicleNumber || '').trim(),
    ltpocName: String(entry.ltpocName ?? entry.lptocName ?? '').trim(),
    ltpocPhone: String(entry.ltpocPhone ?? entry.lptocPhone ?? '').trim(),
  }));

  return {
    ...(row as RequestRecord),
    id: requestId,
    requestSequence: Number.isFinite(requestSequence) ? requestSequence : 0,
    requestDisplayId: requestDisplayId || requestId,
    vehicles: normalizedVehicles,
    ltpocDetails: normalizedLtpocDetails,
  };
};

const fetchAllRequests = async (): Promise<RequestRecord[]> => {
  const payload = await apiRequest('/requests?limit=10000', { method: 'GET' });
  const rows = Array.isArray((payload as { requests?: unknown[] }).requests)
    ? ((payload as { requests: unknown[] }).requests ?? [])
    : [];

  const normalized = rows
    .map((row) => (row && typeof row === 'object' ? normalizeRequestRecord(row as Record<string, unknown>) : null))
    .filter((row): row is RequestRecord => row !== null);

  return sortRequestsByCreatedAtDesc(normalized);
};

const createPollingSubscription = (
  loader: () => Promise<RequestRecord[]>,
  callback: (requests: RequestRecord[]) => void,
  onError?: (error: Error) => void
) => {
  let active = true;
  let timer: number | null = null;

  const run = async () => {
    try {
      const rows = await loader();
      if (active) {
        callback(rows);
      }
    } catch (error) {
      if (active && onError) {
        onError(error as Error);
      }
    } finally {
      if (active && typeof window !== 'undefined') {
        timer = window.setTimeout(run, REQUEST_POLL_INTERVAL_MS);
      }
    }
  };

  void run();

  return () => {
    active = false;
    if (timer !== null && typeof window !== 'undefined') {
      window.clearTimeout(timer);
    }
  };
};

const isFoScopedRequest = (request: RequestRecord, uid: string, normalizedEmail: string, rawEmail: string) => {
  const requestAny = request as Record<string, unknown>;
  const createdBy = String(requestAny.createdBy || '').trim();
  const createdByEmail = normalizeEmail(requestAny.createdByEmail);
  const createdByEmailRaw = String(requestAny.createdByEmail || '').trim();
  const assignedFoId = String(requestAny.assignedFoId || '').trim();
  const foId = String(requestAny.foId || '').trim();

  const foEmail = normalizeEmail(requestAny.foEmail);
  const assignedFoEmail = normalizeEmail(requestAny.assignedFoEmail);
  const foEmailRaw = String(requestAny.foEmail || '').trim();
  const assignedFoEmailRaw = String(requestAny.assignedFoEmail || '').trim();

  if (uid && (createdBy === uid || assignedFoId === uid || foId === uid)) {
    return true;
  }

  if (normalizedEmail && createdByEmail === normalizedEmail) {
    return true;
  }

  if (normalizedEmail && (foEmail === normalizedEmail || assignedFoEmail === normalizedEmail)) {
    return true;
  }

  if (rawEmail && createdByEmailRaw === rawEmail) {
    return true;
  }

  if (rawEmail && (foEmailRaw === rawEmail || assignedFoEmailRaw === rawEmail)) {
    return true;
  }

  return false;
};

const isRhScopedRequest = (request: RequestRecord, uid: string, normalizedEmail: string, rawEmail: string) => {
  const requestAny = request as Record<string, unknown>;
  const assignedRhUserId = String(requestAny.assignedRhUserId || '').trim();
  const assignedRhEmail = normalizeEmail(requestAny.assignedRhEmail);
  const assignedRhEmailRaw = String(requestAny.assignedRhEmail || '').trim();

  if (uid && assignedRhUserId === uid) {
    return true;
  }

  if (normalizedEmail && assignedRhEmail === normalizedEmail) {
    return true;
  }

  if (rawEmail && assignedRhEmailRaw === rawEmail) {
    return true;
  }

  if (normalizedEmail === LEGACY_RH_FALLBACK_EMAIL && !assignedRhUserId && !assignedRhEmail) {
    return true;
  }

  return false;
};

const requestApiCreate = async (payload: Record<string, unknown>) => {
  const response = await apiRequest('/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return response as {
    success?: boolean;
    request?: Record<string, unknown>;
    requestId?: string;
  };
};

export const requestService = {
  generateRequestId: () => `TEMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,

  createRequest: async (requestData: RequestRecord, user: UserRef, requestId?: string) => {
    const { updates, historyEntry } = updateRequestState(
      null,
      WORKFLOW_ACTIONS.CREATE,
      user,
      { isBulkRequest: requestData.isBulkRequest }
    );

    const payload = {
      ...requestData,
      ...updates,
      id: requestId || null,
      createdBy: user.id,
      createdByEmail: user.email ?? null,
      history: [historyEntry],
    };

    const created = await requestApiCreate(payload as Record<string, unknown>);
    return String(created?.request?.id || created?.requestId || requestId || '');
  },

  getRequestById: async (requestId: string) => {
    const payload = await apiRequest(`/requests/${encodeURIComponent(String(requestId || '').trim())}`, { method: 'GET' });
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    return normalizeRequestRecord(payload as Record<string, unknown>);
  },

  getAllRequests: async () => fetchAllRequests(),

  subscribeToAllRequests: (callback: (requests: RequestRecord[]) => void, onError?: (error: Error) => void) =>
    createPollingSubscription(fetchAllRequests, callback, onError),

  subscribeToUserRequests: (
    userId: string,
    callback: (requests: RequestRecord[]) => void,
    onError?: (error: Error) => void,
    userEmail?: string | null | undefined
  ) =>
    createPollingSubscription(
      async () => {
        const all = await fetchAllRequests();
        const uid = String(userId || '').trim();
        const rawEmail = String(userEmail || auth.currentUser?.email || '').trim();
        const normalizedEmail = normalizeEmail(rawEmail);

        return all.filter((request) => {
          const requestAny = request as Record<string, unknown>;
          const createdBy = String(requestAny.createdBy || '').trim();
          const createdByEmail = normalizeEmail(requestAny.createdByEmail);
          const assignedFoId = String(requestAny.assignedFoId || '').trim();
          const assignedFoEmail = normalizeEmail(requestAny.assignedFoEmail);

          if (uid && (createdBy === uid || assignedFoId === uid)) {
            return true;
          }

          if (normalizedEmail && (createdByEmail === normalizedEmail || assignedFoEmail === normalizedEmail)) {
            return true;
          }

          if (rawEmail && String(requestAny.createdByEmail || '').trim().toLowerCase() === rawEmail.toLowerCase()) {
            return true;
          }

          return false;
        });
      },
      callback,
      onError
    ),

  subscribeToFoRequests: (
    userId: string,
    email: string | null | undefined,
    callback: (requests: RequestRecord[]) => void,
    onError?: (error: Error) => void
  ) =>
    createPollingSubscription(
      async () => {
        const all = await fetchAllRequests();
        const uid = String(userId || '').trim();
        const rawEmail = String(email || '').trim();
        const normalizedEmail = normalizeEmail(email);

        return all.filter((request) => isFoScopedRequest(request, uid, normalizedEmail, rawEmail));
      },
      callback,
      onError
    ),

  subscribeToRhRequests: (
    userId: string,
    email: string | null | undefined,
    callback: (requests: RequestRecord[]) => void,
    onError?: (error: Error) => void
  ) =>
    createPollingSubscription(
      async () => {
        const all = await fetchAllRequests();
        const uid = String(userId || '').trim();
        const rawEmail = String(email || '').trim();
        const normalizedEmail = normalizeEmail(email);

        return all.filter((request) => isRhScopedRequest(request, uid, normalizedEmail, rawEmail));
      },
      callback,
      onError
    ),

  approveRequest: async (requestId: string, _user: UserRef, role: 'RH' | 'PAYMENT') => {
    if (role === 'RH') {
      await functionsService.rhApproveRequest({ requestId });
      return;
    }

    await apiRequest('/paymentApproveRequest', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
  },

  rejectRequest: async (
    requestId: string,
    _user: UserRef,
    role: 'RH' | 'PAYMENT',
    rejectionReason: string
  ) => {
    if (role === 'RH') {
      await functionsService.rhRejectRequest({ requestId, rejectionReason });
      return;
    }

    await apiRequest('/paymentRejectRequest', {
      method: 'POST',
      body: JSON.stringify({ requestId, rejectionReason }),
    });
  },

  editAndApprove: async (
    requestId: string,
    updatedData: Record<string, unknown>,
    user: UserRef,
    role: 'RH' | 'PAYMENT'
  ) => {
    if (role === 'RH') {
      await apiRequest('/rhEditApproveRequest', {
        method: 'POST',
        body: JSON.stringify({ requestId, updates: updatedData }),
      });
      return;
    }

    await requestService.approveRequest(requestId, user, 'PAYMENT');
  },

  approveBulkRequest: async (requestId: string, _user: UserRef) => {
    await functionsService.rhApproveRequest({ requestId });
  },

  rejectBulkRequest: async (requestId: string, rejectionReason: string, _user: UserRef) => {
    await functionsService.rhRejectRequest({ requestId, rejectionReason });
  },

  updateBulkPaymentVehicles: async (
    requestId: string,
    vehicleIndexes: number[],
    action: 'APPROVE' | 'REJECT',
    _user: UserRef,
    rejectionReason?: string,
    _existingData?: RequestRecord
  ) => {
    await functionsService.applyBulkPaymentAction({
      requestId,
      vehicleIndexes,
      action,
      ...(action === 'REJECT' && rejectionReason ? { rejectionReason } : {}),
    });
  },

  removeBulkVehicle: async (requestId: string, vehicleNumber: string, _user: UserRef) => {
    await functionsService.foRemoveBulkVehicle({ requestId, vehicleNumber });
  },

  rhRejectSingleVehicle: async (requestId: string, vehicleNumber: string, _user: UserRef) => {
    await functionsService.rhRejectSingleVehicle({ requestId, vehicleNumber });
  },

  cancelRequest: async (requestId: string, _user: UserRef) => {
    await functionsService.foCancelRequest({ requestId });
  },
};
