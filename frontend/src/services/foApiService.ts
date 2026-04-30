import { auth } from './firebase';
import { fetchWithApiFallback } from './apiBase';
import BACKEND_API_URL from '../../../config/api.js';

export type VehicleRecord = {
  vehicleNumber: string;
  city: string;
  clientName: string;
  isRegistered: boolean;
};

export type VehicleValidationResult = {
  vehicleNumber: string;
  isRegistered: boolean;
  city?: string;
  clientName?: string;
};

const DEFAULT_MOCK_VEHICLES: VehicleRecord[] = [];

const normalizeVehicleNumber = (value: string) => value.trim().toUpperCase();
const normalizeVehicleNumberKey = (value: string) => normalizeVehicleNumber(value).replace(/[^A-Z0-9]/g, '');

const fallbackValidation = (vehicleNumber: string): VehicleValidationResult => ({
  vehicleNumber: normalizeVehicleNumber(vehicleNumber),
  isRegistered: false,
  city: '',
  clientName: '',
});

const getAuthHeaders = async () => {
  const currentUser = auth.currentUser;
  const idToken = currentUser ? await currentUser.getIdToken() : '';

  return {
    'Content-Type': 'application/json',
    ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
  };
};

const parseVehicleFromResponse = (payload: unknown): VehicleValidationResult | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const candidate = (source.data as Record<string, unknown> | undefined) ?? source;
  const vehicleNumber = normalizeVehicleNumber(String(candidate.vehicleNumber || source.vehicleNumber || ''));

  if (!vehicleNumber) {
    return null;
  }

  const isRegistered =
    candidate.isRegistered === true ||
    String(candidate.isRegistered || '').toLowerCase() === 'true';

  return {
    vehicleNumber,
    isRegistered,
    city: String(candidate.city || ''),
    clientName: String(candidate.clientName || ''),
  };
};

const fetchJson = async (path: string, init?: RequestInit) => {
  const response = await fetchWithApiFallback(
    path,
    init,
    BACKEND_API_URL,
    import.meta.env.VITE_FO_API_BASE_URL,
    import.meta.env.VITE_API_BASE_URL,
    import.meta.env.VITE_FUNCTIONS_BASE_URL,
  );

  if (!response.ok) {
    throw new Error(`FO API request failed (${response.status})`);
  }

  return response.json();
};

export const foApiService = {
  validateVehicle: async (vehicleNumber: string): Promise<VehicleValidationResult> => {
    const normalizedVehicle = normalizeVehicleNumber(vehicleNumber);

    try {
      const headers = await getAuthHeaders();
      const payload = await fetchJson('/validateVehicle', {
        method: 'POST',
        headers,
        body: JSON.stringify({ vehicleNumber: normalizedVehicle }),
      });

      const parsed = parseVehicleFromResponse(payload);
      return parsed ?? fallbackValidation(normalizedVehicle);
    } catch (error) {
      console.warn('FO API validateVehicle failed, using fallback:', error);
      return fallbackValidation(normalizedVehicle);
    }
  },

  getVehicles: async (): Promise<VehicleRecord[]> => {
    try {
      const headers = await getAuthHeaders();
      const payload = await fetchJson('/vehicles', {
        method: 'GET',
        headers,
      });

      const source = (payload as Record<string, unknown>)?.data ?? payload;
      if (!Array.isArray(source)) {
        return DEFAULT_MOCK_VEHICLES;
      }

      return source
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }

          const vehicle = entry as Record<string, unknown>;
          const vehicleNumber = normalizeVehicleNumber(String(vehicle.vehicleNumber || ''));
          if (!vehicleNumber) {
            return null;
          }

          return {
            vehicleNumber,
            city: String(vehicle.city || ''),
            clientName: String(vehicle.clientName || ''),
            isRegistered:
              vehicle.isRegistered === true ||
              String(vehicle.isRegistered || '').toLowerCase() === 'true',
          } as VehicleRecord;
        })
        .filter((item): item is VehicleRecord => item !== null);
    } catch (error) {
      console.warn('FO API getVehicles failed, using fallback:', error);
      return DEFAULT_MOCK_VEHICLES;
    }
  },
};
