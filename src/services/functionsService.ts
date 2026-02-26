import { auth, functions } from './firebase';
import type { RequestRecord } from '../types/workflow';

type OtpPayload = {
  email: string;
  otp: string;
};

type VendorNotificationPayload = {
  requestId: string;
  vendorName: string;
  foEmail?: string | null;
  clientName?: string | null;
  city?: string | null;
  serviceType?: string | null;
  vehicleAvailabilityLocation?: string | null;
  vehicleAvailableTime?: string | null;
  vehicles?: RequestRecord['vehicles'];
  ltpocDetails?: RequestRecord['ltpocDetails'];
  vehicleCount?: number;
  isBulkRequest?: boolean;
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

// Allow env override, otherwise dev uses local server and prod uses deployed Functions.
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_BASE_URL
  ? import.meta.env.VITE_FUNCTIONS_BASE_URL
  : import.meta.env.DEV
  ? 'http://localhost:3001'
  : 'https://us-central1-gps-integration-b1a2e.cloudfunctions.net';

export const functionsService = {
  sendOTP: async (payload: OtpPayload) => {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/sendOTP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error('Failed to send OTP');
    }
    
    return await response.json();
  },

  sendVendorNotification: async (payload: VendorNotificationPayload) => {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/sendVendorNotification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error('Failed to send vendor notification');
    }
    
    return await response.json();
  },

  sendVendorBulkNotification: async (payload: VendorBulkNotificationPayload) => {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/sendVendorBulkNotification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to send vendor bulk notification');
    }

    return await response.json();
  },

  sendFoBulkNotification: async (payload: FoBulkNotificationPayload) => {
    const currentUser = auth.currentUser;
    const idToken = currentUser ? await currentUser.getIdToken() : '';

    const response = await fetch(`${FUNCTIONS_BASE_URL}/sendFoBulkNotification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to send FO bulk notification');
    }

    return await response.json();
  },
};
