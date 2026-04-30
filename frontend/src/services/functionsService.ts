import { auth } from './firebase';
import { fetchWithApiFallback } from './apiBase';
import BACKEND_API_URL from '../../../config/api.js';

type OtpPayload = {
  email: string;
  otp: string;
};

type VendorBulkNotificationRow = {
  requestId: string;
  city?: string | null;
  clientName?: string | null;
  date?: string | null;
  serviceType?: string | null;
  vehicleNumber?: string | null;
  vehicleAvailabilityLocation?: string | null;
  vehicleAvailableTime?: string | null;
  ltpocName?: string | null;
  ltpocPhone?: string | null;
  ltpocEmail?: string | null;
  lpoAdditional?: string | null;
};

type VendorBulkNotificationPayload = {
  vendorName: string;
  requestIds?: string[];
  rows: VendorBulkNotificationRow[];
};

type VendorWorkflowFinalizePayload = {
  items: Array<{
    requestId: string;
    vendorName?: string;
    isBulkRequest?: boolean;
  }>;
};

type FoBulkNotificationPayload = {
  requestIds: string[];
  foEmail?: string;
  foName?: string;
  rows: Array<{
    requestId: string;
    status: string;
    city: string;
    clientName: string;
    serviceType: string;
    serviceCost: number | '';
    vehicleNumber: string;
    vehicleAvailabilityLocation: string;
    vehicleAvailableTime: string;
    ltpocName: string;
    ltpocPhone: string;
    lpoAdditional: string;
    createdAt: string;
  }>;
};

type BulkPaymentActionPayload = {
  requestId: string;
  vehicleIndexes: number[];
  action: 'APPROVE' | 'REJECT';
  rejectionReason?: string;
};

type FoCancelPayload = {
  requestId: string;
};

type FoRemoveBulkVehiclePayload = {
  requestId: string;
  vehicleNumber: string;
};

type RhRejectPayload = {
  requestId: string;
  rejectionReason: string;
};

type RhRemoveBulkVehiclePayload = {
  requestId: string;
  vehicleNumber: string;
};

type RhRejectSingleVehiclePayload = {
  requestId: string;
  vehicleNumber: string;
};

type RhDirectoryEntry = {
  id: string;
  email: string;
};

const apiFetch = async (path: string, init: RequestInit) =>
  fetchWithApiFallback(path, init, BACKEND_API_URL, import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_FUNCTIONS_BASE_URL);

const parseApiError = async (response: Response, fallbackMessage: string) => {
  const responseData = await response.json().catch(() => ({}));
  const message =
    (responseData && typeof responseData === 'object' && 'details' in responseData && String((responseData as { details?: unknown }).details || '').trim())
    || (responseData && typeof responseData === 'object' && 'error' in responseData && String((responseData as { error?: unknown }).error || '').trim())
    || fallbackMessage;

  return { message, responseData };
};

const parseRhDirectoryRows = (responseData: unknown): RhDirectoryEntry[] => {
  const payloadRows =
    responseData && typeof responseData === 'object' && Array.isArray((responseData as { data?: unknown }).data)
      ? ((responseData as { data: unknown[] }).data ?? [])
      : [];

  return payloadRows
    .map((entry) => {
      const source = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const email = String(source.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return null;
      }

      const id = String(source.id || email).trim() || email;
      return {
        id,
        email,
      } as RhDirectoryEntry;
    })
    .filter((entry): entry is RhDirectoryEntry => entry !== null);
};

const requestRhDirectory = async (idToken: string): Promise<RhDirectoryEntry[]> => {
  const response = await apiFetch('/listRhDirectory', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });

  const responseData = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (responseData && typeof responseData === 'object' && 'details' in responseData && String((responseData as { details?: unknown }).details || '').trim())
      || (responseData && typeof responseData === 'object' && 'error' in responseData && String((responseData as { error?: unknown }).error || '').trim())
      || 'Failed to fetch RH directory';
    throw new Error(message);
  }

  return parseRhDirectoryRows(responseData);
};

export const functionsService = {
  sendOTP: async (payload: OtpPayload) => {
    const response = await apiFetch('/sendOTP', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to send OTP');
      throw new Error(message);
    }
    
    return await response.json();
  },

  listRhDirectory: async (): Promise<RhDirectoryEntry[]> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    return await requestRhDirectory(idToken);
  },

  sendVendorBulkNotification: async (payload: VendorBulkNotificationPayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/sendVendorBulkNotification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to send vendor bulk notification');
      throw new Error(message);
    }

    return await response.json();
  },

  finalizeVendorNotifications: async (payload: VendorWorkflowFinalizePayload) => {
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken() : '';

    const response = await apiFetch('/finalizeVendorNotifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to finalize vendor notifications');
      throw new Error(message);
    }

    return await response.json();
  },

  sendFoBulkNotification: async (payload: FoBulkNotificationPayload) => {
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken() : '';

    const response = await apiFetch('/sendFoBulkNotification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to send FO bulk notification');
      throw new Error(message);
    }

    return await response.json();
  },

  applyBulkPaymentAction: async (payload: BulkPaymentActionPayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/applyBulkPaymentAction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to apply bulk payment action');
      throw new Error(message);
    }

    return await response.json();
  },

  foCancelRequest: async (payload: FoCancelPayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/foCancelRequest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to cancel request');
      throw new Error(message);
    }

    return await response.json();
  },

  foRemoveBulkVehicle: async (payload: FoRemoveBulkVehiclePayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/foRemoveBulkVehicle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to remove vehicle from bulk request');
      throw new Error(message);
    }

    return await response.json();
  },

  rhRejectRequest: async (payload: RhRejectPayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/rhRejectRequest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to reject request');
      throw new Error(message);
    }

    return await response.json();
  },

  rhRemoveBulkVehicle: async (payload: RhRemoveBulkVehiclePayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/rhRemoveBulkVehicle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to remove vehicle from bulk request');
      throw new Error(message);
    }

    return await response.json();
  },

  rhRejectSingleVehicle: async (payload: RhRejectSingleVehiclePayload) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/rhRejectSingleVehicle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to reject single vehicle');
      throw new Error(message);
    }

    return await response.json();
  },

  rhApproveRequest: async (payload: { requestId: string }) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Session expired. Please log in again.');
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await apiFetch('/rhApproveRequest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { message } = await parseApiError(response, 'Failed to approve request');
      throw new Error(message);
    }

    return await response.json();
  },
};
