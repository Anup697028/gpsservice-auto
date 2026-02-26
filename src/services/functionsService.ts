import { functions } from './firebase';
import type { RequestRecord } from '../types/workflow';

type OtpPayload = {
  email: string;
  otp: string;
};

type VendorNotificationPayload = {
  requestId: string;
  vendorName: string;
  clientName?: string | null;
  city?: string | null;
  destination?: string | null;
  serviceType?: string | null;
  serviceCost?: number | null;
  tripFromDate?: string | null;
  tripFromTime?: string | null;
  tripToDate?: string | null;
  tripToTime?: string | null;
  vehicles?: RequestRecord['vehicles'];
  driverDetails?: RequestRecord['driverDetails'];
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
};
