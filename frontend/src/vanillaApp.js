import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { auth } from './services/firebase';
import { requestService } from './services/requestService';
import { functionsService } from './services/functionsService';
import { foApiService } from './services/foApiService';
import { fetchWithApiFallback } from './services/apiBase';
import { REQUEST_STATUSES } from './types/workflow';
import { getUnifiedStatusClass, getUnifiedStatusLabel } from './utils/statusMapping';

const normalizePhoneForStorage = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

const REQUEST_ID_SEQUENCE_STORAGE_KEY = 'requestIdSequenceMapV3';

const isLegacyNonNumericRequestId = (raw) => {
  if (!raw) {
    return false;
  }

  if (/^REQ[-_\s]?\d+$/i.test(raw)) {
    return false;
  }

  return !/^\d+$/.test(raw);
};

const loadRequestIdSequenceStore = () => {
  if (typeof window === 'undefined') {
    return { createdAtById: {}, seqById: {}, backendSeqById: {} };
  }

  try {
    const rawStored = window.localStorage.getItem(REQUEST_ID_SEQUENCE_STORAGE_KEY);
    if (!rawStored) {
      return { createdAtById: {}, seqById: {}, backendSeqById: {} };
    }

    const parsed = JSON.parse(rawStored);
    const createdAtById = parsed?.createdAtById && typeof parsed.createdAtById === 'object'
      ? parsed.createdAtById
      : {};
    const seqById = parsed?.seqById && typeof parsed.seqById === 'object'
      ? parsed.seqById
      : {};
    const backendSeqById = parsed?.backendSeqById && typeof parsed.backendSeqById === 'object'
      ? parsed.backendSeqById
      : {};

    return { createdAtById, seqById, backendSeqById };
  } catch {
    return { createdAtById: {}, seqById: {}, backendSeqById: {} };
  }
};

const saveRequestIdSequenceStore = (store) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(REQUEST_ID_SEQUENCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage failures and continue rendering.
  }
};

const recomputeRequestIdSequence = (createdAtById) => {
  const entries = Object.entries(createdAtById)
    .filter(([key]) => Boolean(key))
    .sort((left, right) => {
      const leftTs = Number(left[1] || 0);
      const rightTs = Number(right[1] || 0);
      if (leftTs === rightTs) {
        return left[0].localeCompare(right[0]);
      }
      return leftTs - rightTs;
    });

  const seqById = {};
  entries.forEach(([key], index) => {
    seqById[key] = index + 1;
  });

  return seqById;
};

const getRequestTimestampForSequence = (request) => {
  const toMillis = (value) => {
    if (!value) {
      return 0;
    }

    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    if (typeof value?.toDate === 'function') {
      const converted = value.toDate();
      if (converted instanceof Date) {
        const timestamp = converted.getTime();
        return Number.isNaN(timestamp) ? 0 : timestamp;
      }
    }

    if (typeof value === 'number' || typeof value === 'string') {
      const converted = new Date(value);
      const timestamp = converted.getTime();
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }

    if (typeof value === 'object') {
      const seconds = Number(value?.seconds ?? value?._seconds);
      const nanoseconds = Number(value?.nanoseconds ?? value?._nanoseconds ?? 0);
      if (Number.isFinite(seconds)) {
        const millis = seconds * 1000 + (Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0);
        if (millis > 0) {
          return millis;
        }
      }

      const milliseconds = Number(value?.milliseconds ?? value?._milliseconds);
      if (Number.isFinite(milliseconds) && milliseconds > 0) {
        return milliseconds;
      }
    }

    return 0;
  };

  const created = toMillis(request?.createdAt);
  if (created > 0) {
    return created;
  }

  const updated = toMillis(request?.updatedAt);
  if (updated > 0) {
    return updated;
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  if (history.length > 0) {
    const latest = history[history.length - 1];
    const fromHistory = toMillis(latest?.timestamp);
    if (fromHistory > 0) {
      return fromHistory;
    }
  }

  return Number.MAX_SAFE_INTEGER;
};

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

const getBackendRequestSequence = (request) => {
  const fromSequence = toPositiveInteger(request?.requestSequence);
  if (fromSequence > 0) {
    return fromSequence;
  }

  const fromNumericId = toPositiveInteger(request?.numericId);
  if (fromNumericId > 0) {
    return fromNumericId;
  }

  const fromDisplay = String(request?.requestDisplayId || '').trim();
  const match = fromDisplay.toUpperCase().match(/^REQ[-_\s]?(\d+)$/);
  if (match?.[1]) {
    return toPositiveInteger(match[1]);
  }

  return 0;
};

const seedRequestIdSequenceFromRequests = (requests) => {
  if (!Array.isArray(requests) || requests.length === 0) {
    return;
  }

  const store = loadRequestIdSequenceStore();
  let changed = false;

  requests.forEach((request) => {
    const rawId = String(request?.id || '').trim();
    if (!isLegacyNonNumericRequestId(rawId)) {
      return;
    }

    const backendSequence = getBackendRequestSequence(request);
    if (backendSequence > 0 && Number(store.backendSeqById[rawId] || 0) !== backendSequence) {
      store.backendSeqById[rawId] = backendSequence;
      changed = true;
    }

    const timestamp = getRequestTimestampForSequence(request);
    const existing = Number(store.createdAtById[rawId] || 0);
    if (!existing || timestamp < existing) {
      store.createdAtById[rawId] = timestamp;
      changed = true;
    }
  });

  if (!changed) {
    return;
  }

  store.seqById = recomputeRequestIdSequence(store.createdAtById);
  saveRequestIdSequenceStore(store);
};

const formatRequestIdDisplay = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'N/A';
  }

  const reqMatch = raw.toUpperCase().match(/^REQ[-_\s]?(\d+)$/);
  if (reqMatch?.[1]) {
    return `REQ-${reqMatch[1].padStart(5, '0')}`;
  }

  if (/^\d+$/.test(raw)) {
    return `REQ-${raw.padStart(5, '0')}`;
  }

  if (!isLegacyNonNumericRequestId(raw)) {
    return raw;
  }

  const store = loadRequestIdSequenceStore();
  const backendSequence = Number(store.backendSeqById[raw] || 0);
  if (backendSequence > 0) {
    return `REQ-${String(backendSequence).padStart(5, '0')}`;
  }

  if (!store.createdAtById[raw]) {
    store.createdAtById[raw] = Number.MAX_SAFE_INTEGER;
    store.seqById = recomputeRequestIdSequence(store.createdAtById);
    saveRequestIdSequenceStore(store);
  }

  const sequence = Number(store.seqById[raw] || 0) || 1;
  return `REQ-${String(sequence).padStart(5, '0')}`;
};

const FO_MAJOR_CITIES = [
  'Mumbai',
  'Delhi',
  'Bangalore',
  'Hyderabad',
  'Ahmedabad',
  'Chennai',
  'Kolkata',
  'Pune',
  'Jaipur',
  'Surat',
  'Lucknow',
  'Kanpur',
  'Nagpur',
  'Indore',
  'Thane',
  'Bhopal',
  'Visakhapatnam',
  'Patna',
  'Vadodara',
  'Ghaziabad',
  'Ludhiana',
  'Agra',
  'Nashik',
  'Faridabad',
  'Meerut',
  'Rajkot',
  'Varanasi',
  'Srinagar',
  'Aurangabad',
  'Coimbatore',
  'Madurai',
  'Raipur',
  'Kochi',
  'Mysuru',
  'Vijayawada',
  'Jodhpur',
  'Chandigarh',
  'Noida',
  'Gurugram',
  'Navi Mumbai',
];

const FO_REQUEST_FILTER_ORDER = ['all', 'pending', 'completed', 'cancelled'];
const PAYMENT_STATUS_FILTERS = ['ALL', 'APPROVED', 'REJECTED'];

const DEFAULT_COMPANY_LOGO_URL = '/company-logo.svg';
const COMPANY_LOGO_URL =
  String(import.meta.env.VITE_COMPANY_LOGO_URL || DEFAULT_COMPANY_LOGO_URL).trim() ||
  DEFAULT_COMPANY_LOGO_URL;

const REQUESTS_COLLECTION = 'requests';
const RH_USERS_COLLECTION = 'users';
const RH_MEMBER_CACHE_KEY = 'gps.rhMembers.v1';
const DEFAULT_RH_EMAILS = ['anupgogeri697@gmail.com'];

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const LEGACY_RH_FALLBACK_EMAIL = normalizeEmail(DEFAULT_RH_EMAILS[0] || '');
const ROLE_CACHE_PREFIX = 'gps.role.cache.';
const VALID_ROLES = new Set(['FO', 'RH', 'PAYMENT', 'VENDOR', 'ADMIN']);

const normalizeRoleValue = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_ROLES.has(normalized) ? normalized : '';
};

const readCachedRole = (uid) => {
  if (typeof window === 'undefined' || !window.localStorage || !uid) {
    return '';
  }

  try {
    return normalizeRoleValue(window.localStorage.getItem(`${ROLE_CACHE_PREFIX}${uid}`));
  } catch {
    return '';
  }
};

const writeCachedRole = (uid, role) => {
  const normalizedRole = normalizeRoleValue(role);
  if (typeof window === 'undefined' || !window.localStorage || !uid || !normalizedRole) {
    return;
  }

  try {
    window.localStorage.setItem(`${ROLE_CACHE_PREFIX}${uid}`, normalizedRole);
  } catch {
    // ignore cache write failures
  }
};

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timerId = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timerId = globalThis.setTimeout(
          () => reject(new Error(timeoutMessage || 'Operation timed out')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timerId !== null) {
      globalThis.clearTimeout(timerId);
    }
  }
};

const AUTH_ERROR_MESSAGES = {
  'auth/quota-exceeded': 'Too many password verification attempts were made. Sign-in is temporarily blocked. Wait 30-60 minutes or use Forgot password.',
  'auth/too-many-requests': 'Too many sign-in attempts. Sign-in is temporarily blocked on this network. Wait 30-60 minutes or use Forgot password.',
  'auth/network-request-failed': 'Network error while contacting Firebase. Check your internet and try again.',
  'auth/invalid-credential': 'Invalid email or password. Please check your credentials and try again.',
  'auth/invalid-login-credentials': 'Invalid email or password. Please check your credentials and try again.',
  'auth/wrong-password': 'Invalid email or password. Please check your credentials and try again.',
  'auth/user-not-found': 'Invalid email or password. Please check your credentials and try again.',
  'auth/user-disabled': 'This account is disabled. Please contact your administrator.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/missing-password': 'Please enter your password.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this Firebase project.',
  'auth/invalid-api-key': 'Firebase configuration is invalid. Please verify environment variables.',
  'auth/internal-error': 'Authentication service error. Please try again in a moment.',
  'auth/email-already-in-use': 'This email is already registered. Please log in instead.',
  'auth/weak-password': 'Password is too weak. Please use at least 6 characters.',
};

const getAuthErrorMessage = (error, mode = 'login') => {
  const code = String(error?.code || '').trim();
  if (AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }

  const explicitMessage = String(error?.message || '').trim();
  if (!code && explicitMessage) {
    return explicitMessage;
  }

  const rawMessage = String(error?.message || '').toLowerCase();
  if (rawMessage.includes('quota-exceeded')) {
    return AUTH_ERROR_MESSAGES['auth/quota-exceeded'];
  }

  if (code.startsWith('auth/')) {
    const shortCode = code.replace('auth/', '').replace(/-/g, ' ');
    return mode === 'register'
      ? `Registration failed (${shortCode}). Please try again.`
      : `Login failed (${shortCode}). Please try again.`;
  }

  return mode === 'register' ? 'Registration failed. Please try again.' : 'Authentication failed. Please try again.';
};

const getRhDisplayName = (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return '';
  }

  const localPart = normalizedEmail.split('@')[0] || normalizedEmail;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const readRhMembersCache = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(RH_MEMBER_CACHE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => {
        const email = normalizeEmail(entry?.email || entry);
        if (!email) {
          return null;
        }

        return {
          id: entry?.id ? String(entry.id) : null,
          email,
          displayName: String(entry?.displayName || getRhDisplayName(email)),
          isRegistered: entry?.isRegistered !== false,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const saveRhMembersCache = (members) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    const payload = Array.isArray(members)
      ? members
          .map((member) => {
            const email = normalizeEmail(member?.email);
            if (!email) {
              return null;
            }

            return {
              id: member?.id ? String(member.id) : null,
              email,
              displayName: String(member?.displayName || getRhDisplayName(email)),
              isRegistered: member?.isRegistered !== false,
            };
          })
          .filter(Boolean)
      : [];

    window.localStorage.setItem(RH_MEMBER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // no-op: cache is a best-effort optimization
  }
};

const buildRhMembers = (members = []) => {
  const membersByEmail = new Map();

  const addMember = (candidate, fallbackRegistered = true) => {
    const email = normalizeEmail(typeof candidate === 'string' ? candidate : candidate?.email);
    if (!email) {
      return;
    }

    const existing = membersByEmail.get(email);
    const candidateRegistered =
      typeof candidate === 'string' ? fallbackRegistered : candidate?.isRegistered ?? fallbackRegistered;

    membersByEmail.set(email, {
      id: typeof candidate === 'string' ? existing?.id || null : candidate?.id || existing?.id || null,
      email,
      displayName:
        String(
          (typeof candidate === 'string' ? '' : candidate?.displayName) ||
            existing?.displayName ||
            getRhDisplayName(email)
        ) || email,
      isRegistered: Boolean(existing?.isRegistered || candidateRegistered),
    });
  };

  DEFAULT_RH_EMAILS.forEach((email) => addMember({ email, isRegistered: true }, true));
  readRhMembersCache().forEach((member) => addMember(member, member?.isRegistered !== false));
  (Array.isArray(members) ? members : []).forEach((member) => addMember(member, true));

  return Array.from(membersByEmail.values()).sort((left, right) =>
    String(left.email || '').localeCompare(String(right.email || ''))
  );
};

const createFoLtpocEntry = () => ({
  vehicleNumber: '',
  ltpocName: '',
  ltpocPhone: '',
});

const createFoBulkDetail = (serviceType = 'FleetX') => ({
  serviceType,
  vehicleAvailabilityLocation: '',
  vehicleAvailableTime: '',
  ltpocName: '',
  ltpocPhone: '',
});

const createFoFormState = () => ({
  city: 'Mumbai',
  clientName: '',
  assignedRhEmail: DEFAULT_RH_EMAILS[0] || '',
  vehicleInput: '',
  serviceType: 'FleetX',
  vehicleAvailabilityLocation: '',
  vehicleAvailableTime: '',
  selectedVehicles: [],
  ltpocDetails: [createFoLtpocEntry()],
  bulkVehicleDetails: {},
});

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderCompanyLogo = ({ className = 'stitch-brand-logo', alt = 'lets transport logo' } = {}) => `
  <span class="${escapeHtml(className)}">
    <img src="${escapeHtml(COMPANY_LOGO_URL)}" alt="${escapeHtml(alt)}" />
  </span>
`;

const renderSidebarBrand = () => `
  <div class="stitch-sidebar-brand">
    ${renderCompanyLogo({ className: 'stitch-brand-logo' })}
    <span class="stitch-brand-logo-text">lets transport</span>
  </div>
`;

const normalizeVehicleNumberKey = (value) => String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

const normalizeVehicleNumber = (value) => {
  return String(value || '').trim().toUpperCase();
};

const getFoTripLabel = (vehicle) => (vehicle?.isRegistered ? 'Old Trip' : 'New Trip');

const getFoRequestCounts = (requests) => {
  const total = requests.length;
  const completed = requests.filter((request) => getStatus(request) === REQUEST_STATUSES.COMPLETED).length;
  const pending = requests.filter((request) => {
    const status = getStatus(request);
    return status !== REQUEST_STATUSES.COMPLETED && status !== REQUEST_STATUSES.HALTED && status !== REQUEST_STATUSES.CANCELLED;
  }).length;

  return { total, pending, completed };
};

const applyFoRequestFilter = (rows, filter) => {
  if (filter === 'pending') {
    return rows.filter((request) => {
      const status = getStatus(request);
      return status !== REQUEST_STATUSES.COMPLETED && status !== REQUEST_STATUSES.HALTED && status !== REQUEST_STATUSES.CANCELLED;
    });
  }

  if (filter === 'completed') {
    return rows.filter((request) => getStatus(request) === REQUEST_STATUSES.COMPLETED);
  }

  if (filter === 'cancelled') {
    return rows.filter((request) => {
      const status = getStatus(request);
      return status === REQUEST_STATUSES.HALTED || status === REQUEST_STATUSES.CANCELLED;
    });
  }

  return rows;
};

const state = {
  user: null,
  role: null,
  requests: [],
  searchTerm: '',
  loading: true,
  authBusy: false,
  authMode: 'login',
  error: '',
  notice: '',
  unsubscribeRequests: null,
  unsubscribeRhMembers: null,
  pendingRegistration: null,
  rhMembers: buildRhMembers(),
  foForm: createFoFormState(),
  foCancelRequestId: null,
  foCancelVehicleNumber: '',
  foBusy: false,
  foView: 'dashboard',
  foRequestFilter: 'all',
  rhView: 'dashboard',
  rhCityFilter: 'all',
  rhClientFilter: 'all',
  rhDateFilter: '',
  rhSelectedRequestIds: [],
  rhModalRequestId: null,
  rhModalView: 'details',
  rhEditClientName: '',
  rhEditCity: '',
  rhRejectReason: '',
  rhBusy: false,
  paymentView: 'dashboard',
  paymentCityFilter: 'all',
  paymentDateFrom: '',
  paymentDateTo: '',
  paymentStatusFilter: 'ALL',
  paymentSelectedRowKeys: [],
  paymentModalRequestId: null,
  paymentModalVehicleIndex: null,
  paymentRejectRequestId: null,
  paymentRejectVehicleIndex: null,
  paymentRejectReason: '',
  paymentShowAdditionalColumns: false,
  paymentBusy: false,
  vendorView: 'dashboard',
  vendorDateFrom: '',
  vendorDateTo: '',
  vendorSelectedRequestIds: [],
  vendorModalRequestId: null,
  vendorBusy: false,
};

const resetRhUiState = () => {
  state.rhView = 'dashboard';
  state.rhCityFilter = 'all';
  state.rhClientFilter = 'all';
  state.rhDateFilter = '';
  state.rhSelectedRequestIds = [];
  state.rhModalRequestId = null;
  state.rhModalView = 'details';
  state.rhEditClientName = '';
  state.rhEditCity = '';
  state.rhRejectReason = '';
  state.rhBusy = false;
};

const resetPaymentUiState = () => {
  state.paymentView = 'dashboard';
  state.paymentCityFilter = 'all';
  state.paymentDateFrom = '';
  state.paymentDateTo = '';
  state.paymentStatusFilter = 'ALL';
  state.paymentSelectedRowKeys = [];
  state.paymentModalRequestId = null;
  state.paymentModalVehicleIndex = null;
  state.paymentRejectRequestId = null;
  state.paymentRejectVehicleIndex = null;
  state.paymentRejectReason = '';
  state.paymentShowAdditionalColumns = false;
  state.paymentBusy = false;
};

const resetVendorUiState = () => {
  state.vendorView = 'dashboard';
  state.vendorDateFrom = '';
  state.vendorDateTo = '';
  state.vendorSelectedRequestIds = [];
  state.vendorModalRequestId = null;
  state.vendorBusy = false;
};

const ROLE_LABEL = {
  FO: 'Field Operator',
  RH: 'Regional Head',
  PAYMENT: 'Payment Team',
  VENDOR: 'Vendor Coordinator',
};

const ROLE_ICON = {
  FO: '⚡',
  RH: '🧭',
  PAYMENT: '💳',
  VENDOR: '🚚',
};

const ROLE_SUBTITLE = {
  FO: 'Create and track GPS requests for field operations.',
  RH: 'Review and approve requests pending regional compliance.',
  PAYMENT: 'Verify payment approvals and handle billing actions.',
  VENDOR: 'Coordinate vendor notifications and FO handover.',
};

const normalizeVendorName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fleetx') return 'FleetX';
  if (normalized === 'wheelseye') return 'WheelsEye';
  return null;
};

const resolveVendorNameForRequest = (request) => {
  const direct = normalizeVendorName(request?.serviceType || request?.vendorType || request?.vendorName);
  if (direct) {
    return direct;
  }

  const vehicles = normalizeVehicles(request);
  for (const vehicle of vehicles) {
    const mapped = normalizeVendorName(vehicle?.serviceType || vehicle?.vendorName);
    if (mapped) {
      return mapped;
    }
  }

  return null;
};

const resolveVehicleLtpoc = (request, vehicleNumber) => {
  const ltpocRows = normalizeVehicles({ vehicles: request?.ltpocDetails });
  if (!Array.isArray(ltpocRows) || ltpocRows.length === 0) {
    return null;
  }

  const targetVehicle = normalizeVehicleNumberKey(vehicleNumber);
  return (
    ltpocRows.find(
      (ltpoc) => normalizeVehicleNumberKey(ltpoc?.vehicleNumber || '') === targetVehicle
    ) || null
  );
};

const LEGACY_STATUS_TO_UNIFIED = {
  [REQUEST_STATUSES.FO_CREATED]: REQUEST_STATUSES.PARALLEL_REVIEW,
  [REQUEST_STATUSES.PAYMENT_PENDING]: REQUEST_STATUSES.PARALLEL_REVIEW,
  [REQUEST_STATUSES.PAYMENT_APPROVED]: REQUEST_STATUSES.VENDOR_COORDINATION,
  [REQUEST_STATUSES.SERVICE_INITIATED]: REQUEST_STATUSES.COMPLETED,
};

const normalizeStatusValue = (value) => String(value || '').trim().toUpperCase();

const normalizeWorkflowStatus = (status) => {
  const normalized = normalizeStatusValue(status);
  if (!normalized) {
    return null;
  }
  return LEGACY_STATUS_TO_UNIFIED[normalized] || normalized;
};

const normalizeVehicles = (request) => {
  const raw = request?.vehicles;
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === 'object') {
    return Object.keys(raw)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => raw[key] || {});
  }

  return [];
};

const normalizeRecordList = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => value[key] || {});
  }

  return [];
};

const toBooleanFlag = (value) => {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return false;
};

const normalizeServiceType = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'fleetx') {
    return 'FleetX';
  }
  if (normalized === 'wheelseye') {
    return 'WheelsEye';
  }
  return String(value || '').trim();
};

const parseServiceCostValue = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const sanitized = String(value)
    .trim()
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '');

  if (!sanitized) {
    return null;
  }

  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const getServiceCostByType = (serviceType, fallbackCost = null) => {
  const parsedFallback = parseServiceCostValue(fallbackCost);
  if (parsedFallback !== null) {
    return parsedFallback;
  }

  const normalized = normalizeServiceType(serviceType);
  if (normalized === 'FleetX') {
    return 3000;
  }
  if (normalized === 'WheelsEye') {
    return 2000;
  }

  return null;
};

const getPaymentRejectionReason = (request, vehicle = null) => {
  const fromVehicle = String(vehicle?.paymentRejectionReason || '').trim();
  if (fromVehicle) {
    return fromVehicle;
  }

  const fromRequest = String(request?.rejectionReason || '').trim();
  if (fromRequest) {
    return fromRequest;
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] || {};
    const action = normalizeStatusValue(entry?.action);
    if (!action.includes('PAYMENT') || !action.includes('REJECT')) {
      continue;
    }

    const notes = String(entry?.notes || '').trim();
    if (!notes) {
      continue;
    }

    const reasonMatch = notes.match(/Reason:\s*(.+)$/i);
    if (reasonMatch?.[1]) {
      return reasonMatch[1].trim();
    }

    return notes;
  }

  return '';
};

const hasVendorEligibleVehicles = (request) => {
  if (!request?.isBulkRequest) {
    return true;
  }

  const vehicles = normalizeVehicles(request);
  if (vehicles.length === 0) {
    return true;
  }

  const hasPaymentSignals = vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined
  );

  if (!hasPaymentSignals) {
    return true;
  }

  return vehicles.some((vehicle) => vehicle?.paymentApproved === true && vehicle?.paymentRejected !== true);
};

const getRhDecision = (request) => {
  const explicit = normalizeStatusValue(request?.rhStatus);
  if (explicit === 'APPROVED' || explicit === 'REJECTED') {
    return explicit;
  }

  if (request?.rhApproval === true) {
    return 'APPROVED';
  }

  if (request?.rhActionTaken === true && String(request?.status || '').toUpperCase() === REQUEST_STATUSES.HALTED) {
    return 'REJECTED';
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const action = normalizeStatusValue(history[index]?.action);
    if (['RH_APPROVE', 'RH_EDIT_APPROVE', 'RH_BULK_APPROVE'].includes(action)) {
      return 'APPROVED';
    }
    if (['RH_REJECT', 'RH_BULK_REJECT'].includes(action)) {
      return 'REJECTED';
    }
  }

  return 'PENDING';
};

const getPaymentDecision = (request) => {
  const explicit = normalizeStatusValue(request?.paymentStatus);
  if (explicit === 'APPROVED' || explicit === 'REJECTED') {
    return explicit;
  }

  if (request?.paymentRejected === true) {
    return 'REJECTED';
  }

  if (request?.paymentApproval === true || request?.paymentApproved === true) {
    return 'APPROVED';
  }

  if (request?.paymentActionTaken === true && request?.paymentApproval !== true) {
    return 'REJECTED';
  }

  return 'PENDING';
};

const getStatus = (request) => {
  const explicitStatus = normalizeWorkflowStatus(request?.status);
  if (explicitStatus) {
    return explicitStatus;
  }

  const rhDecision = getRhDecision(request);
  const paymentDecision = getPaymentDecision(request);

  if (rhDecision === 'REJECTED' || paymentDecision === 'REJECTED') {
    return REQUEST_STATUSES.HALTED;
  }

  if (request?.foNotified === true) {
    return REQUEST_STATUSES.COMPLETED;
  }

  if (
    request?.vendorNotified === true ||
    request?.approvedByVendor === true ||
    normalizeStatusValue(request?.vendorStatus) === 'NOTIFIED'
  ) {
    return REQUEST_STATUSES.VENDOR_COORDINATION;
  }

  if (paymentDecision === 'APPROVED') {
    return REQUEST_STATUSES.VENDOR_COORDINATION;
  }

  return REQUEST_STATUSES.PARALLEL_REVIEW;
};

const getVehicleCount = (request) => {
  const declaredCount = Number(request?.vehicleCount);
  if (Number.isFinite(declaredCount) && declaredCount > 0) {
    return declaredCount;
  }
  return normalizeVehicles(request).length;
};

const getServiceLabel = (request) => {
  const vehicles = normalizeVehicles(request);

  if (!request?.isBulkRequest) {
    return request?.serviceType || vehicles[0]?.serviceType || 'N/A';
  }

  if (vehicles.length === 0) {
    return request?.serviceType || 'Per-vehicle';
  }

  const uniqueServiceTypes = [
    ...new Set(
      vehicles
        .map((vehicle) => normalizeVendorName(vehicle?.serviceType) || String(vehicle?.serviceType || '').trim())
        .filter(Boolean)
    ),
  ];

  if (uniqueServiceTypes.length === 1) {
    return uniqueServiceTypes[0];
  }

  if (uniqueServiceTypes.length > 1) {
    return 'Mixed';
  }

  return request?.serviceType || 'Per-vehicle';
};

const ensureFoFormState = () => {
  if (!state.foForm || typeof state.foForm !== 'object') {
    state.foForm = createFoFormState();
  }

  if (!Array.isArray(state.rhMembers) || state.rhMembers.length === 0) {
    state.rhMembers = buildRhMembers();
  }

  if (!Array.isArray(state.foForm.selectedVehicles)) {
    state.foForm.selectedVehicles = [];
  }

  if (!Array.isArray(state.foForm.ltpocDetails)) {
    state.foForm.ltpocDetails = [createFoLtpocEntry()];
  }

  if (!state.foForm.bulkVehicleDetails || typeof state.foForm.bulkVehicleDetails !== 'object') {
    state.foForm.bulkVehicleDetails = {};
  }

  if (!state.foForm.serviceType) {
    state.foForm.serviceType = 'FleetX';
  }

  const assignedRhEmail = normalizeEmail(state.foForm.assignedRhEmail);
  const rhEmails = state.rhMembers
    .map((member) => normalizeEmail(member?.email))
    .filter(Boolean);

  if (!assignedRhEmail || !rhEmails.includes(assignedRhEmail)) {
    state.foForm.assignedRhEmail = state.rhMembers[0]?.email || DEFAULT_RH_EMAILS[0] || '';
  } else {
    const matchedRh = state.rhMembers.find((member) => normalizeEmail(member?.email) === assignedRhEmail);
    state.foForm.assignedRhEmail = matchedRh?.email || assignedRhEmail;
  }

  return state.foForm;
};

const getFoStatusLabel = (request) => {
  return getUnifiedStatusLabel(getStatus(request));
};

const getFoStatusClass = (request) => {
  return getUnifiedStatusClass(getStatus(request));
};

const canFoCancelRequest = (request) => {
  const status = getStatus(request);
  return status === REQUEST_STATUSES.PARALLEL_REVIEW;
};

const canFoRemoveVehicleFromBulk = (request) => {
  return request?.isBulkRequest === true && canFoCancelRequest(request) && normalizeVehicles(request).length > 1;
};

const getFoPrimaryVehicleNumber = (request) => {
  const vehicles = normalizeVehicles(request);
  if (vehicles.length > 1) {
    return `${vehicles.length} Vehicles (Bulk)`;
  }
  return String(vehicles[0]?.vehicleNumber || 'N/A');
};

const getFoPrimaryServiceType = (request) => {
  const serviceLabel = String(getServiceLabel(request) || '').trim();
  return serviceLabel || 'N/A';
};

const getFoRequestById = (requestId) => state.requests.find((item) => String(item.id || '') === String(requestId || '')) || null;

const getFoCityOptions = () => {
  const form = ensureFoFormState();
  const requestCities = state.requests.map((request) => String(request?.city || '').trim()).filter(Boolean);
  const selectedVehicleCities = form.selectedVehicles.map((vehicle) => String(vehicle?.city || '').trim()).filter(Boolean);

  return [...new Set([...FO_MAJOR_CITIES, ...requestCities, ...selectedVehicleCities])];
};

const getFoBulkDetailsForVehicle = (form, vehicleNumber) => {
  const normalizedVehicleNumber = normalizeVehicleNumber(vehicleNumber);
  const existing = form.bulkVehicleDetails?.[normalizedVehicleNumber] || form.bulkVehicleDetails?.[vehicleNumber];
  if (existing) {
    return existing;
  }

  const fallback = createFoBulkDetail(form.serviceType || 'FleetX');
  form.bulkVehicleDetails[normalizedVehicleNumber] = fallback;
  return fallback;
};

const isFoBulkLocationValid = (selectedVehicles) => {
  if (selectedVehicles.length <= 1) {
    return true;
  }

  const uniqueCities = [...new Set(selectedVehicles.map((vehicle) => String(vehicle?.city || '').trim()).filter(Boolean))];
  return uniqueCities.length <= 1;
};

const buildVendorPendingRowsForRequest = (request) => {
  const vehicles = normalizeVehicles(request);
  const hasPaymentSignals = vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined ||
      vehicle?.paymentApprovedAt !== undefined ||
      vehicle?.paymentRejectedAt !== undefined ||
      vehicle?.paymentStatus !== undefined
  );

  const resolveVendorForServiceType = (serviceType, fallbackVendor) => {
    const canonicalServiceType = normalizeServiceType(serviceType || '');
    const mapped = normalizeVendorName(canonicalServiceType || fallbackVendor || '');
    return mapped || null;
  };

  if (vehicles.length > 0) {
    return vehicles
      .filter((vehicle) => {
        if (toBooleanFlag(vehicle?.paymentRejected)) {
          return false;
        }
        if (hasPaymentSignals && !toBooleanFlag(vehicle?.paymentApproved)) {
          return false;
        }
        if (toBooleanFlag(vehicle?.vendorNotified)) {
          return false;
        }

        const serviceType = request?.isBulkRequest
          ? vehicle?.serviceType || vehicle?.vendorType || ''
          : vehicle?.serviceType || request?.serviceType || request?.vendorName || '';
        return Boolean(resolveVendorForServiceType(serviceType, request?.vendorName));
      })
      .map((vehicle) => {
        const ltpoc = resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || {};
        const serviceType = request?.isBulkRequest
          ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '')
          : normalizeServiceType(vehicle?.serviceType || request?.serviceType || request?.vendorName || '');
        const vendorName = resolveVendorForServiceType(serviceType, request?.vendorName);

        return {
          requestId: request.id,
          city: request.city || '',
          clientName: request.clientName || '',
          date: toDate(request.createdAt),
          serviceType: serviceType || vendorName || '',
          vehicleNumber: vehicle?.vehicleNumber || '',
          vehicleAvailabilityLocation: vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || '',
          vehicleAvailableTime: vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || '',
          ltpocName: ltpoc?.ltpocName || vehicle?.ltpocName || '',
          ltpocPhone: ltpoc?.ltpocPhone || vehicle?.ltpocPhone || '',
          ltpocEmail: ltpoc?.ltpocEmail || vehicle?.ltpocEmail || '',
          lpoAdditional: ltpoc?.lpoAdditional || vehicle?.lpoAdditional || '',
          vendorName,
        };
      })
      .filter((row) => Boolean(row.vendorName));
  }

  const fallbackServiceType = normalizeServiceType(request?.serviceType || request?.vendorName || '');
  const fallbackVendorName = resolveVendorForServiceType(fallbackServiceType, request?.vendorName);
  if (!fallbackVendorName) {
    return [];
  }

  return [
    {
      requestId: request.id,
      city: request.city || '',
      clientName: request.clientName || '',
      date: toDate(request.createdAt),
      serviceType: fallbackServiceType || fallbackVendorName,
      vehicleNumber: '',
      vehicleAvailabilityLocation: request.vehicleAvailabilityLocation || '',
      vehicleAvailableTime: request.vehicleAvailableTime || '',
      ltpocName: '',
      ltpocPhone: '',
      ltpocEmail: '',
      lpoAdditional: '',
      vendorName: fallbackVendorName,
    },
  ];
};

const buildVendorRowsForRequest = (request) => {
  const vehicles = normalizeVehicles(request);
  const hasPaymentSignals = vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined
  );

  if (vehicles.length > 0) {
    return vehicles
      .filter((vehicle) => {
        if (vehicle?.paymentRejected === true) {
          return false;
        }
        if (hasPaymentSignals && vehicle?.paymentApproved !== true) {
          return false;
        }
        return true;
      })
      .map((vehicle) => {
        const ltpoc = resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || {};
        const serviceType = request?.isBulkRequest
          ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '')
          : normalizeServiceType(vehicle?.serviceType || request?.serviceType || '');

        return {
          requestId: request.id,
          city: request.city || '',
          clientName: request.clientName || '',
          date: toDate(request.createdAt),
          serviceType: serviceType || '',
          vehicleNumber: vehicle?.vehicleNumber || '',
          vehicleAvailabilityLocation: vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || '',
          vehicleAvailableTime: vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || '',
          ltpocName: ltpoc?.ltpocName || vehicle?.ltpocName || '',
          ltpocPhone: ltpoc?.ltpocPhone || vehicle?.ltpocPhone || '',
          ltpocEmail: ltpoc?.ltpocEmail || vehicle?.ltpocEmail || '',
          lpoAdditional: ltpoc?.lpoAdditional || vehicle?.lpoAdditional || '',
        };
      });
  }

  return [
    {
      requestId: request.id,
      city: request.city || '',
      clientName: request.clientName || '',
      date: toDate(request.createdAt),
      serviceType: request?.isBulkRequest ? '' : request.serviceType || '',
      vehicleNumber: '',
      vehicleAvailabilityLocation: request.vehicleAvailabilityLocation || '',
      vehicleAvailableTime: request.vehicleAvailableTime || '',
      ltpocName: '',
      ltpocPhone: '',
      ltpocEmail: '',
      lpoAdditional: '',
    },
  ];
};

const buildFoRowsForRequest = (request) => {
  const vehicles = normalizeVehicles(request);
  const hasPaymentSignals = vehicles.some(
    (vehicle) =>
      vehicle?.paymentApproved !== undefined ||
      vehicle?.paymentRejected !== undefined ||
      vehicle?.paymentActionTaken !== undefined
  );

  if (vehicles.length > 0) {
    return vehicles
      .filter((vehicle) => {
        if (vehicle?.paymentRejected === true) {
          return false;
        }
        if (hasPaymentSignals && vehicle?.paymentApproved !== true) {
          return false;
        }
        return true;
      })
      .map((vehicle) => {
        const ltpoc = resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || {};
        const serviceType = request?.isBulkRequest
          ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '')
          : normalizeServiceType(vehicle?.serviceType || request?.serviceType || '');

        return {
          requestId: request.id,
          status: getStatus(request),
          city: request.city || '',
          clientName: request.clientName || '',
          serviceType: serviceType || '',
          serviceCost: request.serviceCost || '',
          vehicleNumber: vehicle?.vehicleNumber || '',
          vehicleAvailabilityLocation: vehicle?.vehicleAvailabilityLocation || request.vehicleAvailabilityLocation || '',
          vehicleAvailableTime: vehicle?.vehicleAvailableTime || request.vehicleAvailableTime || '',
          ltpocName: ltpoc?.ltpocName || vehicle?.ltpocName || '',
          ltpocPhone: ltpoc?.ltpocPhone || vehicle?.ltpocPhone || '',
          lpoAdditional: ltpoc?.lpoAdditional || vehicle?.lpoAdditional || '',
          createdAt: toDate(request.createdAt),
        };
      });
  }

  return [
    {
      requestId: request.id,
      status: getStatus(request),
      city: request.city || '',
      clientName: request.clientName || '',
      serviceType: request?.isBulkRequest ? '' : request.serviceType || '',
      serviceCost: request.serviceCost || '',
      vehicleNumber: '',
      vehicleAvailabilityLocation: request.vehicleAvailabilityLocation || '',
      vehicleAvailableTime: request.vehicleAvailableTime || '',
      ltpocName: '',
      ltpocPhone: '',
      lpoAdditional: '',
      createdAt: toDate(request.createdAt),
    },
  ];
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const toValidDate = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
      return converted;
    }
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const fromPrimitive = new Date(value);
    return Number.isNaN(fromPrimitive.getTime()) ? null : fromPrimitive;
  }

  if (typeof value === 'object') {
    const seconds = Number(value?.seconds ?? value?._seconds);
    const nanoseconds = Number(value?.nanoseconds ?? value?._nanoseconds ?? 0);
    if (Number.isFinite(seconds)) {
      const epochMs = seconds * 1000 + (Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0);
      const fromSeconds = new Date(epochMs);
      if (!Number.isNaN(fromSeconds.getTime())) {
        return fromSeconds;
      }
    }

    const milliseconds = Number(value?.milliseconds ?? value?._milliseconds);
    if (Number.isFinite(milliseconds)) {
      const fromMilliseconds = new Date(milliseconds);
      if (!Number.isNaN(fromMilliseconds.getTime())) {
        return fromMilliseconds;
      }
    }
  }

  return null;
};

const toDate = (value) => {
  const date = toValidDate(value);
  return date ? date.toLocaleDateString() : 'N/A';
};

const getStatusClass = (request) => {
  return getUnifiedStatusClass(getStatus(request));
};

const isClosed = (request) => {
  const status = getStatus(request);
  return status === REQUEST_STATUSES.HALTED || status === REQUEST_STATUSES.CANCELLED;
};

const isRhActionable = (request) => {
  if (isClosed(request)) return false;

  const status = getStatus(request);
  const actionableStatus =
    status === REQUEST_STATUSES.PARALLEL_REVIEW ||
    status === REQUEST_STATUSES.VENDOR_COORDINATION ||
    status === REQUEST_STATUSES.COMPLETED;

  return actionableStatus && getRhDecision(request) === 'PENDING';
};

const isPaymentActionable = (request) => {
  if (isClosed(request)) return false;

  const status = getStatus(request);
  const paymentStage = status === REQUEST_STATUSES.PARALLEL_REVIEW;

  return paymentStage && getPaymentDecision(request) === 'PENDING';
};

const isVendorActionable = (request) => {
  if (isClosed(request)) return false;
  if (getStatus(request) !== REQUEST_STATUSES.VENDOR_COORDINATION) {
    return false;
  }

  if (request.vendorNotified === true) {
    return false;
  }

  return hasVendorEligibleVehicles(request);
};

const isRequestAssignedToCurrentRh = (request) => {
  const assignedRhUserId = String(request?.assignedRhUserId || '').trim();
  const assignedRhEmail = normalizeEmail(request?.assignedRhEmailNormalized || request?.assignedRhEmail);
  const currentUserId = String(state.user?.uid || '').trim();
  const currentUserEmail = normalizeEmail(state.user?.email);

  if (!assignedRhUserId && !assignedRhEmail) {
    return currentUserEmail === LEGACY_RH_FALLBACK_EMAIL;
  }

  if (assignedRhUserId && currentUserId && assignedRhUserId === currentUserId) {
    return true;
  }

  if (assignedRhEmail && currentUserEmail && assignedRhEmail === currentUserEmail) {
    return true;
  }

  return false;
};

const getAssignedRhDisplay = (request) => {
  const assignedRhEmail = normalizeEmail(request?.assignedRhEmailNormalized || request?.assignedRhEmail);
  if (assignedRhEmail) {
    return assignedRhEmail;
  }

  const assignedRhUserId = String(request?.assignedRhUserId || '').trim();
  if (!assignedRhUserId) {
    return 'Unassigned';
  }

  const currentUserId = String(state.user?.uid || '').trim();
  if (currentUserId && assignedRhUserId === currentUserId) {
    return normalizeEmail(state.user?.email) || 'Current RH';
  }

  return 'Assigned RH';
};

const getScopedByRole = (role, requests) => {
  if (role === 'FO') {
    return requests;
  }

  if (role === 'RH') {
    return requests.filter((item) => {
      const status = getStatus(item);
      const isRhStatusVisible = [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.COMPLETED,
        REQUEST_STATUSES.HALTED,
        REQUEST_STATUSES.CANCELLED,
      ].includes(status);

      return isRhStatusVisible && isRequestAssignedToCurrentRh(item);
    });
  }

  if (role === 'PAYMENT') {
    return requests.filter((item) => {
      const status = getStatus(item);
      return [
        REQUEST_STATUSES.PARALLEL_REVIEW,
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.COMPLETED,
        REQUEST_STATUSES.HALTED,
        REQUEST_STATUSES.CANCELLED,
      ].includes(status);
    });
  }

  if (role === 'VENDOR') {
    return requests.filter((item) => {
      const status = getStatus(item);
      const isVendorStage = [
        REQUEST_STATUSES.VENDOR_COORDINATION,
        REQUEST_STATUSES.COMPLETED,
        REQUEST_STATUSES.HALTED,
        REQUEST_STATUSES.CANCELLED,
      ].includes(status);

      if (!isVendorStage) {
        return false;
      }

      return hasVendorEligibleVehicles(item);
    });
  }

  return requests;
};

const userRef = () => ({
  id: state.user?.uid,
  email: state.user?.email,
  role: state.role,
});

const getRequestCreatedAtMs = (request) => {
  const parseDateLike = (value) => {
    const date = toValidDate(value);
    if (!date) {
      return 0;
    }

    return date.getTime();
  };

  const createdAtMs = parseDateLike(request?.createdAt);
  if (createdAtMs > 0) {
    return createdAtMs;
  }

  const updatedAtMs = parseDateLike(request?.updatedAt);
  if (updatedAtMs > 0) {
    return updatedAtMs;
  }

  const history = Array.isArray(request?.history) ? request.history : [];
  const lastHistoryEntry = history[history.length - 1];
  const historyMs = parseDateLike(lastHistoryEntry?.timestamp);
  if (historyMs > 0) {
    return historyMs;
  }

  return 0;
};

const sortRequestsNewestFirst = (requests) =>
  [...requests].sort((left, right) => getRequestCreatedAtMs(right) - getRequestCreatedAtMs(left));

const getRoleScopedRequests = (role = state.role) => {
  if (!role) {
    return [];
  }

  return sortRequestsNewestFirst(getScopedByRole(role, state.requests));
};

const getVisibleRequests = () => {
  const role = state.role;
  if (!role) return [];

  const search = state.searchTerm.trim().toLowerCase();

  let scoped = getScopedByRole(role, state.requests);

  if (!search) {
    return sortRequestsNewestFirst(scoped);
  }

  const filtered = scoped.filter((item) => {
    const id = String(item.id || '').toLowerCase();
    const client = String(item.clientName || '').toLowerCase();
    const city = String(item.city || '').toLowerCase();
    const service = String(getServiceLabel(item) || '').toLowerCase();
    const vehicleNumbers = normalizeVehicles(item)
      .map((vehicle) => String(vehicle?.vehicleNumber || '').toLowerCase())
      .join(' ');

    return (
      id.includes(search) ||
      client.includes(search) ||
      city.includes(search) ||
      service.includes(search) ||
      vehicleNumbers.includes(search)
    );
  });

  return sortRequestsNewestFirst(filtered);
};

const updateFoDriverField = (index, field, value) => {
  const form = ensureFoFormState();
  if (!form.ltpocDetails[index]) {
    form.ltpocDetails[index] = createFoLtpocEntry();
  }

  const normalizedValue =
    field === 'ltpocPhone'
      ? normalizePhoneForStorage(value)
      : field === 'vehicleNumber'
        ? normalizeVehicleNumber(value)
        : value;
  form.ltpocDetails[index] = {
    ...form.ltpocDetails[index],
    [field]: normalizedValue,
  };
};

const updateFoBulkField = (vehicleNumber, field, value) => {
  const form = ensureFoFormState();
  const normalizedVehicle = normalizeVehicleNumber(vehicleNumber);
  const details = getFoBulkDetailsForVehicle(form, normalizedVehicle);
  const normalizedValue = field === 'ltpocPhone' ? normalizePhoneForStorage(value) : value;

  form.bulkVehicleDetails[normalizedVehicle] = {
    ...details,
    [field]: normalizedValue,
  };
};

const handleFoAddVehicle = async (root) => {
  const form = ensureFoFormState();

  if (state.foBusy) {
    return;
  }

  if (!String(form.city || '').trim() || !String(form.clientName || '').trim()) {
    state.error = 'Please enter city and client name before adding a vehicle.';
    render(root);
    return;
  }

  const vehicleInput = normalizeVehicleNumber(form.vehicleInput);
  if (!vehicleInput) {
    state.error = 'Please enter a vehicle number.';
    render(root);
    return;
  }

  if (form.selectedVehicles.some((vehicle) => normalizeVehicleNumberKey(vehicle.vehicleNumber) === normalizeVehicleNumberKey(vehicleInput))) {
    state.error = `Vehicle ${vehicleInput} is already added.`;
    render(root);
    return;
  }

  state.foBusy = true;
  state.error = '';
  state.notice = '';
  render(root);

  try {
    const validation = await foApiService.validateVehicle(vehicleInput);
    const normalizedVehicle = normalizeVehicleNumber(validation?.vehicleNumber || vehicleInput);
    const vehicle = {
      vehicleNumber: normalizedVehicle,
      city: String(validation?.city || form.city || '').trim(),
      clientName: String(validation?.clientName || form.clientName || '').trim(),
      isRegistered: Boolean(validation?.isRegistered),
      isNewTrip: !validation?.isRegistered,
    };

    form.selectedVehicles = [...form.selectedVehicles, vehicle];
    form.bulkVehicleDetails[normalizedVehicle] = createFoBulkDetail(form.serviceType || 'FleetX');
    form.vehicleInput = '';

    if (form.ltpocDetails.length === 0) {
      form.ltpocDetails = [createFoLtpocEntry()];
    }

    if (form.selectedVehicles.length === 1) {
      form.ltpocDetails = form.ltpocDetails.map((entry) => ({
        ...entry,
        vehicleNumber: entry.vehicleNumber || normalizedVehicle,
      }));
    }

    state.notice = `Vehicle ${normalizedVehicle} added • ${getFoTripLabel(vehicle)}.`;
  } catch (error) {
    state.error = error?.message || 'Failed to validate vehicle.';
  } finally {
    state.foBusy = false;
    render(root);
  }
};

const handleFoRemoveVehicle = (root, vehicleNumber) => {
  const form = ensureFoFormState();
  const normalizedVehicle = normalizeVehicleNumber(vehicleNumber);
  const normalizedVehicleKey = normalizeVehicleNumberKey(vehicleNumber);

  form.selectedVehicles = form.selectedVehicles.filter(
    (vehicle) => normalizeVehicleNumberKey(vehicle.vehicleNumber) !== normalizedVehicleKey
  );

  Object.keys(form.bulkVehicleDetails || {}).forEach((vehicleKey) => {
    if (normalizeVehicleNumberKey(vehicleKey) === normalizedVehicleKey) {
      delete form.bulkVehicleDetails[vehicleKey];
    }
  });

  form.ltpocDetails = form.ltpocDetails
    .filter((entry) => normalizeVehicleNumberKey(entry.vehicleNumber) !== normalizedVehicleKey)
    .map((entry) => ({
      ...entry,
      vehicleNumber:
        form.selectedVehicles.length === 1 && !entry.vehicleNumber
          ? form.selectedVehicles[0]?.vehicleNumber || ''
          : entry.vehicleNumber,
    }));

  if (form.ltpocDetails.length === 0) {
    form.ltpocDetails = [createFoLtpocEntry()];
  }

  state.notice = `Vehicle ${normalizedVehicle} removed.`;
  state.error = '';
  render(root);
};

const handleFoSubmitRequest = async (root) => {
  const form = ensureFoFormState();

  if (state.foBusy) {
    return;
  }

  const city = String(form.city || '').trim();
  const clientName = String(form.clientName || '').trim();
  const assignedRhEmail = normalizeEmail(form.assignedRhEmail);
  const selectedVehicles = form.selectedVehicles;

  if (!city || !clientName) {
    state.error = 'City and client name are required.';
    render(root);
    return;
  }

  if (selectedVehicles.length === 0) {
    state.error = 'Add at least one vehicle before submitting the request.';
    render(root);
    return;
  }

  if (!assignedRhEmail) {
    state.error = 'Please select an RH member before submitting.';
    render(root);
    return;
  }

  const selectedRh =
    state.rhMembers.find((member) => normalizeEmail(member?.email) === assignedRhEmail) || null;

  const assignedRhPayload = {
    assignedRhEmail: selectedRh?.email || assignedRhEmail,
    assignedRhUserId: selectedRh?.id || null,
  };

  const isBulkRequest = selectedVehicles.length > 1;
  const requestId = requestService.generateRequestId();

  try {
    state.foBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    let requestPayload;

    if (isBulkRequest) {
      if (!isFoBulkLocationValid(selectedVehicles)) {
        throw new Error('Bulk requests are only allowed for vehicles in the same city.');
      }

      const vehicles = selectedVehicles.map((vehicle) => {
        const details = getFoBulkDetailsForVehicle(form, vehicle.vehicleNumber);
        const ltpocPhone = normalizePhoneForStorage(details.ltpocPhone || '');

        if (
          !details.serviceType ||
          !String(details.vehicleAvailabilityLocation || '').trim() ||
          !String(details.vehicleAvailableTime || '').trim() ||
          !String(details.ltpocName || '').trim() ||
          !ltpocPhone
        ) {
          throw new Error(`Fill all required details for vehicle ${vehicle.vehicleNumber}.`);
        }

        if (!/^\d{10}$/.test(ltpocPhone)) {
          throw new Error(`LTPOC phone must be 10 digits for ${vehicle.vehicleNumber}.`);
        }

        return {
          vehicleNumber: vehicle.vehicleNumber,
          isNewTrip: vehicle.isNewTrip,
          serviceType: details.serviceType,
          vehicleAvailabilityLocation: String(details.vehicleAvailabilityLocation || '').trim(),
          vehicleAvailableTime: String(details.vehicleAvailableTime || '').trim(),
          ltpocName: String(details.ltpocName || '').trim(),
          ltpocPhone,
        };
      });

      requestPayload = {
        city,
        clientName,
        ...assignedRhPayload,
        vehicles,
        ltpocDetails: vehicles.map((vehicle) => ({
          vehicleNumber: vehicle.vehicleNumber,
          ltpocName: vehicle.ltpocName,
          ltpocPhone: vehicle.ltpocPhone,
        })),
        serviceType: null,
        vendorType: null,
        serviceCost: null,
        isRefundable: null,
        vehicleAvailabilityLocation: '',
        vehicleAvailableTime: '',
        isBulkRequest: true,
        vehicleCount: vehicles.length,
      };
    } else {
      const serviceType = String(form.serviceType || '').trim();
      const location = String(form.vehicleAvailabilityLocation || '').trim();
      const time = String(form.vehicleAvailableTime || '').trim();

      if (!serviceType) {
        throw new Error('Service type is required for single request.');
      }

      if (!location || !time) {
        throw new Error('Availability location and time are required.');
      }

      const primaryVehicle = selectedVehicles[0];
      const validLtpocRows = form.ltpocDetails
        .map((entry) => ({
          vehicleNumber: normalizeVehicleNumber(entry.vehicleNumber || primaryVehicle?.vehicleNumber || ''),
          ltpocName: String(entry.ltpocName || '').trim(),
          ltpocPhone: normalizePhoneForStorage(entry.ltpocPhone || ''),
        }))
        .filter((entry) => entry.vehicleNumber || entry.ltpocName || entry.ltpocPhone);

      if (validLtpocRows.length === 0) {
        throw new Error('Add at least one LTPOC contact for single request.');
      }

      validLtpocRows.forEach((entry) => {
        if (!entry.ltpocName || !entry.ltpocPhone) {
          throw new Error('LTPOC name and phone are required for each contact.');
        }

        if (!/^\d{10}$/.test(entry.ltpocPhone)) {
          throw new Error('LTPOC phone must be exactly 10 digits.');
        }
      });

      requestPayload = {
        city,
        clientName,
        ...assignedRhPayload,
        vehicles: [
          {
            vehicleNumber: primaryVehicle.vehicleNumber,
            isNewTrip: primaryVehicle.isNewTrip,
            serviceType,
            vehicleAvailabilityLocation: location,
            vehicleAvailableTime: time,
          },
        ],
        serviceType,
        vendorType: String(serviceType).toLowerCase(),
        serviceCost: serviceType === 'FleetX' ? 3000 : 2000,
        isRefundable: serviceType === 'FleetX',
        ltpocDetails: validLtpocRows,
        vehicleAvailabilityLocation: location,
        vehicleAvailableTime: time,
        isBulkRequest: false,
        vehicleCount: 1,
      };
    }

    await requestService.createRequest(requestPayload, userRef(), requestId);

    state.foForm = createFoFormState();
    state.notice = isBulkRequest
      ? `Bulk request submitted successfully (${selectedVehicles.length} vehicles).`
      : 'Request submitted successfully.';
  } catch (error) {
    state.error = error?.message || 'Failed to submit request.';
  } finally {
    state.foBusy = false;
    render(root);
  }
};

const openFoCancelModal = (root, requestId) => {
  const request = getFoRequestById(requestId);
  if (!request) {
    state.error = 'Request not found.';
    render(root);
    return;
  }

  state.foCancelRequestId = requestId;
  state.foCancelVehicleNumber = '';
  state.error = '';
  state.notice = '';
  render(root);
};

const closeFoCancelModal = (root) => {
  state.foCancelRequestId = null;
  state.foCancelVehicleNumber = '';
  render(root);
};

const handleFoCancelEntireRequest = async (root) => {
  if (!state.foCancelRequestId) {
    return;
  }

  const request = getFoRequestById(state.foCancelRequestId);
  if (!request?.id) {
    state.error = 'Unable to resolve request.';
    render(root);
    return;
  }

  try {
    state.foBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    await requestService.cancelRequest(request.id, userRef());
    state.notice = `Request ${formatRequestIdDisplay(request.id)} cancelled successfully.`;
    state.foCancelRequestId = null;
    state.foCancelVehicleNumber = '';
  } catch (error) {
    state.error = error?.message || 'Failed to cancel request.';
  } finally {
    state.foBusy = false;
    render(root);
  }
};

const handleFoRemoveVehicleFromBulkRequest = async (root) => {
  if (!state.foCancelRequestId || !state.foCancelVehicleNumber) {
    state.error = 'Select a vehicle to remove.';
    render(root);
    return;
  }

  const request = getFoRequestById(state.foCancelRequestId);
  if (!request?.id) {
    state.error = 'Unable to resolve request.';
    render(root);
    return;
  }

  try {
    state.foBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    const selectedVehicleNumber = normalizeVehicleNumber(state.foCancelVehicleNumber);
    const selectedVehicleKey = normalizeVehicleNumberKey(selectedVehicleNumber);

    await requestService.removeBulkVehicle(request.id, selectedVehicleNumber, userRef());

    state.requests = state.requests.map((item) => {
      if (String(item?.id || '') !== String(request.id || '')) {
        return item;
      }

      const remainingVehicles = normalizeVehicles(item).filter(
        (vehicle) => normalizeVehicleNumberKey(vehicle?.vehicleNumber || '') !== selectedVehicleKey
      );

      const remainingLtpocDetails = Array.isArray(item?.ltpocDetails)
        ? item.ltpocDetails.filter(
            (entry) => normalizeVehicleNumberKey(entry?.vehicleNumber || '') !== selectedVehicleKey
          )
        : item?.ltpocDetails;

      return {
        ...item,
        vehicles: remainingVehicles,
        ltpocDetails: remainingLtpocDetails,
        vehicleCount: remainingVehicles.length,
      };
    });

    const updatedRequest = getFoRequestById(request.id);
    state.notice = `Vehicle ${selectedVehicleNumber} removed from bulk request.`;
    state.foCancelVehicleNumber = '';
    if (!updatedRequest || !canFoRemoveVehicleFromBulk(updatedRequest)) {
      state.foCancelRequestId = null;
    }
  } catch (error) {
    state.error = error?.message || 'Failed to remove vehicle from bulk request.';
  } finally {
    state.foBusy = false;
    render(root);
  }
};

const mountRootEvents = (root) => {
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.getAttribute('data-action');

    try {
      if (action === 'switch-auth') {
        if (state.authBusy) {
          return;
        }
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        state.error = '';
        state.notice = '';
        state.pendingRegistration = null;
        render(root);
        return;
      }

      if (action === 'reset-register') {
        if (state.authBusy) {
          return;
        }
        state.pendingRegistration = null;
        state.error = '';
        state.notice = '';
        render(root);
        return;
      }

      if (action === 'resend-otp') {
        if (state.authBusy) {
          return;
        }

        if (!state.pendingRegistration?.email) {
          state.error = 'Registration details not found. Please fill the form again.';
          render(root);
          return;
        }

        state.authBusy = true;
        state.error = '';
        state.notice = '';
        render(root);

        try {
          const otp = generateOtp();
          await functionsService.sendOTP({ email: state.pendingRegistration.email, otp });
          state.pendingRegistration = { ...state.pendingRegistration, otp };
          state.notice = `A new OTP was sent to ${state.pendingRegistration.email}.`;
        } catch (error) {
          state.error = error?.message || 'Failed to resend OTP. Please try again.';
        } finally {
          state.authBusy = false;
          render(root);
        }
        return;
      }

      if (action === 'forgot-password') {
        if (state.authBusy) {
          return;
        }

        const authForm = root.querySelector('form[data-form="auth"]');
        const email =
          authForm instanceof HTMLFormElement
            ? normalizeEmail(new FormData(authForm).get('email'))
            : normalizeEmail('');

        if (!email) {
          state.error = 'Enter your email first, then click Forgot password.';
          state.notice = '';
          render(root);
          return;
        }

        state.authBusy = true;
        state.error = '';
        state.notice = '';
        render(root);

        try {
          await sendPasswordResetEmail(auth, email);
          state.notice = `Password reset email sent to ${email}. Check inbox and spam, then retry login.`;
        } catch (error) {
          state.error = getAuthErrorMessage(error, 'login');
        } finally {
          state.authBusy = false;
          render(root);
        }
        return;
      }

      if (action === 'logout') {
        await signOut(auth);
        return;
      }

      if (action === 'fo-add-vehicle') {
        await handleFoAddVehicle(root);
        return;
      }

      if (action === 'fo-remove-vehicle') {
        const vehicleNumber = target.getAttribute('data-vehicle-number');
        if (!vehicleNumber) return;
        handleFoRemoveVehicle(root, vehicleNumber);
        return;
      }

      if (action === 'fo-set-service') {
        const serviceType = String(target.getAttribute('data-service') || '').trim();
        if (!serviceType) return;
        const form = ensureFoFormState();
        form.serviceType = serviceType;
        state.error = '';
        render(root);
        return;
      }

      if (action === 'fo-set-vehicle-service') {
        const serviceType = String(target.getAttribute('data-service') || '').trim();
        const vehicleNumber = String(target.getAttribute('data-vehicle-number') || '').trim();
        if (!serviceType || !vehicleNumber) return;
        const form = ensureFoFormState();
        const normalizedVehicle = normalizeVehicleNumber(vehicleNumber);
        const details = getFoBulkDetailsForVehicle(form, normalizedVehicle);
        form.bulkVehicleDetails[normalizedVehicle] = {
          ...details,
          serviceType,
        };
        state.error = '';
        render(root);
        return;
      }

      if (action === 'fo-add-contact') {
        const form = ensureFoFormState();
        const defaultVehicle = form.selectedVehicles[0]?.vehicleNumber || '';
        form.ltpocDetails = [
          ...form.ltpocDetails,
          {
            ...createFoLtpocEntry(),
            vehicleNumber: defaultVehicle,
          },
        ];
        render(root);
        return;
      }

      if (action === 'fo-remove-contact') {
        const index = Number(target.getAttribute('data-driver-index'));
        if (!Number.isInteger(index)) return;
        const form = ensureFoFormState();
        form.ltpocDetails = form.ltpocDetails.filter((_, rowIndex) => rowIndex !== index);
        if (form.ltpocDetails.length === 0) {
          form.ltpocDetails = [createFoLtpocEntry()];
        }
        render(root);
        return;
      }

      if (action === 'fo-submit-request') {
        await handleFoSubmitRequest(root);
        return;
      }

      if (action === 'fo-open-cancel') {
        const requestId = target.getAttribute('data-request-id');
        if (!requestId) return;
        openFoCancelModal(root, requestId);
        return;
      }

      if (action === 'fo-close-cancel') {
        closeFoCancelModal(root);
        return;
      }

      if (action === 'fo-remove-cancel-vehicle') {
        await handleFoRemoveVehicleFromBulkRequest(root);
        return;
      }

      if (action === 'fo-cancel-entire') {
        await handleFoCancelEntireRequest(root);
        return;
      }

      if (action === 'fo-cancel-direct') {
        const requestId = target.getAttribute('data-request-id');
        if (!requestId) return;
        const request = getFoRequestById(requestId);
        if (!request) {
          state.error = 'Request not found.';
          render(root);
          return;
        }

        if (!canFoCancelRequest(request)) {
          state.error = 'This request can no longer be cancelled at current stage.';
          render(root);
          return;
        }

        if (request.isBulkRequest) {
          openFoCancelModal(root, requestId);
          return;
        }

        const confirmed = window.confirm(`Cancel request ${formatRequestIdDisplay(request.id)}?`);
        if (!confirmed) return;

        state.foCancelRequestId = requestId;
        await handleFoCancelEntireRequest(root);
        return;
      }

      if (action === 'fo-view-all') {
        state.searchTerm = '';
        state.foRequestFilter = 'all';
        render(root);
        return;
      }

      if (action === 'fo-cycle-filter') {
        const currentIndex = FO_REQUEST_FILTER_ORDER.indexOf(state.foRequestFilter);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % FO_REQUEST_FILTER_ORDER.length : 0;
        state.foRequestFilter = FO_REQUEST_FILTER_ORDER[nextIndex];
        render(root);
        return;
      }

      if (action === 'fo-nav') {
        const view = String(target.getAttribute('data-view') || '').trim();
        if (!view) return;
        state.foView = view;
        state.error = '';
        state.notice = '';
        render(root);
        return;
      }

      if (action === 'rh-nav') {
        const view = String(target.getAttribute('data-view') || '').trim();
        if (!view) return;
        state.rhView = view;
        state.error = '';
        state.notice = '';
        if (view === 'profile') {
          state.searchTerm = '';
        }
        closeRhModal();
        render(root);
        return;
      }

      if (action === 'rh-toggle-row') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;

        if (state.rhSelectedRequestIds.includes(requestId)) {
          state.rhSelectedRequestIds = state.rhSelectedRequestIds.filter((id) => id !== requestId);
        } else {
          state.rhSelectedRequestIds = [...state.rhSelectedRequestIds, requestId];
        }

        render(root);
        return;
      }

      if (action === 'rh-toggle-all') {
        const rows = getRhFilteredRequests();
        const rowIds = rows.map((request) => String(request?.id || '')).filter(Boolean);

        if (rowIds.length === 0) {
          state.rhSelectedRequestIds = [];
          render(root);
          return;
        }

        const allSelected = rowIds.every((id) => state.rhSelectedRequestIds.includes(id));
        state.rhSelectedRequestIds = allSelected ? [] : rowIds;
        render(root);
        return;
      }

      if (action === 'rh-clear-selection') {
        state.rhSelectedRequestIds = [];
        render(root);
        return;
      }

      if (action === 'rh-approve-selected') {
        await handleRhApproveSelected(root);
        return;
      }

      if (action === 'rh-open-details') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        openRhModal(requestId, 'details');
        render(root);
        return;
      }

      if (action === 'rh-row-approve') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        openRhModal(requestId, 'details');
        await handleRhApproveFromModal(root);
        return;
      }

      if (action === 'rh-row-reject') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        openRhModal(requestId, 'reject');
        render(root);
        return;
      }

      if (action === 'rh-open-edit') {
        if (!state.rhModalRequestId) return;
        state.rhModalView = 'edit';
        render(root);
        return;
      }

      if (action === 'rh-open-reject') {
        if (!state.rhModalRequestId) return;
        state.rhModalView = 'reject';
        render(root);
        return;
      }

      if (action === 'rh-back-details') {
        if (!state.rhModalRequestId) return;
        state.rhModalView = 'details';
        state.rhRejectReason = '';
        render(root);
        return;
      }

      if (action === 'rh-close-modal') {
        closeRhModal();
        render(root);
        return;
      }

      if (action === 'rh-approve') {
        await handleRhApproveFromModal(root);
        return;
      }

      if (action === 'rh-save-approve') {
        await handleRhEditApproveFromModal(root);
        return;
      }

      if (action === 'rh-confirm-reject') {
        await handleRhRejectFromModal(root);
        return;
      }

      if (action === 'vendor-nav') {
        const view = String(target.getAttribute('data-view') || '').trim();
        if (!view) return;
        state.vendorView = view;
        state.vendorSelectedRequestIds = [];
        closeVendorModal();
        state.error = '';
        state.notice = '';
        if (view === 'profile') {
          state.searchTerm = '';
        }
        render(root);
        return;
      }

      if (action === 'vendor-open-details') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        openVendorModal(requestId);
        render(root);
        return;
      }

      if (action === 'vendor-close-modal') {
        closeVendorModal();
        render(root);
        return;
      }

      if (action === 'vendor-toggle-row') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;

        if (state.vendorSelectedRequestIds.includes(requestId)) {
          state.vendorSelectedRequestIds = state.vendorSelectedRequestIds.filter((id) => id !== requestId);
        } else {
          state.vendorSelectedRequestIds = [...state.vendorSelectedRequestIds, requestId];
        }

        render(root);
        return;
      }

      if (action === 'vendor-toggle-all') {
        const filteredRows = getVendorFilteredRequests();
        const viewRows =
          state.vendorView === 'history'
            ? filteredRows.filter((request) => !canVendorRowAction(request))
            : filteredRows.filter((request) => canVendorRowAction(request));

        const actionableIds = viewRows
          .filter((request) => canVendorRowAction(request))
          .map((request) => String(request?.id || '').trim())
          .filter(Boolean);

        if (actionableIds.length === 0) {
          state.vendorSelectedRequestIds = [];
          render(root);
          return;
        }

        const allSelected = actionableIds.every((requestId) => state.vendorSelectedRequestIds.includes(requestId));
        state.vendorSelectedRequestIds = allSelected ? [] : actionableIds;
        render(root);
        return;
      }

      if (action === 'vendor-clear-selection') {
        state.vendorSelectedRequestIds = [];
        render(root);
        return;
      }

      if (action === 'vendor-clear-dates') {
        state.vendorDateFrom = '';
        state.vendorDateTo = '';
        state.vendorSelectedRequestIds = [];
        render(root);
        return;
      }

      if (action === 'vendor-notify-selected') {
        await handleVendorNotifySelected(root);
        return;
      }

      if (action === 'vendor-notify-fo-selected') {
        await handleFoNotifySelected(root);
        return;
      }

      if (action === 'vendor-export-csv') {
        const rows = state.vendorView === 'history'
          ? getVendorFilteredRequests().filter((request) => !canVendorRowAction(request))
          : getVendorFilteredRequests().filter((request) => canVendorRowAction(request));
        exportVendorRequestsToCsv(rows, state.vendorView || 'dashboard');
        return;
      }

      if (action === 'payment-nav') {
        const view = String(target.getAttribute('data-view') || '').trim();
        if (!view) return;
        state.paymentView = view;
        state.paymentSelectedRowKeys = [];
        state.error = '';
        state.notice = '';
        if (view === 'profile') {
          state.searchTerm = '';
        }
        closePaymentModal();
        closePaymentRejectModal();
        render(root);
        return;
      }

      if (action === 'payment-toggle-row') {
        const rowKey = String(target.getAttribute('data-row-key') || '').trim();
        if (!rowKey) return;

        if (state.paymentSelectedRowKeys.includes(rowKey)) {
          state.paymentSelectedRowKeys = state.paymentSelectedRowKeys.filter((key) => key !== rowKey);
        } else {
          state.paymentSelectedRowKeys = [...state.paymentSelectedRowKeys, rowKey];
        }

        render(root);
        return;
      }

      if (action === 'payment-toggle-all') {
        const rows = getPaymentRows().viewRows;
        const actionableRows = rows.filter((row) => canTakePaymentRowAction(row.request, row));
        const actionableKeys = actionableRows.map((row) => getPaymentRowKey(row));

        if (actionableKeys.length === 0) {
          state.paymentSelectedRowKeys = [];
          render(root);
          return;
        }

        const allSelected = actionableKeys.every((key) => state.paymentSelectedRowKeys.includes(key));
        state.paymentSelectedRowKeys = allSelected ? [] : actionableKeys;
        render(root);
        return;
      }

      if (action === 'payment-clear-selection') {
        state.paymentSelectedRowKeys = [];
        render(root);
        return;
      }

      if (action === 'payment-open-details') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        const vehicleIndex = parsePaymentVehicleIndex(target.getAttribute('data-vehicle-index'));
        openPaymentModal(requestId, vehicleIndex);
        render(root);
        return;
      }

      if (action === 'payment-close-modal') {
        closePaymentModal();
        render(root);
        return;
      }

      if (action === 'payment-open-reject') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        const vehicleIndex = parsePaymentVehicleIndex(target.getAttribute('data-vehicle-index'));
        openPaymentRejectModal(requestId, vehicleIndex);
        render(root);
        return;
      }

      if (action === 'payment-close-reject') {
        closePaymentRejectModal();
        render(root);
        return;
      }

      if (action === 'payment-confirm-reject') {
        await handlePaymentRejectFromModal(root);
        return;
      }

      if (action === 'payment-approve-row') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;
        const vehicleIndex = parsePaymentVehicleIndex(target.getAttribute('data-vehicle-index'));
        await handlePaymentApproveRow(root, requestId, vehicleIndex);
        return;
      }

      if (action === 'payment-approve-selected') {
        await handlePaymentApproveSelected(root);
        return;
      }

      if (action === 'payment-export') {
        const rows = getPaymentRows().viewRows;
        exportPaymentRowsToCsv(rows);
        return;
      }

      if (action === 'approve') {
        const requestId = target.getAttribute('data-request-id');
        if (!requestId) return;
        const request = state.requests.find((item) => item.id === requestId);
        if (!request) return;

        if (state.role === 'RH') {
          if (!isRhActionable(request)) {
            throw new Error('Request is not actionable for RH at current workflow stage.');
          }

          if (request.isBulkRequest) {
            await requestService.approveBulkRequest(requestId, userRef());
          } else {
            await requestService.approveRequest(requestId, userRef(), 'RH');
          }
        } else if (state.role === 'PAYMENT') {
          if (!isPaymentActionable(request)) {
            throw new Error('Request is not actionable for Payment at current workflow stage.');
          }

          if (request.isBulkRequest) {
            await requestService.approveBulkPayment(requestId, userRef());
          } else {
            await requestService.approveRequest(requestId, userRef(), 'PAYMENT');
          }
        }
        return;
      }

      if (action === 'reject') {
        const requestId = target.getAttribute('data-request-id');
        if (!requestId) return;
        const request = state.requests.find((item) => item.id === requestId);
        if (!request) return;

        const reason = window.prompt('Enter rejection reason');
        if (!reason) return;

        if (state.role === 'RH') {
          if (!isRhActionable(request)) {
            throw new Error('Request is not actionable for RH at current workflow stage.');
          }

          if (request.isBulkRequest) {
            await requestService.rejectBulkRequest(requestId, reason, userRef());
          } else {
            await requestService.rejectRequest(requestId, userRef(), 'RH', reason);
          }
        } else if (state.role === 'PAYMENT') {
          if (!isPaymentActionable(request)) {
            throw new Error('Request is not actionable for Payment at current workflow stage.');
          }

          if (request.isBulkRequest) {
            await requestService.rejectBulkPayment(requestId, reason, userRef());
          } else {
            await requestService.rejectRequest(requestId, userRef(), 'PAYMENT', reason);
          }
        }
        return;
      }

      if (action === 'notify-vendor') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;

        try {
          state.vendorBusy = true;
          state.error = '';
          state.notice = '';
          render(root);

          await notifyVendorForRequest(requestId);
          state.vendorSelectedRequestIds = state.vendorSelectedRequestIds.filter((id) => id !== requestId);
          state.notice = `Vendor notified for request ${formatRequestIdDisplay(requestId)}.`;
        } catch (error) {
          state.error = error?.message || 'Unable to notify vendor for this request.';
        } finally {
          state.vendorBusy = false;
          render(root);
        }
        return;
      }

      if (action === 'notify-fo') {
        const requestId = String(target.getAttribute('data-request-id') || '').trim();
        if (!requestId) return;

        try {
          state.vendorBusy = true;
          state.error = '';
          state.notice = '';
          render(root);

          await notifyFoForRequest(requestId);
          state.vendorSelectedRequestIds = state.vendorSelectedRequestIds.filter((id) => id !== requestId);
          state.notice = `FO notified for request ${formatRequestIdDisplay(requestId)}.`;
        } catch (error) {
          state.error = error?.message || 'Unable to notify FO for this request.';
        } finally {
          state.vendorBusy = false;
          render(root);
        }
        return;
      }

      if (action === 'bulk-approve-visible') {
        const visible = getVisibleRequests();
        if (visible.length === 0) {
          return;
        }

        if (state.role === 'RH') {
          const actionable = visible.filter((item) => isRhActionable(item));
          const singleIds = actionable.filter((item) => !item.isBulkRequest).map((item) => item.id).filter(Boolean);
          const bulkIds = actionable.filter((item) => item.isBulkRequest).map((item) => item.id).filter(Boolean);

          if (singleIds.length > 0) {
            await requestService.bulkApprove(singleIds, userRef());
          }
          if (bulkIds.length > 0) {
            await requestService.bulkApproveBulkRequests(bulkIds, userRef());
          }
        }

        if (state.role === 'PAYMENT') {
          const actionable = visible.filter((item) => isPaymentActionable(item));
          const bulkIds = actionable.filter((item) => item.isBulkRequest).map((item) => item.id).filter(Boolean);
          for (const req of actionable.filter((item) => !item.isBulkRequest && item?.id)) {
            await requestService.approveRequest(req.id, userRef(), 'PAYMENT');
          }
          if (bulkIds.length > 0) {
            for (const requestId of bulkIds) {
              await requestService.approveBulkPayment(requestId, userRef());
            }
          }
        }

        return;
      }
    } catch (error) {
      state.error = error?.message || 'Action failed';
      render(root);
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.matches('[data-form="auth"]')) {
      event.preventDefault();
      if (state.authBusy) {
        return;
      }

      const formData = new FormData(form);
      const email = normalizeEmail(formData.get('email'));
      // Preserve the password exactly as entered. Trimming can invalidate valid credentials.
      const password = String(formData.get('password') || '');
      const role = String(formData.get('role') || '').trim();
      const otpInput = String(formData.get('otp') || '').trim();

      state.error = '';
      state.notice = '';
      state.authBusy = true;
      render(root);

      try {
        if (!email) {
          throw new Error('Please enter your email address.');
        }

        if (!password) {
          throw new Error('Please enter your password.');
        }

        if (state.authMode === 'login') {
          const credential = await signInWithEmailAndPassword(auth, email, password);
          await initializeSignedInSession(credential.user);
        } else {
          if (!state.pendingRegistration) {
            if (!role) {
              throw new Error('Role is required for registration.');
            }

            const otp = generateOtp();
            await functionsService.sendOTP({ email, otp });

            state.pendingRegistration = { email, password, role, otp };
            state.notice = `OTP sent to ${email}. Enter it below to complete registration.`;
            return;
          }

          if (!otpInput) {
            throw new Error('Please enter the OTP sent to your email.');
          }

          if (otpInput !== state.pendingRegistration.otp) {
            throw new Error('Invalid OTP. Please check and try again.');
          }

          const credential = await createUserWithEmailAndPassword(
            auth,
            state.pendingRegistration.email,
            state.pendingRegistration.password
          );

          const registeredRole = state.pendingRegistration.role;
          const registeredEmail = normalizeEmail(state.pendingRegistration.email);

          // Create user profile in PostgreSQL via API instead of Firestore
          try {
            const profileResponse = await fetchWithApiFallback(
              '/users/me',
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${await credential.user.getIdToken()}`
                },
                body: JSON.stringify({
                  email: state.pendingRegistration.email,
                  role: registeredRole
                })
              },
              import.meta.env.VITE_API_BASE_URL,
              import.meta.env.VITE_FUNCTIONS_BASE_URL
            );

            if (!profileResponse.ok) {
              throw new Error('Failed to create user profile');
            }
          } catch (profileError) {
            console.error('Profile creation error:', profileError);
            // Continue - user is created in Firebase Auth even if profile creation fails
          }

          if (registeredRole === 'RH' && registeredEmail) {
            state.rhMembers = buildRhMembers([
              ...state.rhMembers,
              {
                id: credential.user.uid,
                email: registeredEmail,
                displayName: getRhDisplayName(registeredEmail),
                isRegistered: true,
              },
            ]);
            saveRhMembersCache(state.rhMembers);
          }

          state.pendingRegistration = null;
          state.notice = '';
        }
      } catch (error) {
        state.error = getAuthErrorMessage(error, state.authMode);
      } finally {
        state.authBusy = false;
        render(root);
      }
      return;
    }

    if (form.matches('[data-form="fo-create"]')) {
      event.preventDefault();
      const formData = new FormData(form);
      const foFormState = ensureFoFormState();
      const city = String(formData.get('city') || '').trim();
      const clientName = String(formData.get('clientName') || '').trim();
      const vehicleInput = String(formData.get('vehicleNumber') || '').trim().toUpperCase();
      const serviceType = String(formData.get('serviceType') || 'FleetX');
      const assignedRhEmailInput = normalizeEmail(formData.get('assignedRhEmail') || foFormState.assignedRhEmail);

      const vehicleNumbers = vehicleInput
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (!city || !clientName || vehicleNumbers.length === 0) {
        state.error = 'City, client, and vehicle number are required.';
        render(root);
        return;
      }

      if (!assignedRhEmailInput) {
        state.error = 'Please select an RH member before creating the request.';
        render(root);
        return;
      }

      const selectedRh =
        state.rhMembers.find((member) => normalizeEmail(member?.email) === assignedRhEmailInput) || null;

      const assignedRhPayload = {
        assignedRhEmail: selectedRh?.email || assignedRhEmailInput,
        assignedRhUserId: selectedRh?.id || null,
      };

      try {
        const requestId = requestService.generateRequestId();
        const isBulkRequest = vehicleNumbers.length > 1;
        const vehicles = vehicleNumbers.map((vehicleNumber) => ({
          vehicleNumber,
          serviceType,
          vehicleAvailabilityLocation: '',
          vehicleAvailableTime: '',
        }));

        await requestService.createRequest(
          {
            city,
            clientName,
            ...assignedRhPayload,
            vehicles,
            serviceType: isBulkRequest ? null : serviceType,
            vendorType: serviceType.toLowerCase(),
            serviceCost: serviceType === 'FleetX' ? 3000 : 2000,
            isRefundable: serviceType === 'FleetX',
            ltpocDetails: [],
            vehicleAvailabilityLocation: '',
            vehicleAvailableTime: '',
            isBulkRequest,
            vehicleCount: vehicleNumbers.length,
          },
          userRef(),
          requestId
        );
        form.reset();
        state.error = '';
      } catch (error) {
        state.error = error?.message || 'Failed to create request';
        render(root);
      }
    }
  });

  const syncFoFormElement = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return false;
    }

    if (target.matches('[data-fo-field]')) {
      const field = target.getAttribute('data-fo-field');
      if (!field) return false;
      const form = ensureFoFormState();
      let nextValue = target.value;
      if (field === 'vehicleInput') {
        nextValue = normalizeVehicleNumber(nextValue);
        target.value = nextValue;
      }
      form[field] = nextValue;
      return true;
    }

    if (target.matches('[data-fo-driver-field]')) {
      const index = Number(target.getAttribute('data-driver-index'));
      const field = target.getAttribute('data-fo-driver-field');
      if (!Number.isInteger(index) || !field) return false;
      let nextValue = target.value;
      if (field === 'ltpocPhone') {
        nextValue = normalizePhoneForStorage(nextValue);
        target.value = nextValue;
      }
      if (field === 'vehicleNumber') {
        nextValue = normalizeVehicleNumber(nextValue);
        target.value = nextValue;
      }
      updateFoDriverField(index, field, nextValue);
      return true;
    }

    if (target.matches('[data-fo-bulk-field]')) {
      const vehicleNumber = target.getAttribute('data-vehicle-number');
      const field = target.getAttribute('data-fo-bulk-field');
      if (!vehicleNumber || !field) return false;
      let nextValue = target.value;
      if (field === 'ltpocPhone') {
        nextValue = normalizePhoneForStorage(nextValue);
        target.value = nextValue;
      }
      updateFoBulkField(vehicleNumber, field, nextValue);
      return true;
    }

    if (target.matches('[data-fo-cancel-vehicle]')) {
      state.foCancelVehicleNumber = normalizeVehicleNumber(target.value);
      return true;
    }

    return false;
  };

  const syncRhFormElement = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return null;
    }

    if (target.matches('[data-rh-filter]')) {
      const field = target.getAttribute('data-rh-filter');
      if (!field || !Object.prototype.hasOwnProperty.call(state, field)) {
        return null;
      }

      state[field] = target.value;
      state.rhSelectedRequestIds = [];
      return 'filter';
    }

    if (target.matches('[data-rh-edit-field]')) {
      const field = target.getAttribute('data-rh-edit-field');
      if (!field || !Object.prototype.hasOwnProperty.call(state, field)) {
        return null;
      }

      state[field] = target.value;
      return 'edit';
    }

    if (target.matches('[data-rh-reject-reason]')) {
      state.rhRejectReason = target.value;
      return 'reject';
    }

    return null;
  };

  const syncPaymentFormElement = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return null;
    }

    if (target.matches('[data-payment-filter]')) {
      const field = target.getAttribute('data-payment-filter');
      if (!field || !Object.prototype.hasOwnProperty.call(state, field)) {
        return null;
      }

      if (target instanceof HTMLInputElement && target.type === 'checkbox') {
        state[field] = target.checked;
      } else {
        state[field] = target.value;
      }

      if (field !== 'paymentShowAdditionalColumns') {
        state.paymentSelectedRowKeys = [];
      }

      return 'filter';
    }

    if (target.matches('[data-payment-reject-reason]')) {
      state.paymentRejectReason = target.value;
      return 'reject';
    }

    return null;
  };

  const syncVendorFormElement = (target) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return null;
    }

    if (target.matches('[data-vendor-filter]')) {
      const field = target.getAttribute('data-vendor-filter');
      if (!field || !Object.prototype.hasOwnProperty.call(state, field)) {
        return null;
      }

      state[field] = target.value;
      state.vendorSelectedRequestIds = [];
      return 'filter';
    }

    return null;
  };

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (target.matches('[data-input="search"]')) {
      state.searchTerm = target.value;
      render(root);
      return;
    }

    const rhSync = syncRhFormElement(target);
    if (rhSync === 'filter' && target.getAttribute('data-rh-filter') === 'searchTerm') {
      render(root);
      return;
    }
    if (rhSync) {
      return;
    }

    const paymentSync = syncPaymentFormElement(target);
    if (paymentSync === 'filter') {
      render(root);
      return;
    }
    if (paymentSync) {
      return;
    }

    const vendorSync = syncVendorFormElement(target);
    if (vendorSync === 'filter') {
      render(root);
      return;
    }
    if (vendorSync) {
      return;
    }

    syncFoFormElement(target);
  });

  root.addEventListener('change', (event) => {
    const target = event.target;

    const rhSync = syncRhFormElement(target);
    if (rhSync === 'filter') {
      render(root);
      return;
    }
    if (rhSync) {
      return;
    }

    const paymentSync = syncPaymentFormElement(target);
    if (paymentSync === 'filter') {
      render(root);
      return;
    }
    if (paymentSync) {
      return;
    }

    const vendorSync = syncVendorFormElement(target);
    if (vendorSync === 'filter') {
      render(root);
      return;
    }
    if (vendorSync) {
      return;
    }

    const synced = syncFoFormElement(target);
    if (synced && target instanceof HTMLSelectElement && target.matches('[data-fo-cancel-vehicle]')) {
      render(root);
    }
  });
};

const subscribeRequests = () => {
  if (state.unsubscribeRequests) {
    state.unsubscribeRequests();
    state.unsubscribeRequests = null;
  }

  if (!state.user || !state.role) {
    state.requests = [];
    return;
  }

  if (state.role === 'FO') {
    state.unsubscribeRequests = requestService.subscribeToUserRequests(state.user.uid, (requests) => {
      state.error = '';
      state.requests = requests;
      render(document.getElementById('root'));
    }, undefined, state.user.email);
    return;
  }

  if (state.role === 'RH') {
    // Load RH requests from PostgreSQL via API instead of Firestore
    const loadRhRequests = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002'}/requests/for-rh`,
          {
            headers: {
              'Authorization': `Bearer ${await state.user.getIdToken()}`
            }
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch RH requests');
        }

        const requests = await response.json();
        state.error = '';
        state.requests = Array.isArray(requests) ? requests : [];
        render(document.getElementById('root'));
      } catch (error) {
        console.error('Failed to load RH requests:', error);
        state.error = error?.message || 'Unable to load requests';
        state.requests = [];
        render(document.getElementById('root'));
      }
    };

    loadRhRequests();
    state.unsubscribeRequests = () => {}; // No-op for API-based loading
    return;
  }

  state.unsubscribeRequests = requestService.subscribeToAllRequests((requests) => {
    state.error = '';
    state.requests = requests;
    render(document.getElementById('root'));
  });
};

const subscribeRhMembers = () => {
  if (state.unsubscribeRhMembers) {
    state.unsubscribeRhMembers();
    state.unsubscribeRhMembers = null;
  }

  if (!state.user) {
    state.rhMembers = buildRhMembers();
    return;
  }

  // Load RH members from PostgreSQL via API
  const loadRhMembers = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3002'}/users?role=RH`,
        {
          headers: {
            'Authorization': `Bearer ${await state.user.getIdToken()}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch RH members');
      }

      const rhUsers = await response.json();
      const fromDirectory = (Array.isArray(rhUsers) ? rhUsers : [])
        .map((data) => {
          const email = normalizeEmail(data?.email);
          if (!email) {
            return null;
          }

          return {
            id: data?.id || '',
            email,
            displayName: String(data?.displayName || data?.name || getRhDisplayName(email)),
            isRegistered: true,
          };
        })
        .filter(Boolean);

      state.rhMembers = buildRhMembers(fromDirectory);
      saveRhMembersCache(state.rhMembers);
      ensureFoFormState();
      render(document.getElementById('root'));
    } catch (error) {
      console.error('Failed to load RH members from API:', error);
      state.rhMembers = buildRhMembers(state.rhMembers);
      ensureFoFormState();
      render(document.getElementById('root'));
    }
  };

  loadRhMembers();
};

const renderRhRoster = () => {
  const rhMembers = state.rhMembers.length > 0 ? state.rhMembers : buildRhMembers();

  return `
    <div class="form-group rh-roster-group">
      <label>Registered RH Members</label>
      <div class="rh-roster-list">
        ${rhMembers
          .map(
            (member) => `
          <span class="rh-roster-chip ${member?.isRegistered ? 'registered' : ''}">
            <strong>${escapeHtml(member.email || '')}</strong>
            <small>${member?.isRegistered ? 'Registered' : 'Available'}</small>
          </span>
        `
          )
          .join('')}
      </div>
      <p class="rh-roster-note">Register with a new email to add another RH. New RH accounts appear here after registration.</p>
    </div>
  `;
};

const authCard = () => `
  <div class="auth-container">
    <div class="auth-shell ${state.authMode === 'register' ? 'register-mode' : ''}">
      <div class="auth-brand-panel">
        <div class="auth-brand-icon">🧭</div>
        <h2>Precision Tracking</h2>
        <p>The industry-standard platform for automated GPS fleet installation and management.</p>
        <div class="auth-brand-footer">© 2026 GPSAuto Platform</div>
      </div>
      <div class="auth-box">
        <h1>${state.authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h1>
        <p class="auth-subtitle">${state.authMode === 'login' ? 'Please enter your details to sign in.' : 'Register your role account. OTP verification is required.'}</p>
        ${state.error ? `<div class="error-message">${state.error}</div>` : ''}
        ${state.notice ? `<div class="stitch-alert info">${state.notice}</div>` : ''}
        <form data-form="auth">
          <div class="form-group">
            <label>Email</label>
            <input name="email" type="email" required placeholder="name@company.com" value="${state.pendingRegistration?.email || ''}" ${state.pendingRegistration ? 'readonly' : ''} />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input name="password" type="password" required placeholder="••••••••" value="${state.pendingRegistration?.password || ''}" ${state.pendingRegistration ? 'readonly' : ''} />
          </div>
          ${state.authMode === 'register' ? `
            <div class="form-group">
              <label>Role</label>
              <select name="role" required ${state.pendingRegistration ? 'disabled' : ''}>
                <option value="FO" ${state.pendingRegistration?.role === 'FO' ? 'selected' : ''}>Field Operator</option>
                <option value="RH" ${state.pendingRegistration?.role === 'RH' ? 'selected' : ''}>Regional Head</option>
                <option value="PAYMENT" ${state.pendingRegistration?.role === 'PAYMENT' ? 'selected' : ''}>Payment Team</option>
                <option value="VENDOR" ${state.pendingRegistration?.role === 'VENDOR' ? 'selected' : ''}>Vendor Coordinator</option>
              </select>
            </div>
            ${renderRhRoster()}
            ${state.pendingRegistration ? `
              <input type="hidden" name="role" value="${state.pendingRegistration.role}" />
              <div class="form-group">
                <label>OTP</label>
                <input name="otp" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="Enter 6-digit OTP" required />
              </div>
            ` : ''}
          ` : ''}
          <button class="btn btn-primary btn-block" type="submit" ${state.authBusy ? 'disabled' : ''}>
            ${
              state.authBusy
                ? 'Please wait...'
                : state.authMode === 'login'
                  ? 'Login'
                  : state.pendingRegistration
                    ? 'Verify OTP & Register'
                    : 'Send OTP'
            }
          </button>
        </form>
        ${state.authMode === 'register' && state.pendingRegistration ? `
          <div class="stitch-inline-row" style="margin-top: 0.75rem;">
            <button class="btn btn-secondary" data-action="resend-otp" type="button" ${state.authBusy ? 'disabled' : ''}>Resend OTP</button>
            <button class="btn btn-secondary" data-action="reset-register" type="button" ${state.authBusy ? 'disabled' : ''}>Edit Details</button>
          </div>
        ` : ''}
        ${state.authMode === 'login' ? `
          <div class="auth-toggle" style="justify-content: flex-end; margin-top: 0.75rem;">
            <button class="link-button" data-action="forgot-password" type="button" ${state.authBusy ? 'disabled' : ''}>Forgot password?</button>
          </div>
        ` : ''}
        <div class="auth-toggle">
          ${state.authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
          <button class="link-button" data-action="switch-auth" type="button">
            ${state.authMode === 'login' ? 'Register' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  </div>
`;

const foCreateSection = () => {
  if (state.role !== 'FO') return '';

  const form = ensureFoFormState();
  const cityOptions = getFoCityOptions();
  const rhMembers = state.rhMembers.length > 0 ? state.rhMembers : buildRhMembers();
  const selectedAssignedRhEmail = normalizeEmail(form.assignedRhEmail);
  const selectedVehicles = form.selectedVehicles;
  const isBulkRequest = selectedVehicles.length > 1;
  const bulkLocationValid = isFoBulkLocationValid(selectedVehicles);
  const selectedVehicleLabel =
    selectedVehicles.length === 0
      ? 'No vehicle selected'
      : isBulkRequest
        ? `${selectedVehicles.length} vehicles selected`
        : `${selectedVehicles[0].vehicleNumber} • ${getFoTripLabel(selectedVehicles[0])}`;

  const selectedVehiclesMarkup = selectedVehicles.length
    ? `
      <div class="fo-selected-vehicles-list">
        ${selectedVehicles
          .map(
            (vehicle) => `
          <div class="fo-selected-vehicle-item">
            <span class="fo-selected-vehicle-number">${escapeHtml(vehicle.vehicleNumber)}</span>
            <span class="fo-selected-vehicle-meta">${escapeHtml(vehicle.city || form.city || '')}</span>
            <span class="fo-selected-vehicle-trip">${escapeHtml(getFoTripLabel(vehicle))}</span>
            <button type="button" class="fo-icon-btn" data-action="fo-remove-vehicle" data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" title="Remove vehicle">×</button>
          </div>
        `
          )
          .join('')}
      </div>
    `
    : '';

  const singleLtpocRows = form.ltpocDetails
    .map((entry, index) => {
      const vehicleOptions = selectedVehicles
        .map(
          (vehicle) => `
          <option value="${escapeHtml(vehicle.vehicleNumber)}" ${entry.vehicleNumber === vehicle.vehicleNumber ? 'selected' : ''}>${escapeHtml(vehicle.vehicleNumber)}</option>
        `
        )
        .join('');

      return `
        <div class="fo-ltpoc-row">
          <select data-driver-index="${index}" data-fo-driver-field="vehicleNumber" ${selectedVehicles.length === 0 ? 'disabled' : ''}>
            <option value="">Vehicle ID</option>
            ${vehicleOptions}
          </select>
          <input data-driver-index="${index}" data-fo-driver-field="ltpocName" type="text" placeholder="LTPOC Name" required value="${escapeHtml(entry.ltpocName)}" />
          <input data-driver-index="${index}" data-fo-driver-field="ltpocPhone" type="tel" placeholder="LTPOC Phone" inputmode="numeric" pattern="[0-9]{10}" minlength="10" maxlength="10" required value="${escapeHtml(entry.ltpocPhone)}" />
          <button type="button" class="fo-icon-btn danger" data-action="fo-remove-contact" data-driver-index="${index}" title="Remove contact">🗑</button>
        </div>
      `;
    })
    .join('');

  const bulkVehicleCards = selectedVehicles
    .map((vehicle) => {
      const details = getFoBulkDetailsForVehicle(form, vehicle.vehicleNumber);
      return `
        <div class="fo-bulk-vehicle-card">
          <div class="fo-bulk-vehicle-head">
            <div class="fo-requests-head-left">
              <span class="fo-pill">${escapeHtml(vehicle.vehicleNumber)}</span>
              <span class="fo-selected-vehicle-trip">${escapeHtml(getFoTripLabel(vehicle))}</span>
            </div>
            <button type="button" class="fo-icon-btn" data-action="fo-remove-vehicle" data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}">×</button>
          </div>
          <div class="fo-bulk-vehicle-grid">
            <div class="fo-field-inline">
              <label>Service Type</label>
              <div class="fo-segmented">
                <button type="button" data-action="fo-set-vehicle-service" data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-service="FleetX" class="${details.serviceType === 'FleetX' ? 'active' : ''}">FleetX</button>
                <button type="button" data-action="fo-set-vehicle-service" data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-service="WheelsEye" class="${details.serviceType === 'WheelsEye' ? 'active' : ''}">WheelsEye</button>
              </div>
            </div>
            <div class="fo-field-inline">
              <label>Installation Time</label>
              <input data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-fo-bulk-field="vehicleAvailableTime" type="datetime-local" value="${escapeHtml(details.vehicleAvailableTime)}" />
            </div>
            <div class="fo-field-inline">
              <label>Availability Location</label>
              <input data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-fo-bulk-field="vehicleAvailabilityLocation" type="text" placeholder="Availability Location" value="${escapeHtml(details.vehicleAvailabilityLocation)}" />
            </div>
            <div class="fo-field-inline">
              <label>LTPOC Name</label>
              <input data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-fo-bulk-field="ltpocName" type="text" placeholder="Contact Name" required value="${escapeHtml(details.ltpocName)}" />
            </div>
            <div class="fo-field-inline">
              <label>LTPOC Phone</label>
              <input data-vehicle-number="${escapeHtml(vehicle.vehicleNumber)}" data-fo-bulk-field="ltpocPhone" type="tel" inputmode="numeric" pattern="[0-9]{10}" minlength="10" maxlength="10" required placeholder="Phone Number" value="${escapeHtml(details.ltpocPhone)}" />
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <section class="fo-create-shell">
      <div class="fo-section-title-row">
        <span class="fo-section-title-icon">+</span>
        <h2>Create New Request</h2>
      </div>
      <div class="fo-create-card">
        <div class="fo-logo-watermark" aria-hidden="true">
          ${
            COMPANY_LOGO_URL
              ? `<img src="${escapeHtml(COMPANY_LOGO_URL)}" alt="Company logo" />`
              : '<span>FleetFlow</span>'
          }
        </div>

        <div class="fo-create-grid">
          <div class="fo-field-inline">
            <label>From City</label>
            <input data-fo-field="city" type="text" list="fo-city-options" placeholder="Mumbai" value="${escapeHtml(form.city)}" />
            <datalist id="fo-city-options">
              ${cityOptions.map((city) => `<option value="${escapeHtml(city)}"></option>`).join('')}
            </datalist>
          </div>
          <div class="fo-field-inline">
            <label>Client Name</label>
            <input data-fo-field="clientName" type="text" placeholder="Reliance Logistics" value="${escapeHtml(form.clientName)}" />
          </div>
          <div class="fo-field-inline">
            <label>Assign RH</label>
            <select data-fo-field="assignedRhEmail">
              ${rhMembers
                .map(
                  (member) => `
                <option value="${escapeHtml(member.email || '')}" ${
                    normalizeEmail(member.email) === selectedAssignedRhEmail ? 'selected' : ''
                  }>${escapeHtml(member.email || '')}</option>
              `
                )
                .join('')}
            </select>
          </div>
          <div class="fo-field-inline">
            <label>Add Vehicle Number</label>
            <div class="fo-vehicle-input-row">
              <input data-fo-field="vehicleInput" type="text" placeholder="Enter vehicle number" value="${escapeHtml(form.vehicleInput)}" />
              <button type="button" class="fo-add-vehicle-btn" data-action="fo-add-vehicle" ${state.foBusy ? 'disabled' : ''}>+</button>
            </div>
          </div>
        </div>

        <div class="fo-selected-vehicle-banner">
          <strong>Selected Vehicle</strong>
          <span>${escapeHtml(selectedVehicleLabel)}</span>
        </div>

        ${selectedVehiclesMarkup}

        ${
          isBulkRequest && !bulkLocationValid
            ? '<div class="fo-warning-box">Bulk requests are only allowed for vehicles in the same city. Please verify vehicle locations.</div>'
            : ''
        }

        ${
          !isBulkRequest
            ? `
          <div class="fo-service-row">
            <div class="fo-service-selector">
              <label>Service Type</label>
              <div class="fo-service-buttons">
                <button type="button" data-action="fo-set-service" data-service="FleetX" class="${form.serviceType === 'FleetX' ? 'active' : ''}">
                  <strong>FleetX</strong>
                  <small>₹3,000 Refundable</small>
                </button>
                <button type="button" data-action="fo-set-service" data-service="WheelsEye" class="${form.serviceType === 'WheelsEye' ? 'active' : ''}">
                  <strong>WheelsEye</strong>
                  <small>₹2,000 Non-refundable</small>
                </button>
              </div>
            </div>
            <div class="fo-field-inline">
              <label>Availability Location</label>
              <input data-fo-field="vehicleAvailabilityLocation" type="text" placeholder="Main Warehouse, Gate 4" value="${escapeHtml(form.vehicleAvailabilityLocation)}" />
            </div>
            <div class="fo-field-inline">
              <label>Available Time</label>
              <input data-fo-field="vehicleAvailableTime" type="datetime-local" value="${escapeHtml(form.vehicleAvailableTime)}" />
            </div>
          </div>

          <div class="fo-ltpoc-wrap">
            <div class="fo-ltpoc-head">
              <h3>LTPOC Details</h3>
              <button type="button" class="fo-link-btn" data-action="fo-add-contact">+ Add Contact</button>
            </div>
            ${singleLtpocRows}
          </div>
        `
            : `
          <div class="fo-bulk-wrap">
            <div class="fo-bulk-head">
              <h3>Vehicle Details (${selectedVehicles.length} Vehicles Selected)</h3>
              <span>Bulk Mode Active</span>
            </div>
            <div class="fo-bulk-cards-grid">
              ${bulkVehicleCards}
            </div>
          </div>
        `
        }

        <div class="fo-submit-row">
          <button type="button" class="fo-submit-btn" data-action="fo-submit-request" ${state.foBusy ? 'disabled' : ''}>
            ${
              state.foBusy
                ? 'Submitting...'
                : isBulkRequest
                  ? `Create Bulk Request (${selectedVehicles.length} Vehicles)`
                  : 'Submit Request'
            }
          </button>
        </div>
      </div>
    </section>
  `;
};

const foTableRows = (rows) => {
  if (rows.length === 0) {
    return `<tr><td colspan="8" class="text-muted">No requests found</td></tr>`;
  }

  return rows
    .map((request) => {
      const status = getStatus(request);
      const createdOn = toDate(request.createdAt);
      const assignedRhDisplay = getAssignedRhDisplay(request);

      return `
        <tr>
          <td class="request-id-cell" data-label="Request ID">${escapeHtml(formatRequestIdDisplay(request.id))}</td>
          <td data-label="Client">${escapeHtml(request.clientName || 'N/A')}</td>
          <td data-label="Vehicle">${escapeHtml(getFoPrimaryVehicleNumber(request))}</td>
          <td data-label="Service Type">${escapeHtml(getFoPrimaryServiceType(request))}</td>
          <td data-label="Assigned RH">${escapeHtml(assignedRhDisplay)}</td>
          <td data-label="Status"><span class="status-badge ${getFoStatusClass(request)}">${escapeHtml(getUnifiedStatusLabel(status))}</span></td>
          <td data-label="Created">${escapeHtml(createdOn)}</td>
          <td class="actions-cell" data-label="Action">
            <button class="btn btn-sm btn-secondary" data-action="fo-open-cancel" data-request-id="${escapeHtml(request.id || '')}">Manage</button>
            ${
              canFoCancelRequest(request)
                ? `<button class="btn btn-sm btn-danger" data-action="fo-cancel-direct" data-request-id="${escapeHtml(request.id || '')}">Cancel</button>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');
};

const renderFoCountTable = (counts, variant = '') => {
  const variantClass = variant ? ` ${variant}` : '';
  return `
    <div class="fo-count-table${variantClass}">
      <div class="fo-count-cell">
        <span>Total</span>
        <strong>${counts.total}</strong>
      </div>
      <div class="fo-count-cell">
        <span>Pending</span>
        <strong>${counts.pending}</strong>
      </div>
      <div class="fo-count-cell">
        <span>Completed</span>
        <strong>${counts.completed}</strong>
      </div>
    </div>
  `;
};

const renderFoMobileNav = (foView) => {
  return `
    <nav class="fo-mobile-nav" aria-label="Field operator mobile navigation">
      <button type="button" class="${foView === 'dashboard' ? 'active' : ''}" data-action="fo-nav" data-view="dashboard">Dashboard</button>
      <button type="button" class="${foView === 'history' ? 'active' : ''}" data-action="fo-nav" data-view="history">History</button>
      <button type="button" class="${foView === 'profile' ? 'active' : ''}" data-action="fo-nav" data-view="profile">Profile</button>
    </nav>
  `;
};

const renderRhMobileNav = (rhView) => {
  return `
    <nav class="rh-mobile-nav" aria-label="Regional head mobile navigation">
      <button type="button" class="${rhView === 'dashboard' ? 'active' : ''}" data-action="rh-nav" data-view="dashboard">Dashboard</button>
      <button type="button" class="${rhView === 'history' ? 'active' : ''}" data-action="rh-nav" data-view="history">History</button>
      <button type="button" class="${rhView === 'profile' ? 'active' : ''}" data-action="rh-nav" data-view="profile">Profile</button>
    </nav>
  `;
};

const renderVendorMobileNav = (vendorView) => {
  return `
    <nav class="vendor-mobile-nav" aria-label="Vendor mobile navigation">
      <button type="button" class="${vendorView === 'dashboard' ? 'active' : ''}" data-action="vendor-nav" data-view="dashboard">Dashboard</button>
      <button type="button" class="${vendorView === 'history' ? 'active' : ''}" data-action="vendor-nav" data-view="history">History</button>
      <button type="button" class="${vendorView === 'profile' ? 'active' : ''}" data-action="vendor-nav" data-view="profile">Profile</button>
    </nav>
  `;
};

const foRequestsSection = ({ title = 'My Requests', historyOnly = false } = {}) => {
  const visible = getVisibleRequests();
  const baseRows = visible;

  const rows = historyOnly ? baseRows : applyFoRequestFilter(baseRows, state.foRequestFilter);
  const counts = getFoRequestCounts(state.requests);
  const tableRowsMarkup = foTableRows(rows);

  return `
    <section class="fo-requests-shell">
      <div class="fo-requests-head">
        <div class="fo-requests-head-left">
          <h2>${escapeHtml(title)}</h2>
          ${historyOnly ? renderCompanyLogo({ className: 'stitch-brand-logo fo-history-brand', alt: 'lets transport' }) : ''}
        </div>
        ${historyOnly ? '' : '<button type="button" class="fo-link-btn" data-action="fo-view-all">View All</button>'}
      </div>

      <div class="fo-requests-tools">
        <div class="search-box search-box-inline">
          <input data-input="search" value="${escapeHtml(state.searchTerm)}" type="text" placeholder="Search by ID or Client..." />
        </div>
        ${historyOnly ? '' : '<button type="button" class="btn btn-secondary fo-filter-btn" data-action="fo-cycle-filter">Filter</button>'}
      </div>

      ${historyOnly ? '' : renderFoCountTable(counts, 'compact')}

      <div class="requests-table-wrapper">
        <table class="requests-table fo-requests-table">
          <thead>
            <tr>
              <th>Request ID</th>
              <th>Client</th>
              <th>Vehicle</th>
              <th>Service Type</th>
              <th>Assigned RH</th>
              <th>Status</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${tableRowsMarkup}</tbody>
        </table>
      </div>
    </section>
  `;
};

const foProfileSection = () => {
  const counts = getFoRequestCounts(state.requests);

  return `
    <section class="fo-requests-shell">
      <div class="fo-requests-head">
        <h2>Profile</h2>
      </div>

      <div class="fo-profile-card">
        <div class="fo-profile-grid">
          <div>
            <span>Email</span>
            <strong>${escapeHtml(state.user?.email || 'N/A')}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>Field Operator</strong>
          </div>
          <div>
            <span>Total Requests</span>
            <strong>${counts.total}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>${counts.pending}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>${counts.completed}</strong>
          </div>
        </div>
      </div>
    </section>
  `;
};

const rhProfileSection = (rows) => {
  const totalRequests = rows.length;
  const newRequests = rows.filter((request) => isRhNewRequest(request)).length;
  const approvedRequests = rows.filter((request) => getRhDecision(request) === 'APPROVED').length;
  const historyRequests = rows.filter((request) => !isRhNewRequest(request)).length;

  return `
    <section class="fo-requests-shell">
      <div class="fo-requests-head">
        <h2>Profile</h2>
      </div>

      <div class="fo-profile-card">
        <div class="fo-profile-grid">
          <div>
            <span>Email</span>
            <strong>${escapeHtml(state.user?.email || 'N/A')}</strong>
          </div>
          <div>
            <span>Division</span>
            <strong>Regional Head</strong>
          </div>
          <div>
            <span>Total Requests</span>
            <strong>${totalRequests}</strong>
          </div>
          <div>
            <span>Approved</span>
            <strong>${approvedRequests}</strong>
          </div>
          <div>
            <span>New Requests</span>
            <strong>${newRequests}</strong>
          </div>
          <div>
            <span>History</span>
            <strong>${historyRequests}</strong>
          </div>
        </div>
      </div>
    </section>
  `;
};

const foCancelModal = () => {
  if (state.role !== 'FO' || !state.foCancelRequestId) {
    return '';
  }

  const request = getFoRequestById(state.foCancelRequestId);
  if (!request) {
    return '';
  }

  const vehicles = normalizeVehicles(request);
  const canRemoveVehicle = canFoRemoveVehicleFromBulk(request);
  const cancelLabel = request.isBulkRequest ? 'Cancel Entire Bulk Request' : 'Cancel Entire Request';
  const primaryVehicle = vehicles[0] || {};
  const primaryLtpoc = resolveVehicleLtpoc(request, primaryVehicle?.vehicleNumber) || {};
  const primaryLtpocName = String(primaryLtpoc?.ltpocName || primaryVehicle?.ltpocName || '').trim() || 'N/A';
  const primaryLtpocPhone = String(primaryLtpoc?.ltpocPhone || primaryVehicle?.ltpocPhone || '').trim();
  const primaryLtpocDisplay = primaryLtpocPhone ? `${primaryLtpocName} (${primaryLtpocPhone})` : primaryLtpocName;

  const vehicleDetailsMarkup = vehicles
    .map((vehicle) => {
      const vehicleNumber = normalizeVehicleNumber(vehicle?.vehicleNumber || '');
      const ltpoc = resolveVehicleLtpoc(request, vehicleNumber) || {};
      const serviceType =
        normalizeServiceType(vehicle?.serviceType || request?.serviceType || request?.vendorName || '') || 'N/A';
      const ltpocName = String(ltpoc?.ltpocName || vehicle?.ltpocName || '').trim() || 'N/A';
      const ltpocPhone = String(ltpoc?.ltpocPhone || vehicle?.ltpocPhone || '').trim();
      const ltpocDisplay = ltpocPhone ? `${ltpocName} (${ltpocPhone})` : ltpocName;

      return `
        <div>
          <span>${escapeHtml(vehicleNumber || 'N/A')}</span>
          <strong>${escapeHtml(serviceType)} • ${escapeHtml(ltpocDisplay)}</strong>
        </div>
      `;
    })
    .join('');

  return `
    <div class="fo-modal-backdrop">
      <div class="fo-cancel-modal">
        <div class="fo-cancel-head">
          <h2>Cancel Request</h2>
          <button type="button" class="fo-icon-btn" data-action="fo-close-cancel">×</button>
        </div>

        <p class="fo-cancel-subtitle">Review the request details before proceeding with cancellation.</p>

        <div class="fo-cancel-meta">
          <div><span>Request ID</span><strong>${escapeHtml(formatRequestIdDisplay(request.id))}</strong></div>
          <div><span>Client</span><strong>${escapeHtml(request.clientName || 'N/A')}</strong></div>
          <div><span>City</span><strong>${escapeHtml(request.city || 'N/A')}</strong></div>
          <div><span>Service Type</span><strong>${escapeHtml(getFoPrimaryServiceType(request))}</strong></div>
          <div><span>Primary LTPOC</span><strong>${escapeHtml(primaryLtpocDisplay)}</strong></div>
          <div><span>Current Status</span><strong>${escapeHtml(getFoStatusLabel(request))}</strong></div>
          <div><span>Assigned RH</span><strong>${escapeHtml(getAssignedRhDisplay(request))}</strong></div>
          <div><span>Vehicle Count</span><strong>${vehicles.length} ${request.isBulkRequest ? 'Vehicles (Bulk)' : 'Vehicle'}</strong></div>
        </div>

        <div class="fo-cancel-block">
          <h3>Vehicle Service & Contact Details</h3>
          <p>Verify service type and LTPOC details before removing or cancelling.</p>
          <div class="fo-cancel-meta">${vehicleDetailsMarkup}</div>
        </div>

        ${
          canRemoveVehicle
            ? `
          <div class="fo-cancel-block">
            <h3>Manage Individual Vehicles</h3>
            <p>Select vehicle to remove from bulk</p>
            <div class="fo-cancel-vehicle-row">
              <select data-fo-cancel-vehicle>
                <option value="">Select vehicle</option>
                ${vehicles
                  .map(
                    (vehicle) => {
                      const optionVehicleNumber = normalizeVehicleNumber(vehicle?.vehicleNumber || '');
                      const isSelected =
                        normalizeVehicleNumberKey(state.foCancelVehicleNumber) ===
                        normalizeVehicleNumberKey(optionVehicleNumber);

                      return `<option value="${escapeHtml(optionVehicleNumber)}" ${isSelected ? 'selected' : ''}>${escapeHtml(optionVehicleNumber)}</option>`;
                    }
                  )
                  .join('')}
              </select>
              <button type="button" class="btn btn-secondary" data-action="fo-remove-cancel-vehicle" ${
                !state.foCancelVehicleNumber || state.foBusy ? 'disabled' : ''
              }>Remove</button>
            </div>
            <small>Removing a vehicle will keep the rest of this bulk request active.</small>
          </div>
        `
            : ''
        }

        <div class="fo-cancel-danger">
          <h3>Cancel Entire Request</h3>
          <p>This action will immediately stop all operations for this request. This cannot be undone.</p>
          <button type="button" class="fo-cancel-danger-btn" data-action="fo-cancel-entire" ${
            state.foBusy || !canFoCancelRequest(request) ? 'disabled' : ''
          }>${escapeHtml(cancelLabel)}</button>
        </div>

        <button type="button" class="fo-go-back-btn" data-action="fo-close-cancel">Go Back</button>
      </div>
    </div>
  `;
};

const rowActions = (request) => {
  if (state.role === 'RH') {
    if (!isRhActionable(request)) {
      return '<span class="text-muted">No action</span>';
    }

    return `
      <button class="btn btn-sm btn-success" data-action="approve" data-request-id="${request.id}">Approve</button>
      <button class="btn btn-sm btn-danger" data-action="reject" data-request-id="${request.id}">Reject</button>
    `;
  }

  if (state.role === 'PAYMENT') {
    if (!isPaymentActionable(request)) {
      return '<span class="text-muted">No action</span>';
    }

    return `
      <button class="btn btn-sm btn-success" data-action="approve" data-request-id="${request.id}">Approve</button>
      <button class="btn btn-sm btn-danger" data-action="reject" data-request-id="${request.id}">Reject</button>
    `;
  }

  if (state.role === 'VENDOR') {
    const canVendorNotify = canVendorNotifyRequest(request);
    const canFoNotify = canFoNotifyRequest(request);

    if (!canVendorNotify && !canFoNotify) {
      return '<span class="text-muted">No action</span>';
    }

    return `
      ${
        canVendorNotify
          ? `<button class="btn btn-sm btn-primary" data-action="notify-vendor" data-request-id="${request.id}">Notify Vendor</button>`
          : ''
      }
      ${
        canFoNotify
          ? `<button class="btn btn-sm btn-secondary" data-action="notify-fo" data-request-id="${request.id}">Notify FO</button>`
          : ''
      }
    `;
  }

  return `<span class="text-muted">View</span>`;
};

const roleActionBar = () => {
  if (state.role === 'FO') {
    return '<span class="stitch-controls-note">Create requests and monitor status in real-time.</span>';
  }

  if (state.role === 'RH') {
    return '<button class="btn btn-success" data-action="bulk-approve-visible">Approve All Pending</button>';
  }

  if (state.role === 'PAYMENT') {
    return '<button class="btn btn-success" data-action="bulk-approve-visible">Approve All Pending</button>';
  }

  if (state.role === 'VENDOR') {
    return '<span class="stitch-controls-note">Use separate actions for vendor notification and FO notification.</span>';
  }

  return '';
};

const tableRows = () => {
  const rows = getVisibleRequests();
  if (rows.length === 0) {
    return `<tr><td colspan="8" class="text-muted">No requests found</td></tr>`;
  }

  return rows
    .map((request) => {
      const service = getServiceLabel(request);
      const vehicles = getVehicleCount(request);
      const rhDecision = getRhDecision(request);
      const paymentDecision = getPaymentDecision(request);
      const status = getStatus(request);
      const assignedRhDisplay = getAssignedRhDisplay(request);
      return `
        <tr class="${request.isBulkRequest ? 'stitch-bulk-row' : ''}">
          <td class="request-id-cell" data-label="Request ID">${escapeHtml(formatRequestIdDisplay(request.id))}</td>
          <td data-label="Status">
            <span class="status-badge ${getStatusClass(request)}">${getUnifiedStatusLabel(status)}</span>
            ${
              state.role === 'FO'
                ? ''
                : `<span class="stitch-summary-note">RH: ${rhDecision} • Payment: ${paymentDecision}${
                    state.role === 'RH' ? ` • Assigned RH: ${escapeHtml(assignedRhDisplay)}` : ''
                  }</span>`
            }
          </td>
          <td data-label="Client">${request.clientName || 'N/A'}</td>
          <td data-label="City">${request.city || 'N/A'}</td>
          <td data-label="Service"><span class="service-badge">${service}</span></td>
          <td data-label="Vehicles">${vehicles}</td>
          <td class="date-cell" data-label="Created">${toDate(request.createdAt)}</td>
          <td class="actions-cell" data-label="Actions">${rowActions(request)}</td>
        </tr>
      `;
    })
    .join('');
};

const getRhRequestById = (requestId) =>
  state.requests.find((item) => String(item?.id || '') === String(requestId || '')) || null;

const toDateInputValue = (value) => {
  const date = toValidDate(value);
  if (!date) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRhStatusMeta = (request) => {
  const status = getStatus(request);
  const rhDecision = getRhDecision(request);

  if (status === REQUEST_STATUSES.CANCELLED) {
    return { label: 'Cancelled', className: 'rh-status-cancelled' };
  }

  if (status === REQUEST_STATUSES.HALTED || rhDecision === 'REJECTED') {
    return { label: 'Rejected', className: 'rh-status-rejected' };
  }

  if (status === REQUEST_STATUSES.COMPLETED) {
    return { label: 'Completed', className: 'rh-status-approved' };
  }

  if (status === REQUEST_STATUSES.VENDOR_COORDINATION && rhDecision === 'APPROVED') {
    return { label: 'Scheduled', className: 'rh-status-scheduled' };
  }

  if (rhDecision === 'APPROVED') {
    return { label: 'Approved', className: 'rh-status-approved' };
  }

  return { label: 'Pending RH', className: 'rh-status-pending' };
};

const isRhNewRequest = (request) => {
  return isRhActionable(request);
};

const getRhFilteredRequests = () => {
  const scoped = getVisibleRequests();

  const filtered = scoped.filter((request) => {
    if (state.rhCityFilter !== 'all' && String(request?.city || '').trim() !== state.rhCityFilter) {
      return false;
    }

    if (state.rhClientFilter !== 'all' && String(request?.clientName || '').trim() !== state.rhClientFilter) {
      return false;
    }

    if (state.rhDateFilter) {
      const requestDate = toDateInputValue(request?.createdAt);
      if (requestDate !== state.rhDateFilter) {
        return false;
      }
    }

    return true;
  });

  return sortRequestsNewestFirst(filtered);
};

const openRhModal = (requestId, view = 'details') => {
  const request = getRhRequestById(requestId);
  if (!request) {
    return;
  }

  state.rhModalRequestId = String(request.id || '');
  state.rhModalView = view;
  state.rhEditClientName = String(request.clientName || '');
  state.rhEditCity = String(request.city || '');
  state.rhRejectReason = '';
};

const closeRhModal = () => {
  state.rhModalRequestId = null;
  state.rhModalView = 'details';
  state.rhEditClientName = '';
  state.rhEditCity = '';
  state.rhRejectReason = '';
};

const patchRhRequestInState = (requestId, patch) => {
  const targetId = String(requestId || '').trim();
  if (!targetId || !patch || typeof patch !== 'object') {
    return;
  }

  state.requests = state.requests.map((request) => {
    if (String(request?.id || '').trim() !== targetId) {
      return request;
    }

    return {
      ...request,
      ...patch,
    };
  });
};

const handleRhApproveFromModal = async (root) => {
  const request = getRhRequestById(state.rhModalRequestId);
  if (!request?.id) {
    state.error = 'Request not found.';
    render(root);
    return;
  }

  if (!isRhActionable(request)) {
    state.error = 'Request is not actionable for RH at current workflow stage.';
    render(root);
    return;
  }

  try {
    state.rhBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    if (request.isBulkRequest) {
      await requestService.approveBulkRequest(request.id, userRef());
    } else {
      await requestService.approveRequest(request.id, userRef(), 'RH');
    }

    patchRhRequestInState(request.id, {
      rhApproval: true,
      rhActionTaken: true,
      rhStatus: 'APPROVED',
    });

    closeRhModal();
    state.notice = `Request ${formatRequestIdDisplay(request.id)} approved.`;
  } catch (error) {
    state.error = error?.message || 'Failed to approve request.';
  } finally {
    state.rhBusy = false;
    render(root);
  }
};

const handleRhEditApproveFromModal = async (root) => {
  const request = getRhRequestById(state.rhModalRequestId);
  if (!request?.id) {
    state.error = 'Request not found.';
    render(root);
    return;
  }

  if (!isRhActionable(request)) {
    state.error = 'Request is not actionable for RH at current workflow stage.';
    render(root);
    return;
  }

  if (request.isBulkRequest) {
    state.error = 'Edit & Approve is available only for single requests.';
    render(root);
    return;
  }

  const nextClientName = String(state.rhEditClientName || '').trim();
  const nextCity = String(state.rhEditCity || '').trim();

  if (!nextClientName || !nextCity) {
    state.error = 'Client name and city are required.';
    render(root);
    return;
  }

  const status = getStatus(request);
  const canEditFields = status === REQUEST_STATUSES.PARALLEL_REVIEW;
  const updates = {};

  if (canEditFields) {
    if (nextClientName !== String(request.clientName || '').trim()) {
      updates.clientName = nextClientName;
    }

    if (nextCity !== String(request.city || '').trim()) {
      updates.city = nextCity;
    }
  } else if (
    nextClientName !== String(request.clientName || '').trim() ||
    nextCity !== String(request.city || '').trim()
  ) {
    state.error = 'Client and city can be edited only while request is pending RH approval.';
    render(root);
    return;
  }

  try {
    state.rhBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    if (Object.keys(updates).length > 0) {
      await requestService.editAndApprove(request.id, updates, userRef(), 'RH');
      state.notice = `Request ${formatRequestIdDisplay(request.id)} updated and approved.`;
    } else {
      await requestService.approveRequest(request.id, userRef(), 'RH');
      state.notice = `Request ${formatRequestIdDisplay(request.id)} approved.`;
    }

    patchRhRequestInState(request.id, {
      ...updates,
      rhApproval: true,
      rhActionTaken: true,
      rhStatus: 'APPROVED',
    });

    closeRhModal();
  } catch (error) {
    state.error = error?.message || 'Failed to save and approve request.';
  } finally {
    state.rhBusy = false;
    render(root);
  }
};

const handleRhRejectFromModal = async (root) => {
  const request = getRhRequestById(state.rhModalRequestId);
  if (!request?.id) {
    state.error = 'Request not found.';
    render(root);
    return;
  }

  if (!isRhActionable(request)) {
    state.error = 'Request is not actionable for RH at current workflow stage.';
    render(root);
    return;
  }

  const reason = String(state.rhRejectReason || '').trim();
  if (!reason) {
    state.error = 'Rejection reason is required.';
    render(root);
    return;
  }

  try {
    state.rhBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    if (request.isBulkRequest) {
      await requestService.rejectBulkRequest(request.id, reason, userRef());
    } else {
      await requestService.rejectRequest(request.id, userRef(), 'RH', reason);
    }

    patchRhRequestInState(request.id, {
      status: REQUEST_STATUSES.HALTED,
      rhStatus: 'REJECTED',
      rhActionTaken: true,
      rejectionReason: reason,
    });

    closeRhModal();
    state.notice = `Request ${formatRequestIdDisplay(request.id)} rejected.`;
  } catch (error) {
    state.error = error?.message || 'Failed to reject request.';
  } finally {
    state.rhBusy = false;
    render(root);
  }
};

const handleRhApproveSelected = async (root) => {
  const rows = getRhFilteredRequests();
  const actionableRows = rows.filter((request) => isRhNewRequest(request) && isRhActionable(request));

  if (actionableRows.length === 0) {
    state.error = 'No pending RH requests available to approve.';
    render(root);
    return;
  }

  try {
    state.rhBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    let approvedCount = 0;

    for (const request of actionableRows) {
      if (!request?.id) {
        continue;
      }

      if (request.isBulkRequest) {
        await requestService.approveBulkRequest(request.id, userRef());
      } else {
        await requestService.approveRequest(request.id, userRef(), 'RH');
      }

      patchRhRequestInState(request.id, {
        rhApproval: true,
        rhActionTaken: true,
        rhStatus: 'APPROVED',
      });

      approvedCount += 1;
    }

    state.rhSelectedRequestIds = [];
    state.notice = approvedCount > 0 ? `${approvedCount} pending request(s) approved.` : 'No requests were approved.';
  } catch (error) {
    state.error = error?.message || 'Failed to approve selected requests.';
  } finally {
    state.rhBusy = false;
    render(root);
  }
};

const getRhVehicleDisplay = (request) => {
  const vehicleNumbers = normalizeVehicles(request)
    .map((vehicle) => String(vehicle?.vehicleNumber || '').trim())
    .filter(Boolean);

  if (vehicleNumbers.length === 0) {
    return 'N/A';
  }

  if (vehicleNumbers.length === 1) {
    return vehicleNumbers[0];
  }

  return `${vehicleNumbers[0]} +${vehicleNumbers.length - 1}`;
};

const getRhServiceBadgeClass = (request, serviceLabel) => {
  const normalizedFromLabel = normalizeVendorName(serviceLabel);
  const normalizedFromRequest = normalizeVendorName(request?.serviceType || request?.vendorType);

  const serviceValue = normalizedFromLabel || normalizedFromRequest || String(serviceLabel || '').trim();
  const normalizedValue = String(serviceValue || '').trim().toLowerCase();

  if (normalizedValue === 'fleetx') {
    return 'fleetx';
  }

  if (normalizedValue === 'wheelseye') {
    return 'wheelseye';
  }

  if (normalizedValue === 'mixed') {
    return 'mixed';
  }

  return 'default';
};

const rhTableRows = (rows) => {
  if (rows.length === 0) {
    return `<tr><td colspan="7" class="text-muted">No requests found</td></tr>`;
  }

  return rows
    .map((request) => {
      const requestId = String(request?.id || '');
      const statusMeta = getRhStatusMeta(request);
      const canAct = isRhActionable(request);
      const serviceLabel = getServiceLabel(request);
      const serviceBadgeClass = getRhServiceBadgeClass(request, serviceLabel);
      const vehicleDisplay = getRhVehicleDisplay(request);
      const createdDate = toDate(request?.createdAt);

      return `
        <tr class="${canAct ? 'rh-row-actionable' : ''}">
          <td class="rh-request-id-cell" data-label="Request ID">
            <strong>${escapeHtml(formatRequestIdDisplay(requestId))}</strong>
            <small>${escapeHtml(toDate(request?.createdAt))}</small>
          </td>
          <td data-label="Status">
            <span class="rh-status-pill ${escapeHtml(statusMeta.className)}">${escapeHtml(statusMeta.label)}</span>
          </td>
          <td data-label="Client">
            <div class="rh-client-cell">
              <strong>${escapeHtml(request?.clientName || 'N/A')}</strong>
              <small>${escapeHtml(request?.city || 'N/A')}</small>
            </div>
          </td>
          <td class="rh-vehicle-cell rh-col-vehicle" data-label="Vehicle Number">${escapeHtml(vehicleDisplay)}</td>
          <td class="rh-col-service" data-label="Service Type">
            <span class="rh-service-badge ${escapeHtml(serviceBadgeClass)}">${escapeHtml(serviceLabel)}</span>
          </td>
          <td class="rh-date-cell rh-col-date" data-label="Date">${escapeHtml(createdDate)}</td>
          <td class="rh-actions-cell" data-label="Action">
            <button class="rh-row-btn view" data-action="rh-open-details" data-request-id="${escapeHtml(requestId)}">View</button>
            <button class="rh-row-btn approve" data-action="rh-row-approve" data-request-id="${escapeHtml(requestId)}" ${
              !canAct || state.rhBusy ? 'disabled' : ''
            }>Approve</button>
            <button class="rh-row-btn reject" data-action="rh-row-reject" data-request-id="${escapeHtml(requestId)}" ${
              !canAct || state.rhBusy ? 'disabled' : ''
            }>Reject</button>
          </td>
        </tr>
      `;
    })
    .join('');
};

const rhRequestModal = () => {
  if (state.role !== 'RH' || !state.rhModalRequestId) {
    return '';
  }

  const request = getRhRequestById(state.rhModalRequestId);
  if (!request) {
    return '';
  }

  const statusMeta = getRhStatusMeta(request);
  const vehicles = normalizeVehicles(request);
  const primaryVehicle = vehicles[0] || {};
  const paymentDecision = getPaymentDecision(request);
  const paymentLabel = paymentDecision === 'APPROVED' ? 'Verified' : paymentDecision === 'REJECTED' ? 'Rejected' : 'Pending';
  const priorityLabel = getVehicleCount(request) >= 10 ? 'High' : 'Normal';
  const canAct = isRhActionable(request);

  if (state.rhModalView === 'edit') {
    return `
      <div class="rh-modal-backdrop">
        <div class="rh-edit-modal">
          <div class="rh-modal-top">
            <button type="button" class="rh-modal-icon" data-action="rh-close-modal">×</button>
            <h2>Edit Request</h2>
            <button type="button" class="rh-modal-icon" data-action="rh-back-details">✓</button>
          </div>

          <div class="rh-edit-body">
            <div class="rh-edit-field">
              <label>Client Name</label>
              <input data-rh-edit-field="rhEditClientName" type="text" value="${escapeHtml(state.rhEditClientName)}" />
            </div>
            <div class="rh-edit-field">
              <label>City</label>
              <input data-rh-edit-field="rhEditCity" type="text" value="${escapeHtml(state.rhEditCity)}" />
            </div>
            <button type="button" class="rh-primary-btn" data-action="rh-save-approve" ${state.rhBusy ? 'disabled' : ''}>Save & Approve</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.rhModalView === 'reject') {
    return `
      <div class="rh-modal-backdrop">
        <div class="rh-edit-modal reject">
          <div class="rh-modal-top">
            <button type="button" class="rh-modal-icon" data-action="rh-back-details">←</button>
            <h2>Reject Request</h2>
            <span class="rh-modal-spacer"></span>
          </div>

          <div class="rh-edit-body">
            <div class="rh-edit-field">
              <div class="rh-reject-head">
                <label>Rejection Reason</label>
                <small>Required</small>
              </div>
              <textarea data-rh-reject-reason rows="4" placeholder="Please provide a detailed reason for rejecting this request">${escapeHtml(
                state.rhRejectReason
              )}</textarea>
            </div>

            <div class="rh-reject-note">This action cannot be undone. The client will be notified immediately of this rejection.</div>

            <div class="rh-reject-actions">
              <button type="button" class="rh-secondary-btn" data-action="rh-back-details">Cancel</button>
              <button type="button" class="rh-danger-btn" data-action="rh-confirm-reject" ${
                state.rhBusy ? 'disabled' : ''
              }>Reject</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="rh-modal-backdrop">
      <div class="rh-details-modal">
        <div class="rh-details-head">
          <h2>${escapeHtml(formatRequestIdDisplay(request.id))}</h2>
          <p>Submitted for ${escapeHtml(request?.city || 'N/A')}</p>
          <button type="button" class="rh-modal-close" data-action="rh-close-modal">×</button>
        </div>

        <div class="rh-overview-grid">
          <div>
            <span>Vehicle Count</span>
            <strong>${getVehicleCount(request)} Units</strong>
          </div>
          <div>
            <span>Payment</span>
            <strong>${escapeHtml(paymentLabel)}</strong>
          </div>
          <div>
            <span>Location</span>
            <strong>${escapeHtml(primaryVehicle?.vehicleAvailabilityLocation || request?.vehicleAvailabilityLocation || 'Main Depot')}</strong>
          </div>
          <div>
            <span>Priority</span>
            <strong>${escapeHtml(priorityLabel)}</strong>
          </div>
        </div>

        <div class="rh-client-card">
          <h3>${escapeHtml(request?.clientName || 'Unknown Client')}</h3>
          <p>Assigned RH: ${escapeHtml(getAssignedRhDisplay(request))}</p>
          <div class="rh-client-tags">
            <span>${escapeHtml(statusMeta.label)}</span>
            <span>${request.isBulkRequest ? 'Bulk Tier' : 'Single Request'}</span>
          </div>
        </div>

        <div class="rh-modal-actions">
          <button type="button" class="rh-primary-btn" data-action="rh-approve" ${
            !canAct || state.rhBusy ? 'disabled' : ''
          }>Approve</button>
          <button type="button" class="rh-secondary-btn" data-action="rh-open-edit" ${
            !canAct || request.isBulkRequest || state.rhBusy ? 'disabled' : ''
          }>Edit & Approve</button>
          <button type="button" class="rh-danger-outline-btn" data-action="rh-open-reject" ${
            !canAct || state.rhBusy ? 'disabled' : ''
          }>Reject</button>
        </div>
      </div>
    </div>
  `;
};

const rhDashboardShell = () => {
  const roleScopedRequests = getRoleScopedRequests('RH');
  const rhView = ['dashboard', 'history', 'profile'].includes(state.rhView)
    ? state.rhView
    : 'dashboard';

  const cityOptions = [...new Set(roleScopedRequests.map((request) => String(request?.city || '').trim()).filter(Boolean))].sort();
  const clientOptions = [...new Set(roleScopedRequests.map((request) => String(request?.clientName || '').trim()).filter(Boolean))].sort();
  const newCount = roleScopedRequests.filter((request) => isRhNewRequest(request)).length;
  const historyCount = roleScopedRequests.filter((request) => !isRhNewRequest(request)).length;
  const rows = getRhFilteredRequests();

  const newRows = rows.filter((request) => isRhNewRequest(request));
  const historyRows = rows.filter((request) => !isRhNewRequest(request));

  let viewTitle = 'Pending RH Review';
  let viewSubtitle = 'Dashboard shows requests still pending RH compliance review, including payment-approved requests.';
  let viewRows = newRows;
  let footerLabel = `Pending shown: ${newRows.length} • Ready for RH action: ${newRows.length}`;
  let showBulkApprove = true;

  if (rhView === 'history') {
    viewTitle = 'History';
    viewSubtitle = 'Requests move here after RH action or final closure for audit trail.';
    viewRows = historyRows;
    footerLabel = `History shown: ${historyRows.length}`;
    showBulkApprove = false;
  }

  if (state.rhSelectedRequestIds.length > 0) {
    state.rhSelectedRequestIds = [];
  }

  return `
    <div class="stitch-app-shell">
      <aside class="stitch-sidebar" aria-label="Navigation">
        ${renderSidebarBrand()}
        <div class="stitch-sidebar-role">Regional Head</div>
        <nav class="stitch-sidebar-nav">
          <span class="${rhView === 'dashboard' ? 'active' : ''}" data-action="rh-nav" data-view="dashboard">Dashboard</span>
          <span class="${rhView === 'history' ? 'active' : ''}" data-action="rh-nav" data-view="history">History</span>
          <span class="${rhView === 'profile' ? 'active' : ''}" data-action="rh-nav" data-view="profile">Profile</span>
          <button type="button" class="stitch-sidebar-logout" data-action="logout">Logout</button>
        </nav>
      </aside>

      <main class="dashboard-container fo-dashboard-container">
        <div class="fo-console-header rh-console-header">
          <div class="fo-console-title rh-console-title">
            ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
            <h1>Regional Head Console</h1>
          </div>
          <div class="fo-console-actions rh-console-actions">
            <div class="fo-user-meta fo-user-meta-card rh-user-meta-card">
              <span>Signed in</span>
              <strong>${escapeHtml(state.user?.email || 'Regional Head')}</strong>
              <small>Regional Head</small>
            </div>
            <button type="button" class="btn btn-secondary fo-logout-inline rh-logout-inline" data-action="logout">Logout</button>
          </div>
        </div>

        ${renderRhMobileNav(rhView)}

        ${state.error ? `<div class="dashboard-summary"><span class="stitch-alert danger">${escapeHtml(state.error)}</span></div>` : ''}
        ${state.notice ? `<div class="dashboard-summary"><span class="stitch-alert success">${escapeHtml(state.notice)}</span></div>` : ''}

        ${
          rhView === 'profile'
            ? rhProfileSection(roleScopedRequests)
            : `
          <section class="rh-welcome-card">
            <h2>${escapeHtml(viewTitle)}</h2>
            <p>${escapeHtml(viewSubtitle)}</p>
          </section>

          ${
            showBulkApprove
              ? `<section class="rh-action-row">
              <button type="button" class="rh-primary-btn" data-action="rh-approve-selected" ${
                newRows.length === 0 || state.rhBusy ? 'disabled' : ''
              }>Approve All Pending</button>
            </section>`
              : ''
          }

          <section class="rh-kpi-grid">
            <article class="rh-kpi-card">
              <span>Total Assigned</span>
              <strong>${roleScopedRequests.length}</strong>
              <small>all assigned requests</small>
            </article>
            <article class="rh-kpi-card">
              <span>History</span>
              <strong>${historyCount}</strong>
              <small>non-new requests</small>
            </article>
            <article class="rh-kpi-card primary">
              <span>New Requests</span>
              <strong>${newCount}</strong>
              <small>Action Required</small>
            </article>
          </section>

          <section class="rh-filter-card">
            <input
              data-rh-filter="searchTerm"
              value="${escapeHtml(state.searchTerm)}"
              type="text"
              placeholder="Search ID, Client, or City..."
            />
            <select data-rh-filter="rhCityFilter">
              <option value="all" ${state.rhCityFilter === 'all' ? 'selected' : ''}>All Cities</option>
              ${cityOptions
                .map(
                  (city) =>
                    `<option value="${escapeHtml(city)}" ${state.rhCityFilter === city ? 'selected' : ''}>${escapeHtml(
                      city
                    )}</option>`
                )
                .join('')}
            </select>
            <select data-rh-filter="rhClientFilter">
              <option value="all" ${state.rhClientFilter === 'all' ? 'selected' : ''}>All Clients</option>
              ${clientOptions
                .map(
                  (client) =>
                    `<option value="${escapeHtml(client)}" ${state.rhClientFilter === client ? 'selected' : ''}>${escapeHtml(
                      client
                    )}</option>`
                )
                .join('')}
            </select>
            <input data-rh-filter="rhDateFilter" value="${escapeHtml(state.rhDateFilter)}" type="date" />
          </section>

          <section class="rh-table-card">
            <div class="rh-table-wrapper">
              <table class="rh-table">
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>Status</th>
                    <th>Client</th>
                    <th>Vehicle Number</th>
                    <th>Service Type</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>${rhTableRows(viewRows)}</tbody>
              </table>
            </div>

            <div class="rh-table-footer">
              <p>${escapeHtml(footerLabel)}</p>
            </div>
          </section>
        `
        }
      </main>

      ${rhRequestModal()}
    </div>
  `;
};

const renderPaymentMobileNav = (paymentView) => {
  return `
    <nav class="payment-mobile-nav" aria-label="Payment team mobile navigation">
      <button type="button" class="${paymentView === 'dashboard' ? 'active' : ''}" data-action="payment-nav" data-view="dashboard">Dashboard</button>
      <button type="button" class="${paymentView === 'history' ? 'active' : ''}" data-action="payment-nav" data-view="history">History</button>
      <button type="button" class="${paymentView === 'profile' ? 'active' : ''}" data-action="payment-nav" data-view="profile">Profile</button>
    </nav>
  `;
};

const getPaymentRequestById = (requestId) =>
  state.requests.find((item) => String(item?.id || '') === String(requestId || '')) || null;

const parsePaymentVehicleIndex = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const isPaymentBulkStage = (request) => {
  const normalizedStatus = normalizeStatusValue(request?.status);
  if (
    normalizedStatus === REQUEST_STATUSES.PARALLEL_REVIEW ||
    normalizedStatus === REQUEST_STATUSES.FO_CREATED ||
    normalizedStatus === REQUEST_STATUSES.PAYMENT_PENDING
  ) {
    return true;
  }

  return getStatus(request) === REQUEST_STATUSES.PARALLEL_REVIEW;
};

const buildPaymentRowsForRequest = (request) => {
  const requestId = String(request?.id || '').trim();
  if (!requestId) {
    return [];
  }

  const city = String(request?.city || '').trim();
  const clientName = String(request?.clientName || '').trim();
  const createdAtMs = getRequestCreatedAtMs(request);
  const createdDate = createdAtMs > 0 ? toDate(createdAtMs) : toDate(request?.createdAt);
  const createdDateIso = createdAtMs > 0 ? toDateInputValue(createdAtMs) : toDateInputValue(request?.createdAt);
  const requestPaymentStatus = normalizeStatusValue(request?.paymentStatus);
  const vehicles = normalizeVehicles(request);
  const ltpocRows = normalizeRecordList(request?.ltpocDetails);
  const ltpocByVehicle = new Map(
    ltpocRows
      .map((item) => [String(item?.vehicleNumber || '').trim(), item])
      .filter(([vehicleNumber]) => Boolean(vehicleNumber))
  );

  if (request?.isBulkRequest && vehicles.length > 0) {
    const hasVehiclePaymentSignals = vehicles.some(
      (vehicle) =>
        vehicle?.paymentApproved !== undefined ||
        vehicle?.paymentRejected !== undefined ||
        vehicle?.paymentActionTaken !== undefined ||
        vehicle?.paymentApprovedAt !== undefined ||
        vehicle?.paymentRejectedAt !== undefined
    );

    return vehicles.map((vehicle, vehicleIndex) => {
      const rowVehicle = vehicle || {};
      const vehicleNumber =
        String(rowVehicle?.vehicleNumber || '').trim() ||
        String(ltpocRows[vehicleIndex]?.vehicleNumber || '').trim() ||
        `Vehicle ${vehicleIndex + 1}`;
      const ltpoc = ltpocByVehicle.get(vehicleNumber) || ltpocRows[vehicleIndex] || {};
      const vehiclePaymentStatus = normalizeStatusValue(rowVehicle?.paymentStatus);

      const legacyApproved = !hasVehiclePaymentSignals && requestPaymentStatus === 'APPROVED';
      const legacyRejected = !hasVehiclePaymentSignals && requestPaymentStatus === 'REJECTED';

      const rowPaymentApproved =
        toBooleanFlag(rowVehicle?.paymentApproved) ||
        Boolean(rowVehicle?.paymentApprovedAt) ||
        vehiclePaymentStatus === 'APPROVED' ||
        legacyApproved;

      const rowPaymentRejected =
        toBooleanFlag(rowVehicle?.paymentRejected) ||
        Boolean(rowVehicle?.paymentRejectedAt) ||
        vehiclePaymentStatus === 'REJECTED' ||
        legacyRejected;

      const rowPaymentActionTaken =
        toBooleanFlag(rowVehicle?.paymentActionTaken) || rowPaymentApproved || rowPaymentRejected;

      const serviceType =
        normalizeServiceType(rowVehicle?.serviceType || rowVehicle?.vendorType || '') || 'N/A';

      return {
        requestId,
        request,
        isBulkRequest: true,
        vehicleIndex,
        city,
        clientName,
        createdDate,
        createdDateIso,
        createdAtMs,
        serviceType,
        serviceCost: getServiceCostByType(serviceType, rowVehicle?.serviceCost ?? request?.serviceCost),
        vehicleNumber,
        vehicleAvailabilityLocation: String(
          rowVehicle?.vehicleAvailabilityLocation || request?.vehicleAvailabilityLocation || ''
        ).trim(),
        vehicleAvailableTime: String(rowVehicle?.vehicleAvailableTime || request?.vehicleAvailableTime || '').trim(),
        ltpocName: String(rowVehicle?.ltpocName || ltpoc?.ltpocName || '').trim(),
        ltpocPhone: String(rowVehicle?.ltpocPhone || ltpoc?.ltpocPhone || '').trim(),
        rowPaymentApproved,
        rowPaymentRejected,
        rowPaymentActionTaken,
        rejectionReason: getPaymentRejectionReason(request, rowVehicle),
      };
    });
  }

  const primaryVehicle = vehicles[0] || {};
  const rowPaymentApproved =
    toBooleanFlag(request?.paymentApproval) ||
    toBooleanFlag(request?.paymentApproved) ||
    requestPaymentStatus === 'APPROVED';
  const rowPaymentRejected = toBooleanFlag(request?.paymentRejected) || requestPaymentStatus === 'REJECTED';
  const rowPaymentActionTaken = toBooleanFlag(request?.paymentActionTaken) || rowPaymentApproved || rowPaymentRejected;
  const serviceType =
    normalizeServiceType(primaryVehicle?.serviceType || primaryVehicle?.vendorType || request?.serviceType) || 'N/A';

  return [
    {
      requestId,
      request,
      isBulkRequest: false,
      vehicleIndex: null,
      city,
      clientName,
      createdDate,
      createdDateIso,
      createdAtMs,
      serviceType,
      serviceCost: getServiceCostByType(serviceType, request?.serviceCost),
      vehicleNumber: String(primaryVehicle?.vehicleNumber || '').trim(),
      vehicleAvailabilityLocation: String(request?.vehicleAvailabilityLocation || '').trim(),
      vehicleAvailableTime: String(request?.vehicleAvailableTime || '').trim(),
      ltpocName: String(primaryVehicle?.ltpocName || ltpocRows[0]?.ltpocName || '').trim(),
      ltpocPhone: String(primaryVehicle?.ltpocPhone || ltpocRows[0]?.ltpocPhone || '').trim(),
      rowPaymentApproved,
      rowPaymentRejected,
      rowPaymentActionTaken,
      rejectionReason: getPaymentRejectionReason(request, null),
    },
  ];
};

const canTakePaymentRowAction = (request, row) => {
  if (!request || !row) {
    return false;
  }

  const requestPaymentDecision = getPaymentDecision(request);
  if (
    requestPaymentDecision !== 'PENDING' &&
    row.rowPaymentActionTaken !== true &&
    row.rowPaymentApproved !== true &&
    row.rowPaymentRejected !== true
  ) {
    return false;
  }

  if (row.rowPaymentApproved || row.rowPaymentRejected || row.rowPaymentActionTaken) {
    return false;
  }

  if (isClosed(request)) {
    return false;
  }

  if (row.isBulkRequest) {
    if (!Number.isInteger(row.vehicleIndex)) {
      return false;
    }

    return isPaymentBulkStage(request);
  }

  return isPaymentActionable(request);
};

const getPaymentRowKey = (row) => {
  if (row.isBulkRequest) {
    return `B:${row.requestId}:${Number(row.vehicleIndex)}`;
  }

  return `S:${row.requestId}`;
};

const getPaymentFilteredRequests = () => {
  const scoped = getVisibleRequests();

  return scoped.filter((request) => {
    const city = String(request?.city || '').trim();
    if (state.paymentCityFilter !== 'all' && city !== state.paymentCityFilter) {
      return false;
    }

    const requestDate = toDateInputValue(request?.createdAt);
    if (state.paymentDateFrom && (!requestDate || requestDate < state.paymentDateFrom)) {
      return false;
    }

    if (state.paymentDateTo && (!requestDate || requestDate > state.paymentDateTo)) {
      return false;
    }

    return true;
  });
};

const getPaymentRows = () => {
  const filteredRequests = getPaymentFilteredRequests();
  const allRows = filteredRequests
    .flatMap((request) => buildPaymentRowsForRequest(request))
    .sort((left, right) => right.createdAtMs - left.createdAtMs);

  const pendingRows = allRows.filter((row) => canTakePaymentRowAction(row.request, row));
  const historyRows = allRows.filter((row) => !canTakePaymentRowAction(row.request, row));

  let viewRows = state.paymentView === 'history' ? historyRows : pendingRows;

  if (state.paymentView === 'history' && state.paymentStatusFilter === 'APPROVED') {
    viewRows = viewRows.filter((row) => row.rowPaymentApproved === true);
  }

  if (state.paymentView === 'history' && state.paymentStatusFilter === 'REJECTED') {
    viewRows = viewRows.filter((row) => row.rowPaymentRejected === true);
  }

  return {
    filteredRequests,
    allRows,
    pendingRows,
    historyRows,
    viewRows,
  };
};

const openPaymentModal = (requestId, vehicleIndex = null) => {
  const request = getPaymentRequestById(requestId);
  if (!request) {
    return;
  }

  state.paymentModalRequestId = String(request.id || '');
  state.paymentModalVehicleIndex = Number.isInteger(vehicleIndex) ? Number(vehicleIndex) : null;
};

const closePaymentModal = () => {
  state.paymentModalRequestId = null;
  state.paymentModalVehicleIndex = null;
};

const openPaymentRejectModal = (requestId, vehicleIndex = null) => {
  const request = getPaymentRequestById(requestId);
  if (!request) {
    return;
  }

  state.paymentRejectRequestId = String(request.id || '');
  state.paymentRejectVehicleIndex = Number.isInteger(vehicleIndex) ? Number(vehicleIndex) : null;
  state.paymentRejectReason = '';
};

const closePaymentRejectModal = () => {
  state.paymentRejectRequestId = null;
  state.paymentRejectVehicleIndex = null;
  state.paymentRejectReason = '';
};

const getPaymentStatusMeta = (request, row) => {
  if (row.rowPaymentRejected) {
    return { label: 'Rejected', className: 'rh-status-rejected' };
  }

  if (row.rowPaymentApproved) {
    return { label: 'Approved', className: 'rh-status-approved' };
  }

  if (canTakePaymentRowAction(request, row)) {
    return { label: 'Pending Review', className: 'rh-status-pending' };
  }

  const status = getStatus(request);
  if (status === REQUEST_STATUSES.COMPLETED) {
    return { label: 'Completed', className: 'rh-status-approved' };
  }

  if (status === REQUEST_STATUSES.CANCELLED) {
    return { label: 'Cancelled', className: 'rh-status-cancelled' };
  }

  if (status === REQUEST_STATUSES.HALTED) {
    return { label: 'Halted', className: 'rh-status-rejected' };
  }

  if (status === REQUEST_STATUSES.VENDOR_COORDINATION) {
    return { label: 'Vendor Stage', className: 'rh-status-scheduled' };
  }

  return { label: getUnifiedStatusLabel(status), className: 'rh-status-pending' };
};

const paymentTableRows = (rows) => {
  const extraColumnSpan = state.paymentShowAdditionalColumns ? 5 : 0;

  if (rows.length === 0) {
    return `<tr><td colspan="${9 + extraColumnSpan}" class="text-muted">No requests found</td></tr>`;
  }

  return rows
    .map((row) => {
      const rowKey = getPaymentRowKey(row);
      const statusMeta = getPaymentStatusMeta(row.request, row);
      const canAct = canTakePaymentRowAction(row.request, row);
      const isSelected = state.paymentSelectedRowKeys.includes(rowKey);
      const requestId = String(row.requestId || '').trim();
      const vehicleIndexAttr = Number.isInteger(row.vehicleIndex) ? String(row.vehicleIndex) : '';
      const serviceBadgeClass = getRhServiceBadgeClass(row.request, row.serviceType);
      const costLabel =
        row.serviceCost !== null && row.serviceCost !== undefined
          ? `₹${Number(row.serviceCost).toLocaleString('en-IN')}`
          : 'N/A';
      const actionMarkup = canAct
        ? `
              <button class="rh-row-btn approve" data-action="payment-approve-row" data-request-id="${escapeHtml(
                requestId
              )}" data-vehicle-index="${escapeHtml(vehicleIndexAttr)}" ${
                state.paymentBusy ? 'disabled' : ''
              }>Accept</button>
              <button class="rh-row-btn reject" data-action="payment-open-reject" data-request-id="${escapeHtml(
                requestId
              )}" data-vehicle-index="${escapeHtml(vehicleIndexAttr)}" ${
                state.paymentBusy ? 'disabled' : ''
              }>Reject</button>
            `
        : '<span class="text-muted payment-reviewed-label">Reviewed</span>';

      return `
        <tr class="${canAct ? 'rh-row-actionable' : ''}">
          <td class="payment-select-col payment-col-select" data-label="Select">
            ${
              canAct
                ? `<input type="checkbox" data-action="payment-toggle-row" data-row-key="${escapeHtml(rowKey)}" ${
                    isSelected ? 'checked' : ''
                  } ${state.paymentBusy ? 'disabled' : ''} />`
                : ''
            }
          </td>
          <td class="rh-request-id-cell payment-col-request-id" data-label="Request ID">
            <strong>${escapeHtml(formatRequestIdDisplay(requestId))}</strong>
            <small>${escapeHtml(row.isBulkRequest ? 'Bulk' : 'Single')}</small>
          </td>
          <td class="payment-col-status" data-label="Status"><span class="rh-status-pill ${escapeHtml(statusMeta.className)}">${escapeHtml(
            statusMeta.label
          )}</span></td>
          <td class="payment-col-client" data-label="Client">
            <div class="rh-client-cell">
              <strong>${escapeHtml(row.clientName || 'N/A')}</strong>
              <small>${escapeHtml(row.city || 'N/A')}</small>
            </div>
          </td>
          <td class="rh-vehicle-cell rh-col-vehicle payment-col-vehicle" data-label="Vehicle">${escapeHtml(row.vehicleNumber || 'N/A')}</td>
          <td class="rh-col-service payment-col-service" data-label="Service Type">
            <span class="rh-service-badge ${escapeHtml(serviceBadgeClass)}">${escapeHtml(row.serviceType || 'N/A')}</span>
          </td>
          <td class="payment-charge-cell payment-col-charge" data-label="Service Charge">${escapeHtml(costLabel)}</td>
          <td class="rh-date-cell rh-col-date payment-col-date" data-label="Date">${escapeHtml(row.createdDate || 'N/A')}</td>
          <td class="rh-actions-cell payment-col-action" data-label="Action">
            <div class="payment-action-group">
              <button class="rh-row-btn view" data-action="payment-open-details" data-request-id="${escapeHtml(
                requestId
              )}" data-vehicle-index="${escapeHtml(vehicleIndexAttr)}">View</button>
              ${actionMarkup}
            </div>
          </td>
          ${
            state.paymentShowAdditionalColumns
              ? `
            <td class="payment-col-location" data-label="Location">${escapeHtml(row.vehicleAvailabilityLocation || 'N/A')}</td>
            <td class="payment-col-time" data-label="Time">${escapeHtml(row.vehicleAvailableTime || 'N/A')}</td>
            <td class="payment-col-ltpoc" data-label="LTPOC">${escapeHtml(row.ltpocName || 'N/A')}</td>
            <td class="payment-col-ltpoc-phone" data-label="LTPOC Phone">${escapeHtml(row.ltpocPhone || 'N/A')}</td>
            <td class="payment-col-reason" data-label="Rejection Reason">${escapeHtml(row.rejectionReason || '—')}</td>
          `
              : ''
          }
        </tr>
      `;
    })
    .join('');
};

const paymentProfileSection = (requests, allRows) => {
  const pendingRows = allRows.filter((row) => canTakePaymentRowAction(row.request, row)).length;
  const approvedRows = allRows.filter((row) => row.rowPaymentApproved).length;
  const rejectedRows = allRows.filter((row) => row.rowPaymentRejected).length;

  return `
    <section class="fo-requests-shell">
      <div class="fo-requests-head">
        <h2>Profile</h2>
      </div>

      <div class="fo-profile-card">
        <div class="fo-profile-grid">
          <div>
            <span>Email</span>
            <strong>${escapeHtml(state.user?.email || 'N/A')}</strong>
          </div>
          <div>
            <span>Division</span>
            <strong>Payment Team</strong>
          </div>
          <div>
            <span>Total Requests</span>
            <strong>${requests.length}</strong>
          </div>
          <div>
            <span>Pending Rows</span>
            <strong>${pendingRows}</strong>
          </div>
          <div>
            <span>Approved Rows</span>
            <strong>${approvedRows}</strong>
          </div>
          <div>
            <span>Rejected Rows</span>
            <strong>${rejectedRows}</strong>
          </div>
        </div>
      </div>
    </section>
  `;
};

const paymentDashboardShell = () => {
  const roleScopedRequests = getRoleScopedRequests('PAYMENT');
  const paymentView = ['dashboard', 'history', 'profile'].includes(state.paymentView)
    ? state.paymentView
    : 'dashboard';

  const { viewRows } = getPaymentRows();
  const roleScopedRows = roleScopedRequests
    .flatMap((request) => buildPaymentRowsForRequest(request))
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
  const rolePendingRows = roleScopedRows.filter((row) => canTakePaymentRowAction(row.request, row));
  const roleHistoryRows = roleScopedRows.filter((row) => !canTakePaymentRowAction(row.request, row));
  const totalRequestCount = roleScopedRequests.length;
  const pendingRequestCount = new Set(rolePendingRows.map((row) => String(row?.requestId || '').trim()).filter(Boolean)).size;
  const processedRequestCount = new Set(roleHistoryRows.map((row) => String(row?.requestId || '').trim()).filter(Boolean)).size;
  const cityOptions = [...new Set(roleScopedRequests.map((request) => String(request?.city || '').trim()).filter(Boolean))].sort();

  const selectableRows = viewRows.filter((row) => canTakePaymentRowAction(row.request, row));
  const selectableKeys = selectableRows.map((row) => getPaymentRowKey(row));
  const selectedRows = selectableRows.filter((row) => state.paymentSelectedRowKeys.includes(getPaymentRowKey(row)));
  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((rowKey) => state.paymentSelectedRowKeys.includes(rowKey));

  const viewTitle = paymentView === 'history' ? 'History' : 'Dashboard';
  const viewSubtitle =
    paymentView === 'history'
      ? 'History includes payment rows that are already processed.'
      : 'Dashboard shows payment rows waiting for review.';

  return `
    <div class="stitch-app-shell">
      <aside class="stitch-sidebar" aria-label="Navigation">
        ${renderSidebarBrand()}
        <div class="stitch-sidebar-role">Payment Team</div>
        <nav class="stitch-sidebar-nav">
          <span class="${paymentView === 'dashboard' ? 'active' : ''}" data-action="payment-nav" data-view="dashboard">Dashboard</span>
          <span class="${paymentView === 'history' ? 'active' : ''}" data-action="payment-nav" data-view="history">History</span>
          <span class="${paymentView === 'profile' ? 'active' : ''}" data-action="payment-nav" data-view="profile">Profile</span>
          <button type="button" class="stitch-sidebar-logout" data-action="logout">Logout</button>
        </nav>
      </aside>

      <main class="dashboard-container fo-dashboard-container">
        <div class="fo-console-header rh-console-header">
          <div class="fo-console-title rh-console-title">
            ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
            <h1>Payment Team Console</h1>
          </div>
          <div class="fo-console-actions rh-console-actions">
            <div class="fo-user-meta fo-user-meta-card rh-user-meta-card">
              <span>Signed in</span>
              <strong>${escapeHtml(state.user?.email || 'Payment Team')}</strong>
              <small>Payment Team</small>
            </div>
            <button type="button" class="btn btn-secondary fo-logout-inline rh-logout-inline" data-action="logout">Logout</button>
          </div>
        </div>

        ${renderPaymentMobileNav(paymentView)}

        ${state.error ? `<div class="dashboard-summary"><span class="stitch-alert danger">${escapeHtml(state.error)}</span></div>` : ''}
        ${state.notice ? `<div class="dashboard-summary"><span class="stitch-alert success">${escapeHtml(state.notice)}</span></div>` : ''}

        ${
          paymentView === 'profile'
            ? paymentProfileSection(roleScopedRequests, roleScopedRows)
            : `
          <section class="rh-welcome-card">
            <h2>${escapeHtml(viewTitle)}</h2>
            <p>${escapeHtml(viewSubtitle)}</p>
          </section>

          <section class="rh-kpi-grid vendor-kpi-grid">
            <article class="rh-kpi-card">
              <span>Total Requests</span>
              <strong>${totalRequestCount}</strong>
              <small>role-scoped database records</small>
            </article>
            <article class="rh-kpi-card">
              <span>Pending Requests</span>
              <strong>${pendingRequestCount}</strong>
              <small>at least one actionable payment row</small>
            </article>
            <article class="rh-kpi-card primary">
              <span>Processed Requests</span>
              <strong>${processedRequestCount}</strong>
              <small>no pending payment action left</small>
            </article>
          </section>

          <section class="rh-filter-card vendor-filter-card payment-filter-card">
            <input data-input="search" value="${escapeHtml(state.searchTerm)}" type="text" placeholder="Search ID, client, city, vehicle" />
            <select data-payment-filter="paymentCityFilter">
              <option value="all" ${state.paymentCityFilter === 'all' ? 'selected' : ''}>All Cities</option>
              ${cityOptions
                .map(
                  (city) =>
                    `<option value="${escapeHtml(city)}" ${state.paymentCityFilter === city ? 'selected' : ''}>${escapeHtml(
                      city
                    )}</option>`
                )
                .join('')}
            </select>
            <div class="vendor-date-row">
              <div class="vendor-date-group">
                <label>From</label>
                <input data-payment-filter="paymentDateFrom" value="${escapeHtml(state.paymentDateFrom)}" type="date" />
              </div>
              <div class="vendor-date-group">
                <label>To</label>
                <input data-payment-filter="paymentDateTo" value="${escapeHtml(state.paymentDateTo)}" type="date" />
              </div>
            </div>
            <div class="vendor-date-row payment-status-row">
              <div class="vendor-date-group">
                <label>Status</label>
                <select data-payment-filter="paymentStatusFilter" ${paymentView !== 'history' ? 'disabled' : ''}>
                  ${PAYMENT_STATUS_FILTERS.map(
                    (status) =>
                      `<option value="${status}" ${state.paymentStatusFilter === status ? 'selected' : ''}>${
                        status === 'ALL' ? 'All Status' : status
                      }</option>`
                  ).join('')}
                </select>
              </div>
              <label class="payment-extra-columns-toggle">
                <input
                  type="checkbox"
                  data-payment-filter="paymentShowAdditionalColumns"
                  ${state.paymentShowAdditionalColumns ? 'checked' : ''}
                />
                Show extra details
              </label>
              <button type="button" class="rh-secondary-btn" data-action="payment-export" ${viewRows.length === 0 ? 'disabled' : ''}>Download CSV</button>
            </div>
          </section>

          ${
            paymentView === 'dashboard'
              ? `
            <section class="rh-action-row vendor-action-row payment-action-row">
              <span class="vendor-selection-pill">${selectedRows.length} item(s) selected</span>
              <button type="button" class="rh-primary-btn" data-action="payment-approve-selected" ${
                selectedRows.length === 0 || state.paymentBusy ? 'disabled' : ''
              }>Approve Selected (${selectedRows.length})</button>
              <button type="button" class="rh-secondary-btn" data-action="payment-clear-selection" ${
                state.paymentSelectedRowKeys.length === 0 || state.paymentBusy ? 'disabled' : ''
              }>Clear Selection</button>
            </section>
          `
              : ''
          }

          <section class="rh-table-card payment-table-card">
            <div class="rh-table-wrapper ${state.paymentShowAdditionalColumns ? 'payment-horizontal-scroll' : ''}">
              <table class="rh-table payment-table ${
                state.paymentShowAdditionalColumns ? 'payment-table-expanded' : 'payment-table-compact'
              }">
                <thead>
                  <tr>
                    <th class="payment-col-select">
                      <input type="checkbox" data-action="payment-toggle-all" ${allSelected ? 'checked' : ''} ${
                        selectableKeys.length === 0 || state.paymentBusy ? 'disabled' : ''
                      } />
                    </th>
                    <th class="payment-col-request-id">Request ID</th>
                    <th class="payment-col-status">Status</th>
                    <th class="payment-col-client">Client</th>
                    <th class="payment-col-vehicle">Vehicle Number</th>
                    <th class="payment-col-service">Service Type</th>
                    <th class="payment-col-charge">Service Charge</th>
                    <th class="payment-col-date">Date</th>
                    <th class="payment-col-action">Action</th>
                    ${
                      state.paymentShowAdditionalColumns
                        ? `
                      <th class="payment-col-location">Location</th>
                      <th class="payment-col-time">Time</th>
                      <th class="payment-col-ltpoc">LTPOC</th>
                      <th class="payment-col-ltpoc-phone">LTPOC Phone</th>
                      <th class="payment-col-reason">Rejection Reason</th>
                    `
                        : ''
                    }
                  </tr>
                </thead>
                <tbody>${paymentTableRows(viewRows)}</tbody>
              </table>
            </div>

            <div class="rh-table-footer">
              <p>Showing ${viewRows.length} row(s)</p>
            </div>
          </section>
        `
        }
      </main>

      ${paymentRequestModal()}
      ${paymentRejectModal()}
    </div>
  `;
};

const resolvePaymentTargetRow = (request, vehicleIndex = null) => {
  if (!request) {
    return null;
  }

  const requestRows = buildPaymentRowsForRequest(request);
  if (Number.isInteger(vehicleIndex)) {
    return requestRows.find((row) => Number(row.vehicleIndex) === Number(vehicleIndex)) || null;
  }

  return requestRows[0] || null;
};

const applyPaymentActionToRow = async (row, action, rejectionReason = '') => {
  if (!row?.requestId) {
    throw new Error('Request not found.');
  }

  const requestRef = String(row.requestId);
  if (row.isBulkRequest) {
    if (!Number.isInteger(row.vehicleIndex)) {
      throw new Error('Vehicle row is invalid for payment action.');
    }

    await requestService.updateBulkPaymentVehicles(
      requestRef,
      [Number(row.vehicleIndex)],
      action,
      userRef(),
      rejectionReason
    );
    return;
  }

  if (action === 'APPROVE') {
    await requestService.approveRequest(requestRef, userRef(), 'PAYMENT');
    return;
  }

  await requestService.rejectRequest(requestRef, userRef(), 'PAYMENT', rejectionReason);
};

const handlePaymentApproveRow = async (root, requestId, vehicleIndex = null) => {
  const request = getPaymentRequestById(requestId);
  const row = resolvePaymentTargetRow(request, vehicleIndex);

  if (!request || !row) {
    state.error = 'Unable to resolve payment row.';
    render(root);
    return;
  }

  if (!canTakePaymentRowAction(request, row)) {
    state.error = 'This row is no longer actionable.';
    render(root);
    return;
  }

  try {
    state.paymentBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    await applyPaymentActionToRow(row, 'APPROVE');

    const rowLabel = row?.vehicleNumber
      ? `Vehicle ${row.vehicleNumber}`
      : `Request ${formatRequestIdDisplay(row.requestId)}`;
    state.notice = `${rowLabel} approved.`;
    state.paymentSelectedRowKeys = state.paymentSelectedRowKeys.filter((key) => key !== getPaymentRowKey(row));
    closePaymentRejectModal();
    closePaymentModal();
  } catch (error) {
    state.error = error?.message || 'Failed to approve payment row.';
  } finally {
    state.paymentBusy = false;
    render(root);
  }
};

const handlePaymentApproveSelected = async (root) => {
  const { viewRows } = getPaymentRows();
  const actionableSelectedRows = viewRows.filter(
    (row) =>
      state.paymentSelectedRowKeys.includes(getPaymentRowKey(row)) &&
      canTakePaymentRowAction(row.request, row)
  );

  if (actionableSelectedRows.length === 0) {
    state.error = 'Select at least one actionable payment row.';
    render(root);
    return;
  }

  try {
    state.paymentBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    const bulkRowsByRequestId = new Map();
    const singleRequestIds = new Set();

    actionableSelectedRows.forEach((row) => {
      if (row.isBulkRequest && Number.isInteger(row.vehicleIndex)) {
        const requestId = String(row.requestId || '').trim();
        if (!requestId) {
          return;
        }

        const indexes = bulkRowsByRequestId.get(requestId) || [];
        indexes.push(Number(row.vehicleIndex));
        bulkRowsByRequestId.set(requestId, indexes);
        return;
      }

      singleRequestIds.add(String(row.requestId || '').trim());
    });

    for (const [requestId, indexes] of bulkRowsByRequestId.entries()) {
      await requestService.updateBulkPaymentVehicles(requestId, indexes, 'APPROVE', userRef());
    }

    for (const requestId of singleRequestIds.values()) {
      if (!requestId) {
        continue;
      }
      await requestService.approveRequest(requestId, userRef(), 'PAYMENT');
    }

    state.paymentSelectedRowKeys = [];
    closePaymentRejectModal();
    closePaymentModal();
    state.notice = `${actionableSelectedRows.length} payment row(s) approved.`;
  } catch (error) {
    state.error = error?.message || 'Failed to approve selected payment rows.';
  } finally {
    state.paymentBusy = false;
    render(root);
  }
};

const handlePaymentRejectFromModal = async (root) => {
  const request = getPaymentRequestById(state.paymentRejectRequestId);
  const row = resolvePaymentTargetRow(request, state.paymentRejectVehicleIndex);
  const rejectionReason = String(state.paymentRejectReason || '').trim();

  if (!request || !row) {
    state.error = 'Unable to resolve payment row.';
    render(root);
    return;
  }

  if (!rejectionReason) {
    state.error = 'Rejection reason is required.';
    render(root);
    return;
  }

  if (!canTakePaymentRowAction(request, row)) {
    state.error = 'This row is no longer actionable.';
    render(root);
    return;
  }

  try {
    state.paymentBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    await applyPaymentActionToRow(row, 'REJECT', rejectionReason);

    const rowLabel = row?.vehicleNumber
      ? `Vehicle ${row.vehicleNumber}`
      : `Request ${formatRequestIdDisplay(row.requestId)}`;
    state.notice = `${rowLabel} rejected.`;
    state.paymentSelectedRowKeys = state.paymentSelectedRowKeys.filter((key) => key !== getPaymentRowKey(row));
    closePaymentRejectModal();
    closePaymentModal();
  } catch (error) {
    state.error = error?.message || 'Failed to reject payment row.';
  } finally {
    state.paymentBusy = false;
    render(root);
  }
};

const paymentRequestModal = () => {
  if (state.role !== 'PAYMENT' || !state.paymentModalRequestId) {
    return '';
  }

  const request = getPaymentRequestById(state.paymentModalRequestId);
  if (!request) {
    return '';
  }

  const requestRows = buildPaymentRowsForRequest(request);
  const focusedRow = Number.isInteger(state.paymentModalVehicleIndex)
    ? requestRows.find((row) => Number(row.vehicleIndex) === Number(state.paymentModalVehicleIndex)) || null
    : requestRows[0] || null;
  const focusedVehicleIndex = Number.isInteger(focusedRow?.vehicleIndex) ? Number(focusedRow.vehicleIndex) : null;

  const vehicleDetailsMarkup = requestRows
    .map((row) => {
      const statusMeta = getPaymentStatusMeta(request, row);
      return `
        <div class="stitch-vehicle-item ${
          Number.isInteger(focusedVehicleIndex) && Number(row.vehicleIndex) === focusedVehicleIndex
            ? 'payment-vehicle-focused'
            : ''
        }">
          <p><strong>Vehicle Number:</strong> ${escapeHtml(row.vehicleNumber || 'N/A')}</p>
          <p><strong>Service Type:</strong> ${escapeHtml(row.serviceType || 'N/A')}</p>
          <p><strong>Service Cost:</strong> ${escapeHtml(
            row.serviceCost !== null && row.serviceCost !== undefined
              ? `₹${Number(row.serviceCost).toLocaleString('en-IN')}`
              : 'N/A'
          )}</p>
          <p><strong>Location:</strong> ${escapeHtml(row.vehicleAvailabilityLocation || 'N/A')}</p>
          <p><strong>Available Time:</strong> ${escapeHtml(row.vehicleAvailableTime || 'N/A')}</p>
          <p><strong>LTPOC:</strong> ${escapeHtml(row.ltpocName || 'N/A')} (${escapeHtml(row.ltpocPhone || 'N/A')})</p>
          <p><strong>Payment State:</strong> <span class="rh-status-pill ${escapeHtml(statusMeta.className)}">${escapeHtml(
            statusMeta.label
          )}</span></p>
          ${
            row.rowPaymentRejected && row.rejectionReason
              ? `<p class="stitch-rejected-note"><strong>Rejection Reason:</strong> ${escapeHtml(row.rejectionReason)}</p>`
              : ''
          }
        </div>
      `;
    })
    .join('');

  const focusedCanAct = focusedRow ? canTakePaymentRowAction(request, focusedRow) : false;
  const focusedRequestId = String(request?.id || '');

  return `
    <div class="rh-modal-backdrop">
      <div class="rh-details-modal payment-details-modal">
        <div class="rh-details-head">
          <h2>Payment Verification Details</h2>
          <p>${escapeHtml(request?.clientName || 'N/A')} • ${escapeHtml(request?.city || 'N/A')}</p>
          <button type="button" class="rh-modal-close" data-action="payment-close-modal">×</button>
        </div>

        <div class="rh-overview-grid">
          <div>
            <span>Request ID</span>
            <strong>${escapeHtml(formatRequestIdDisplay(focusedRequestId))}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>${escapeHtml(getUnifiedStatusLabel(getStatus(request)))}</strong>
          </div>
          <div>
            <span>Vehicles</span>
            <strong>${getVehicleCount(request)} Units</strong>
          </div>
          <div>
            <span>Bulk Request</span>
            <strong>${request?.isBulkRequest ? 'Yes' : 'No'}</strong>
          </div>
        </div>

        <div class="stitch-vehicle-block">
          <h4 class="stitch-vehicle-heading">Per-Vehicle Details</h4>
          ${vehicleDetailsMarkup}
        </div>

        <div class="rh-modal-actions payment-modal-actions">
          <button type="button" class="rh-secondary-btn" data-action="payment-close-modal">Close</button>
          <button type="button" class="rh-primary-btn" data-action="payment-approve-row" data-request-id="${escapeHtml(
            focusedRequestId
          )}" data-vehicle-index="${escapeHtml(
            Number.isInteger(focusedVehicleIndex) ? String(focusedVehicleIndex) : ''
          )}" ${!focusedCanAct || state.paymentBusy ? 'disabled' : ''}>Approve</button>
          <button type="button" class="rh-danger-outline-btn" data-action="payment-open-reject" data-request-id="${escapeHtml(
            focusedRequestId
          )}" data-vehicle-index="${escapeHtml(
            Number.isInteger(focusedVehicleIndex) ? String(focusedVehicleIndex) : ''
          )}" ${!focusedCanAct || state.paymentBusy ? 'disabled' : ''}>Reject</button>
        </div>
      </div>
    </div>
  `;
};

const paymentRejectModal = () => {
  if (state.role !== 'PAYMENT' || !state.paymentRejectRequestId) {
    return '';
  }

  const request = getPaymentRequestById(state.paymentRejectRequestId);
  if (!request) {
    return '';
  }

  const requestRows = buildPaymentRowsForRequest(request);
  const focusedRow = Number.isInteger(state.paymentRejectVehicleIndex)
    ? requestRows.find((row) => Number(row.vehicleIndex) === Number(state.paymentRejectVehicleIndex)) || null
    : requestRows[0] || null;
  const label = focusedRow?.vehicleNumber
    ? `Vehicle ${focusedRow.vehicleNumber}`
    : `Request ${formatRequestIdDisplay(String(request?.id || ''))}`;

  return `
    <div class="rh-modal-backdrop">
      <div class="rh-edit-modal reject payment-reject-modal">
        <div class="rh-modal-top">
          <button type="button" class="rh-modal-icon" data-action="payment-close-reject">←</button>
          <h2>Reject Request</h2>
          <span class="rh-modal-spacer"></span>
        </div>

        <div class="rh-edit-body">
          <p class="stitch-sub-note strong">${escapeHtml(label)}</p>
          <div class="rh-edit-field">
            <div class="rh-reject-head">
              <label>Rejection Reason</label>
              <small>Required</small>
            </div>
            <textarea data-payment-reject-reason rows="4" placeholder="Please provide a detailed rejection reason">${escapeHtml(
              state.paymentRejectReason
            )}</textarea>
          </div>

          <div class="rh-reject-actions">
            <button type="button" class="rh-secondary-btn" data-action="payment-close-reject">Cancel</button>
            <button type="button" class="rh-danger-btn" data-action="payment-confirm-reject" ${
              state.paymentBusy ? 'disabled' : ''
            }>Reject</button>
          </div>
        </div>
      </div>
    </div>
  `;
};

const getVendorRequestById = (requestId) =>
  state.requests.find((item) => String(item?.id || '').trim() === String(requestId || '').trim()) || null;

const getVendorFilteredRequests = () => {
  const scoped = getVisibleRequests();

  const filtered = scoped.filter((request) => {
    const requestDate = toDateInputValue(request?.createdAt);

    if (state.vendorDateFrom && (!requestDate || requestDate < state.vendorDateFrom)) {
      return false;
    }

    if (state.vendorDateTo && (!requestDate || requestDate > state.vendorDateTo)) {
      return false;
    }

    return true;
  });

  return sortRequestsNewestFirst(filtered);
};

const canVendorNotifyRequest = (request) => {
  if (!request || isClosed(request)) {
    return false;
  }

  if (request?.vendorNotified === true || request?.foNotified === true) {
    return false;
  }

  if (buildVendorPendingRowsForRequest(request).length === 0) {
    return false;
  }

  const status = getStatus(request);
  return status === REQUEST_STATUSES.VENDOR_COORDINATION || status === REQUEST_STATUSES.COMPLETED;
};

const canFoNotifyRequest = (request) => {
  if (!request || isClosed(request)) {
    return false;
  }

  if (request?.foNotified === true) {
    return false;
  }

  if (request?.vendorNotified !== true) {
    return false;
  }

  if (!hasVendorEligibleVehicles(request)) {
    return false;
  }

  const status = getStatus(request);
  return status === REQUEST_STATUSES.VENDOR_COORDINATION || status === REQUEST_STATUSES.COMPLETED;
};

const canVendorRowAction = (request) => canVendorNotifyRequest(request) || canFoNotifyRequest(request);

const getVendorStatusMeta = (request) => {
  const status = getStatus(request);

  if (status === REQUEST_STATUSES.CANCELLED) {
    return { label: 'Cancelled', className: 'rh-status-cancelled' };
  }

  if (status === REQUEST_STATUSES.HALTED) {
    return { label: 'Halted', className: 'rh-status-rejected' };
  }

  if (request?.foNotified === true || status === REQUEST_STATUSES.COMPLETED) {
    return { label: 'Completed', className: 'rh-status-approved' };
  }

  if (canFoNotifyRequest(request)) {
    return { label: 'FO Pending', className: 'rh-status-scheduled' };
  }

  if (canVendorNotifyRequest(request)) {
    return { label: 'Vendor Pending', className: 'rh-status-pending' };
  }

  if (request?.vendorNotified === true) {
    return { label: 'Vendor Notified', className: 'rh-status-scheduled' };
  }

  if (status === REQUEST_STATUSES.VENDOR_COORDINATION) {
    return { label: 'Vendor Stage', className: 'rh-status-scheduled' };
  }

  return { label: getUnifiedStatusLabel(status), className: 'rh-status-pending' };
};

const getVendorServiceSummaryLabel = (request) => {
  const mappedVendor = resolveVendorNameForRequest(request);
  if (mappedVendor) {
    return mappedVendor;
  }
  return getServiceLabel(request) || 'N/A';
};

const getVendorHistoryEntries = (request) => {
  const history = Array.isArray(request?.history) ? request.history : [];

  return [...history].sort((left, right) => {
    const rightTime = toValidDate(right?.timestamp)?.getTime() || 0;
    const leftTime = toValidDate(left?.timestamp)?.getTime() || 0;
    return rightTime - leftTime;
  });
};

const formatHistoryTimestamp = (value) => {
  const date = toValidDate(value);
  return date ? date.toLocaleString() : 'N/A';
};

const formatHistoryActionLabel = (value) => {
  const normalized = normalizeStatusValue(value);
  if (!normalized) {
    return 'Updated';
  }

  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatHistoryStatusLabel = (value) => {
  const normalized = normalizeWorkflowStatus(value) || normalizeStatusValue(value);
  if (!normalized) {
    return 'N/A';
  }

  return getUnifiedStatusLabel(normalized);
};

const openVendorModal = (requestId) => {
  const request = getVendorRequestById(requestId);
  if (!request) {
    return;
  }

  state.vendorModalRequestId = String(request.id || '');
};

const closeVendorModal = () => {
  state.vendorModalRequestId = null;
};

const exportVendorRequestsToCsv = (rows, viewLabel = 'dashboard') => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const escapeCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const headers = [
    'Request ID',
    'Status',
    'Client',
    'City',
    'Vendor',
    'Service Type',
    'Vehicle Number',
    'Availability Location',
    'Available Time',
    'LTPOC Name',
    'LTPOC Phone',
    'Vendor Notified',
    'FO Notified',
    'Date',
  ];

  const csvRows = rows.flatMap((request) => {
    const statusMeta = getVendorStatusMeta(request);
    const requestId = String(request?.id || '').trim();
    const vendorName = getVendorServiceSummaryLabel(request);
    const createdAtMs = getRequestCreatedAtMs(request);
    const exportDate =
      createdAtMs > 0 ? new Date(createdAtMs).toLocaleString() : formatHistoryTimestamp(request?.createdAt);

    const vendorRows = buildVendorRowsForRequest(request);
    if (!Array.isArray(vendorRows) || vendorRows.length === 0) {
      return [
        [
          requestId,
          statusMeta.label,
          request?.clientName || '',
          request?.city || '',
          vendorName,
          getServiceLabel(request) || '',
          '',
          request?.vehicleAvailabilityLocation || '',
          request?.vehicleAvailableTime || '',
          '',
          '',
          request?.vendorNotified === true ? 'Yes' : 'No',
          request?.foNotified === true ? 'Yes' : 'No',
          exportDate,
        ],
      ];
    }

    return vendorRows.map((vendorRow) => [
      requestId,
      statusMeta.label,
      request?.clientName || '',
      request?.city || '',
      vendorName,
      vendorRow?.serviceType || '',
      vendorRow?.vehicleNumber || '',
      vendorRow?.vehicleAvailabilityLocation || '',
      vendorRow?.vehicleAvailableTime || '',
      vendorRow?.ltpocName || '',
      vendorRow?.ltpocPhone || '',
      request?.vendorNotified === true ? 'Yes' : 'No',
      request?.foNotified === true ? 'Yes' : 'No',
      exportDate,
    ]);
  });

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeLabel = String(viewLabel || 'dashboard').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  link.setAttribute('href', url);
  link.setAttribute('download', `vendor_${safeLabel}_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const exportPaymentRowsToCsv = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const escapeCsvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const headers = [
    'Request ID',
    'Status',
    'Client',
    'City',
    'Service Type',
    'Vehicle Number',
    'Service Charge',
    'Availability Location',
    'Available Time',
    'LTPOC Name',
    'LTPOC Phone',
    'Payment Approved',
    'Payment Rejected',
    'Rejection Reason',
    'Date',
  ];

  const csvRows = rows.map((row) => {
    const statusMeta = getPaymentStatusMeta(row.request, row);
    const createdAtMs =
      Number.isFinite(Number(row?.createdAtMs)) && Number(row?.createdAtMs) > 0
        ? Number(row.createdAtMs)
        : getRequestCreatedAtMs(row.request);
    const exportDate = createdAtMs > 0 ? new Date(createdAtMs).toLocaleString() : String(row?.createdDate || 'N/A');
    const serviceCharge =
      row?.serviceCost !== null && row?.serviceCost !== undefined
        ? `INR ${Number(row.serviceCost).toLocaleString('en-IN')}`
        : 'N/A';

    return [
      formatRequestIdDisplay(row?.requestId || ''),
      statusMeta.label,
      row?.clientName || '',
      row?.city || '',
      row?.serviceType || '',
      row?.vehicleNumber || '',
      serviceCharge,
      row?.vehicleAvailabilityLocation || '',
      row?.vehicleAvailableTime || '',
      row?.ltpocName || '',
      row?.ltpocPhone || '',
      row?.rowPaymentApproved ? 'Yes' : 'No',
      row?.rowPaymentRejected ? 'Yes' : 'No',
      row?.rejectionReason || '',
      exportDate,
    ];
  });

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `payment_dashboard_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const notifyVendorForRequest = async (requestId) => {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    throw new Error('Request not found.');
  }

  const request = state.requests.find((item) => String(item?.id || '').trim() === normalizedRequestId);
  if (!request) {
    throw new Error('Request not found.');
  }

  if (!canVendorNotifyRequest(request)) {
    throw new Error('Request is not ready for vendor notification.');
  }

  const vendorRowsWithMeta = buildVendorPendingRowsForRequest(request);
  if (vendorRowsWithMeta.length === 0) {
    throw new Error('No payment-approved vehicles are available for vendor notification.');
  }

  const groupedByVendor = new Map();
  vendorRowsWithMeta.forEach((row) => {
    const vendorName = row.vendorName;
    if (!vendorName) {
      return;
    }

    const existing = groupedByVendor.get(vendorName) || {
      requestIds: [normalizedRequestId],
      rows: [],
    };

    const { vendorName: _vendorName, ...payloadRow } = row;
    existing.rows.push(payloadRow);
    groupedByVendor.set(vendorName, existing);
  });

  if (groupedByVendor.size === 0) {
    throw new Error('Vendor mapping is missing for this request. Set service type to FleetX/WheelsEye.');
  }

  const sentVendors = new Set();
  for (const [vendorName, group] of groupedByVendor.entries()) {
    const response = await functionsService.sendVendorBulkNotification({
      vendorName,
      requestIds: group.requestIds,
      rows: group.rows,
    });

    const sentRows = Number(response?.count ?? 0);
    const sentRequestIds = Array.isArray(response?.requestIds)
      ? response.requestIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (response?.alreadySent === true || sentRows <= 0 || !sentRequestIds.includes(normalizedRequestId)) {
      continue;
    }

    sentVendors.add(vendorName);
  }

  if (sentVendors.size === 0) {
    throw new Error('No vendor-eligible rows were available to send.');
  }

  const vendorLabel = sentVendors.size === 1 ? [...sentVendors][0] : 'Mixed';

  if (request.isBulkRequest) {
    await requestService.notifyBulkVendor(normalizedRequestId, vendorLabel, userRef());
    return;
  }

  await requestService.notifyVendor(normalizedRequestId, vendorLabel, userRef());
};

const notifyFoForRequest = async (requestId) => {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    throw new Error('Request not found.');
  }

  const request = state.requests.find((item) => String(item?.id || '').trim() === normalizedRequestId);
  if (!request) {
    throw new Error('Request not found.');
  }

  if (!canFoNotifyRequest(request)) {
    throw new Error('Request is not ready for FO notification.');
  }

  const foRows = buildFoRowsForRequest(request);
  if (foRows.length === 0) {
    throw new Error('No service rows are available for FO notification.');
  }

  await functionsService.sendFoBulkNotification({
    requestIds: [normalizedRequestId],
    rows: foRows,
  });

  await requestService.markFoNotified([normalizedRequestId]);
};

const handleVendorNotifySelected = async (root) => {
  const filteredRequests = getVendorFilteredRequests().filter((request) => canVendorNotifyRequest(request));
  const selectedRequests = filteredRequests.filter((request) =>
    state.vendorSelectedRequestIds.includes(String(request?.id || '').trim())
  );

  if (selectedRequests.length === 0) {
    state.error = 'Select at least one vendor-pending request.';
    render(root);
    return;
  }

  try {
    state.vendorBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    const groupedByVendor = new Map();
    const expectedVendorsByRequestId = new Map();
    const failedIds = [];

    selectedRequests.forEach((request) => {
      const requestId = String(request?.id || '').trim();
      if (!requestId) {
        return;
      }

      const vendorRowsWithMeta = buildVendorPendingRowsForRequest(request);
      if (!Array.isArray(vendorRowsWithMeta) || vendorRowsWithMeta.length === 0) {
        failedIds.push(requestId);
        return;
      }

      const requestVendors = new Set();

      vendorRowsWithMeta.forEach((row) => {
        const vendorName = row.vendorName;
        if (!vendorName) {
          return;
        }

        requestVendors.add(vendorName);

        const existingGroup = groupedByVendor.get(vendorName) || {
          requestIds: new Set(),
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
      state.error = 'Unable to build consolidated vendor payload for selected rows.';
      state.vendorSelectedRequestIds = [...new Set(failedIds)];
      return;
    }

    const requestVendorsSent = new Map();
    const successfulRequestIds = [];
    const vendorByRequestId = new Map();
    let sentVendorGroupCount = 0;
    let totalServiceRowsEmailed = 0;

    for (const [vendorName, group] of groupedByVendor.entries()) {
      try {
        const requestIds = [...group.requestIds];
        const response = await functionsService.sendVendorBulkNotification({
          vendorName,
          requestIds,
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
          const existing = requestVendorsSent.get(requestId) || new Set();
          existing.add(vendorName);
          requestVendorsSent.set(requestId, existing);
        });
      } catch {
        // We defer request-level failure determination until all vendor groups are processed.
      }
    }

    for (const request of selectedRequests) {
      const requestId = String(request?.id || '').trim();
      if (!requestId) {
        continue;
      }

      const expectedVendors = expectedVendorsByRequestId.get(requestId) || new Set();
      if (expectedVendors.size === 0) {
        failedIds.push(requestId);
        continue;
      }

      const sentVendors = requestVendorsSent.get(requestId) || new Set();
      const fullySent = [...expectedVendors].every((vendorName) => sentVendors.has(vendorName));

      if (!fullySent) {
        failedIds.push(requestId);
        continue;
      }

      const workflowVendorName = sentVendors.size === 1 ? [...sentVendors][0] : 'Mixed';

      try {
        if (request?.isBulkRequest) {
          await requestService.notifyBulkVendor(requestId, workflowVendorName, userRef());
        } else {
          await requestService.notifyVendor(requestId, workflowVendorName, userRef());
        }

        successfulRequestIds.push(requestId);
        vendorByRequestId.set(requestId, workflowVendorName);
      } catch {
        failedIds.push(requestId);
      }
    }

    const uniqueSuccessfulIds = [...new Set(successfulRequestIds)];
    const uniqueFailedIds = [...new Set(failedIds)].filter((requestId) => !uniqueSuccessfulIds.includes(requestId));

    if (uniqueSuccessfulIds.length > 0) {
      const successSet = new Set(uniqueSuccessfulIds);
      state.requests = state.requests.map((request) => {
        const requestId = String(request?.id || '').trim();
        if (!successSet.has(requestId)) {
          return request;
        }

        return {
          ...request,
          status: REQUEST_STATUSES.COMPLETED,
          vendorNotified: true,
          vendorName: vendorByRequestId.get(requestId) || request?.vendorName || null,
          updatedAt: new Date(),
        };
      });
    }

    if (uniqueSuccessfulIds.length > 0 && uniqueFailedIds.length === 0) {
      state.notice = `Consolidated vendor notification sent for ${uniqueSuccessfulIds.length} request(s) with ${totalServiceRowsEmailed} service row(s) across ${sentVendorGroupCount} vendor group(s).`;
      state.vendorSelectedRequestIds = [];
      return;
    }

    if (uniqueSuccessfulIds.length > 0) {
      state.error = `Consolidated vendor emails were sent, but ${uniqueFailedIds.length} request(s) failed workflow update.`;
      state.notice = `Successfully processed ${uniqueSuccessfulIds.length} request(s) with ${totalServiceRowsEmailed} service row(s) across ${sentVendorGroupCount} vendor group(s).`;
      state.vendorSelectedRequestIds = uniqueFailedIds;
      return;
    }

    state.error = 'Unable to notify vendors for selected rows.';
    state.vendorSelectedRequestIds = uniqueFailedIds;
  } catch (error) {
    state.error = error?.message || 'Unable to notify vendors for selected rows.';
  } finally {
    state.vendorBusy = false;
    render(root);
  }
};

const handleFoNotifySelected = async (root) => {
  const filteredRequests = getVendorFilteredRequests().filter((request) => canFoNotifyRequest(request));
  const selectedRequests = filteredRequests.filter((request) =>
    state.vendorSelectedRequestIds.includes(String(request?.id || '').trim())
  );

  if (selectedRequests.length === 0) {
    state.error = 'Select at least one FO-pending request.';
    render(root);
    return;
  }

  try {
    state.vendorBusy = true;
    state.error = '';
    state.notice = '';
    render(root);

    const rows = selectedRequests.flatMap((request) => buildFoRowsForRequest(request));
    const requestIds = [...new Set(selectedRequests.map((request) => String(request?.id || '').trim()).filter(Boolean))];

    if (rows.length === 0 || requestIds.length === 0) {
      state.error = 'Unable to build consolidated FO payload for selected rows.';
      return;
    }

    await functionsService.sendFoBulkNotification({
      requestIds,
      rows,
    });

    const notifiedSet = new Set(requestIds);
    state.requests = state.requests.map((request) => {
      const requestId = String(request?.id || '').trim();
      if (!notifiedSet.has(requestId)) {
        return request;
      }

      return {
        ...request,
        foNotified: true,
        status: REQUEST_STATUSES.COMPLETED,
        updatedAt: new Date(),
      };
    });

    state.notice = `Consolidated FO notification sent for ${requestIds.length} request(s).`;
    state.vendorSelectedRequestIds = [];
  } catch (error) {
    state.error = error?.message || 'Unable to notify FO for selected rows.';
  } finally {
    state.vendorBusy = false;
    render(root);
  }
};

const vendorTableRows = (rows) => {
  if (rows.length === 0) {
    return `<tr><td colspan="8" class="text-muted">No requests found</td></tr>`;
  }

  return rows
    .map((request) => {
      const requestId = String(request?.id || '').trim();
      const canVendorNotify = canVendorNotifyRequest(request);
      const canFoNotify = canFoNotifyRequest(request);
      const canSelect = canVendorNotify || canFoNotify;
      const statusMeta = getVendorStatusMeta(request);
      const serviceLabel = getServiceLabel(request);
      const serviceBadgeClass = getRhServiceBadgeClass(request, serviceLabel);
      const vehicleCount = getVehicleCount(request);
      const createdAtMs = getRequestCreatedAtMs(request);
      const createdDate = createdAtMs > 0 ? toDate(createdAtMs) : toDate(request?.createdAt);
      const isSelected = state.vendorSelectedRequestIds.includes(requestId);

      return `
        <tr class="${canSelect ? 'rh-row-actionable' : ''}">
          <td class="vendor-col-select vendor-select-col" data-label="Select">
            ${
              canSelect
                ? `<input type="checkbox" data-action="vendor-toggle-row" data-request-id="${escapeHtml(requestId)}" ${
                    isSelected ? 'checked' : ''
                  } ${state.vendorBusy ? 'disabled' : ''} />`
                : ''
            }
          </td>
          <td class="vendor-col-request-id rh-request-id-cell" data-label="Request ID">
            <strong>${escapeHtml(formatRequestIdDisplay(requestId))}</strong>
            <small>${escapeHtml(request.isBulkRequest ? 'Bulk' : 'Single')}</small>
          </td>
          <td class="vendor-col-status" data-label="Status">
            <span class="rh-status-pill ${escapeHtml(statusMeta.className)}">${escapeHtml(statusMeta.label)}</span>
          </td>
          <td class="vendor-col-client" data-label="Client">
            <div class="rh-client-cell">
              <strong>${escapeHtml(request?.clientName || 'N/A')}</strong>
              <small>${escapeHtml(request?.city || 'N/A')}</small>
            </div>
          </td>
          <td class="vendor-col-service" data-label="Service Type">
            <span class="rh-service-badge ${escapeHtml(serviceBadgeClass)}">${escapeHtml(serviceLabel || 'N/A')}</span>
          </td>
          <td class="vendor-col-vehicles" data-label="Vehicles">${escapeHtml(String(vehicleCount || 0))}</td>
          <td class="vendor-col-date rh-date-cell" data-label="Date">${escapeHtml(createdDate || 'N/A')}</td>
          <td class="vendor-col-action rh-actions-cell" data-label="Action">
            <div class="vendor-action-group">
              <button class="rh-row-btn view" data-action="vendor-open-details" data-request-id="${escapeHtml(
                requestId
              )}">View</button>
              ${
                canVendorNotify
                  ? `<button class="rh-row-btn approve" data-action="notify-vendor" data-request-id="${escapeHtml(
                      requestId
                    )}" ${state.vendorBusy ? 'disabled' : ''}>Notify Vendor</button>`
                  : ''
              }
              ${
                canFoNotify
                  ? `<button class="rh-row-btn view vendor-fo-btn" data-action="notify-fo" data-request-id="${escapeHtml(
                      requestId
                    )}" ${state.vendorBusy ? 'disabled' : ''}>Notify FO</button>`
                  : ''
              }
              ${!canSelect ? '<span class="text-muted">No pending action</span>' : ''}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
};

const vendorProfileSection = (rows) => {
  const totalRequests = rows.length;
  const pendingVendor = rows.filter((request) => canVendorNotifyRequest(request)).length;
  const pendingFo = rows.filter((request) => canFoNotifyRequest(request)).length;
  const completedRequests = rows.filter((request) => request?.foNotified === true).length;
  const historyRequests = rows.filter((request) => !canVendorRowAction(request)).length;

  return `
    <section class="fo-requests-shell">
      <div class="fo-requests-head">
        <h2>Profile</h2>
      </div>

      <div class="fo-profile-card">
        <div class="fo-profile-grid">
          <div>
            <span>Email</span>
            <strong>${escapeHtml(state.user?.email || 'N/A')}</strong>
          </div>
          <div>
            <span>Division</span>
            <strong>Vendor Coordinator</strong>
          </div>
          <div>
            <span>Total Requests</span>
            <strong>${totalRequests}</strong>
          </div>
          <div>
            <span>Vendor Pending</span>
            <strong>${pendingVendor}</strong>
          </div>
          <div>
            <span>FO Pending</span>
            <strong>${pendingFo}</strong>
          </div>
          <div>
            <span>History</span>
            <strong>${historyRequests}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>${completedRequests}</strong>
          </div>
        </div>
      </div>
    </section>
  `;
};

const vendorRequestModal = () => {
  if (state.role !== 'VENDOR' || !state.vendorModalRequestId) {
    return '';
  }

  const request = getVendorRequestById(state.vendorModalRequestId);
  if (!request) {
    return '';
  }

  const requestId = String(request?.id || '').trim();
  const statusMeta = getVendorStatusMeta(request);
  const vehicles = normalizeVehicles(request);
  const ltpocRows = normalizeRecordList(request?.ltpocDetails);
  const historyEntries = getVendorHistoryEntries(request);
  const vendorName = getVendorServiceSummaryLabel(request);

  const createdAtMs = getRequestCreatedAtMs(request);
  const createdText =
    createdAtMs > 0 ? new Date(createdAtMs).toLocaleString() : formatHistoryTimestamp(request?.createdAt);
  const updatedText = formatHistoryTimestamp(request?.updatedAt || historyEntries[0]?.timestamp);

  const vehicleDetailsMarkup =
    vehicles.length > 0
      ? vehicles
          .map((vehicle, index) => {
            const vehicleNumber = String(vehicle?.vehicleNumber || '').trim() || `Vehicle ${index + 1}`;
            const ltpoc = resolveVehicleLtpoc(request, vehicle?.vehicleNumber) || ltpocRows[index] || {};
            const serviceType = request?.isBulkRequest
              ? normalizeServiceType(vehicle?.serviceType || vehicle?.vendorType || '') || 'N/A'
              : normalizeServiceType(vehicle?.serviceType || request?.serviceType || request?.vendorType) || 'N/A';
            const location = String(
              vehicle?.vehicleAvailabilityLocation || request?.vehicleAvailabilityLocation || 'N/A'
            ).trim();
            const availableTime = String(vehicle?.vehicleAvailableTime || request?.vehicleAvailableTime || 'N/A').trim();
            const ltpocName = String(ltpoc?.ltpocName || vehicle?.ltpocName || '').trim() || 'N/A';
            const ltpocPhone = String(ltpoc?.ltpocPhone || vehicle?.ltpocPhone || '').trim() || 'N/A';

            return `
              <div class="stitch-vehicle-item vendor-vehicle-item">
                <p><strong>Vehicle Number:</strong> ${escapeHtml(vehicleNumber)}</p>
                <p><strong>Service Type:</strong> ${escapeHtml(serviceType)}</p>
                <p><strong>Location:</strong> ${escapeHtml(location || 'N/A')}</p>
                <p><strong>Available Time:</strong> ${escapeHtml(availableTime || 'N/A')}</p>
                <p><strong>LTPOC:</strong> ${escapeHtml(ltpocName)} (${escapeHtml(ltpocPhone)})</p>
              </div>
            `;
          })
          .join('')
      : '<p class="text-muted vendor-empty-note">No vehicle details available for this request.</p>';

  const historyMarkup =
    historyEntries.length > 0
      ? `
        <div class="vendor-history-list">
          ${historyEntries
            .map((entry) => {
              const actionLabel = formatHistoryActionLabel(entry?.action);
              const actorName = String(entry?.userName || entry?.performedBy || entry?.userId || 'System').trim() || 'System';
              const roleKey = normalizeStatusValue(entry?.role);
              const roleLabel = ROLE_LABEL[roleKey] || String(entry?.role || 'System');
              const statusFrom = formatHistoryStatusLabel(entry?.statusFrom);
              const statusTo = formatHistoryStatusLabel(entry?.statusTo);
              const timestampLabel = formatHistoryTimestamp(entry?.timestamp);
              const notes = String(entry?.notes || '').trim();

              return `
                <article class="vendor-history-item">
                  <div class="vendor-history-top">
                    <strong class="vendor-history-action">${escapeHtml(actionLabel)}</strong>
                    <span class="vendor-history-time">${escapeHtml(timestampLabel)}</span>
                  </div>
                  <div class="vendor-history-meta">
                    <span>${escapeHtml(actorName)}</span>
                    <span>${escapeHtml(roleLabel)}</span>
                  </div>
                  <div class="vendor-history-transition">
                    <span>${escapeHtml(statusFrom)}</span>
                    <span class="vendor-history-separator">to</span>
                    <span>${escapeHtml(statusTo)}</span>
                  </div>
                  ${notes ? `<p class="vendor-history-notes">${escapeHtml(notes)}</p>` : ''}
                </article>
              `;
            })
            .join('')}
        </div>
      `
      : '<p class="text-muted vendor-empty-note">No audit log entries available.</p>';

  return `
    <div class="rh-modal-backdrop">
      <div class="rh-details-modal vendor-details-modal">
        <div class="rh-details-head">
          <h2>Vendor Request Details</h2>
          <p>${escapeHtml(request?.clientName || 'N/A')} - ${escapeHtml(request?.city || 'N/A')}</p>
          <button type="button" class="rh-modal-close" data-action="vendor-close-modal">x</button>
        </div>

        <div class="rh-overview-grid">
          <div>
            <span>Request ID</span>
            <strong>${escapeHtml(formatRequestIdDisplay(requestId))}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>${escapeHtml(statusMeta.label)}</strong>
          </div>
          <div>
            <span>Vehicle Count</span>
            <strong>${escapeHtml(String(getVehicleCount(request)))}</strong>
          </div>
          <div>
            <span>Vendor</span>
            <strong>${escapeHtml(vendorName)}</strong>
          </div>
          <div>
            <span>Created</span>
            <strong>${escapeHtml(createdText)}</strong>
          </div>
          <div>
            <span>Last Updated</span>
            <strong>${escapeHtml(updatedText)}</strong>
          </div>
        </div>

        <div class="rh-client-card">
          <h3>${escapeHtml(request?.clientName || 'Unknown Client')}</h3>
          <p>Vehicle numbers and audit history are shown below for this request.</p>
          <div class="rh-client-tags">
            <span>${escapeHtml(statusMeta.label)}</span>
            <span>${request.isBulkRequest ? 'Bulk Request' : 'Single Request'}</span>
            <span>${escapeHtml(vendorName)}</span>
          </div>
        </div>

        <div class="stitch-vehicle-block vendor-vehicle-block">
          <h4 class="stitch-vehicle-heading">Vehicle Numbers</h4>
          ${vehicleDetailsMarkup}
        </div>

        <div class="stitch-vehicle-block vendor-history-block">
          <h4 class="stitch-vehicle-heading">Audit Log</h4>
          ${historyMarkup}
        </div>

        <div class="rh-modal-actions vendor-modal-actions">
          <button type="button" class="rh-secondary-btn" data-action="vendor-close-modal">Close</button>
        </div>
      </div>
    </div>
  `;
};

const vendorDashboardShell = () => {
  const roleScopedRequests = getRoleScopedRequests('VENDOR');
  const vendorView = ['dashboard', 'history', 'profile'].includes(state.vendorView)
    ? state.vendorView
    : 'dashboard';
  const filteredRequests = getVendorFilteredRequests();

  const dashboardRowsTotal = roleScopedRequests.filter((request) => canVendorRowAction(request));
  const vendorPendingTotal = roleScopedRequests.filter((request) => canVendorNotifyRequest(request));
  const foPendingTotal = roleScopedRequests.filter((request) => canFoNotifyRequest(request));
  const completedRowsTotal = roleScopedRequests.filter(
    (request) => request?.foNotified === true || getStatus(request) === REQUEST_STATUSES.COMPLETED
  );

  const dashboardRows = filteredRequests.filter((request) => canVendorRowAction(request));
  const historyRows = filteredRequests.filter((request) => !canVendorRowAction(request));
  const viewRows = vendorView === 'history' ? historyRows : dashboardRows;

  const selectableRows = viewRows.filter((request) => canVendorRowAction(request));
  const selectableIds = selectableRows.map((request) => String(request?.id || '').trim()).filter(Boolean);
  const selectedRows = selectableRows.filter((request) =>
    state.vendorSelectedRequestIds.includes(String(request?.id || '').trim())
  );
  const selectedVendorRows = selectedRows.filter((request) => canVendorNotifyRequest(request));
  const selectedFoRows = selectedRows.filter((request) => canFoNotifyRequest(request));
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((requestId) => state.vendorSelectedRequestIds.includes(requestId));

  const viewTitle = vendorView === 'history' ? 'History' : 'Dashboard';
  const viewSubtitle =
    vendorView === 'history'
      ? 'History includes requests already notified or completed.'
      : 'Dashboard shows vendor-pending and FO-pending requests.';

  return `
    <div class="stitch-app-shell">
      <aside class="stitch-sidebar" aria-label="Navigation">
        ${renderSidebarBrand()}
        <div class="stitch-sidebar-role">Vendor Coordinator</div>
        <nav class="stitch-sidebar-nav">
          <span class="${vendorView === 'dashboard' ? 'active' : ''}" data-action="vendor-nav" data-view="dashboard">Dashboard</span>
          <span class="${vendorView === 'history' ? 'active' : ''}" data-action="vendor-nav" data-view="history">History</span>
          <span class="${vendorView === 'profile' ? 'active' : ''}" data-action="vendor-nav" data-view="profile">Profile</span>
          <button type="button" class="stitch-sidebar-logout" data-action="logout">Logout</button>
        </nav>
      </aside>

      <main class="dashboard-container fo-dashboard-container">
        <div class="fo-console-header rh-console-header">
          <div class="fo-console-title rh-console-title">
            ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
            <h1>Vendor Coordinator Console</h1>
          </div>
          <div class="fo-console-actions rh-console-actions">
            <div class="fo-user-meta fo-user-meta-card rh-user-meta-card">
              <span>Signed in</span>
              <strong>${escapeHtml(state.user?.email || 'Vendor Coordinator')}</strong>
              <small>Vendor Coordinator</small>
            </div>
            <button type="button" class="btn btn-secondary fo-logout-inline rh-logout-inline" data-action="logout">Logout</button>
          </div>
        </div>

        ${renderVendorMobileNav(vendorView)}

        ${state.error ? `<div class="dashboard-summary"><span class="stitch-alert danger">${state.error}</span></div>` : ''}
        ${state.notice ? `<div class="dashboard-summary"><span class="stitch-alert success">${state.notice}</span></div>` : ''}

        ${
          vendorView === 'profile'
            ? vendorProfileSection(roleScopedRequests)
            : `
          <section class="rh-welcome-card">
            <h2>${escapeHtml(viewTitle)}</h2>
            <p>${escapeHtml(viewSubtitle)}</p>
          </section>

          <section class="rh-kpi-grid vendor-kpi-grid">
            <article class="rh-kpi-card">
              <span>Total Pending</span>
              <strong>${dashboardRowsTotal.length}</strong>
              <small>${vendorPendingTotal.length} vendor pending • ${foPendingTotal.length} FO pending</small>
            </article>
            <article class="rh-kpi-card">
              <span>FO Pending</span>
              <strong>${foPendingTotal.length}</strong>
              <small>vendor notified, FO pending</small>
            </article>
            <article class="rh-kpi-card primary">
              <span>Completed</span>
              <strong>${completedRowsTotal.length}</strong>
              <small>FO notified</small>
            </article>
          </section>

          <section class="rh-filter-card vendor-filter-card">
            <input data-input="search" value="${state.searchTerm.replace(/"/g, '&quot;')}" type="text" placeholder="Search ID, client, or city" />
            <div class="vendor-date-row">
              <div class="vendor-date-group">
                <label>From</label>
                <input data-vendor-filter="vendorDateFrom" value="${state.vendorDateFrom}" type="date" />
              </div>
              <div class="vendor-date-group">
                <label>To</label>
                <input data-vendor-filter="vendorDateTo" value="${state.vendorDateTo}" type="date" />
              </div>
              <button type="button" class="rh-secondary-btn" data-action="vendor-clear-dates" ${
                !state.vendorDateFrom && !state.vendorDateTo ? 'disabled' : ''
              }>Clear Dates</button>
            </div>
            <div class="vendor-export-row">
              <button type="button" class="rh-secondary-btn" data-action="vendor-export-csv" ${
                viewRows.length === 0 ? 'disabled' : ''
              }>Download CSV</button>
            </div>
          </section>

          <section class="rh-action-row vendor-action-row">
            <span class="vendor-selection-pill">${selectedRows.length} item(s) selected</span>
            <button type="button" class="rh-primary-btn" data-action="vendor-notify-selected" ${
              selectedVendorRows.length === 0 || state.vendorBusy ? 'disabled' : ''
            }>Bulk Notify Vendor (${selectedVendorRows.length})</button>
            <button type="button" class="rh-secondary-btn vendor-fo-btn" data-action="vendor-notify-fo-selected" ${
              selectedFoRows.length === 0 || state.vendorBusy ? 'disabled' : ''
            }>Notify FO (${selectedFoRows.length})</button>
            <button type="button" class="rh-secondary-btn" data-action="vendor-clear-selection" ${
              state.vendorSelectedRequestIds.length === 0 || state.vendorBusy ? 'disabled' : ''
            }>Clear Selection</button>
          </section>

          <section class="rh-table-card">
            <div class="rh-table-wrapper">
              <table class="rh-table vendor-table">
                <thead>
                  <tr>
                    <th class="vendor-col-select">
                      <input type="checkbox" data-action="vendor-toggle-all" ${allSelected ? 'checked' : ''} ${
                        selectableIds.length === 0 || state.vendorBusy ? 'disabled' : ''
                      } />
                    </th>
                    <th class="vendor-col-request-id">Request ID</th>
                    <th class="vendor-col-status">Status</th>
                    <th class="vendor-col-client">Client</th>
                    <th class="vendor-col-service">Service Type</th>
                    <th class="vendor-col-vehicles">Vehicles</th>
                    <th class="vendor-col-date">Date</th>
                    <th class="vendor-col-action">Action</th>
                  </tr>
                </thead>
                <tbody>${vendorTableRows(viewRows)}</tbody>
              </table>
            </div>

            <div class="rh-table-footer">
              <p>Showing ${viewRows.length} request(s)</p>
            </div>
          </section>
        `
        }
      </main>

      ${vendorRequestModal()}
    </div>
  `;
};

const getDashboardMetrics = (visible) => {
  const actionableCount =
    state.role === 'RH'
      ? visible.filter((item) => isRhActionable(item)).length
      : state.role === 'PAYMENT'
        ? visible.filter((item) => isPaymentActionable(item)).length
        : state.role === 'VENDOR'
          ? visible.filter((item) => isVendorActionable(item)).length
          : visible.filter((item) => {
              const status = getStatus(item);
              return status === REQUEST_STATUSES.PARALLEL_REVIEW || status === REQUEST_STATUSES.VENDOR_COORDINATION;
            }).length;

  const completedCount = visible.filter((item) => getStatus(item) === REQUEST_STATUSES.COMPLETED).length;

  return {
    totalRequests: state.requests.length,
    visibleRequests: visible.length,
    actionableCount,
    completedCount,
  };
};

const appShell = () => {
  if (state.role === 'RH') {
    return rhDashboardShell();
  }

  if (state.role === 'PAYMENT') {
    return paymentDashboardShell();
  }

  if (state.role === 'VENDOR') {
    return vendorDashboardShell();
  }

  const visible = getVisibleRequests();
  const metrics = getDashboardMetrics(visible);

  if (state.role === 'FO') {
    const counts = getFoRequestCounts(state.requests);
    const foView = ['dashboard', 'history', 'profile'].includes(state.foView)
      ? state.foView
      : 'dashboard';

    const foContent =
      foView === 'history'
        ? foRequestsSection({ title: 'Requests & History', historyOnly: true })
        : foView === 'profile'
          ? foProfileSection()
          : foCreateSection();

    return `
      <div class="stitch-app-shell">
        <aside class="stitch-sidebar" aria-label="Navigation">
          ${renderSidebarBrand()}
          <div class="stitch-sidebar-role">Field Operator</div>
          <nav class="stitch-sidebar-nav">
            <span class="${foView === 'dashboard' ? 'active' : ''}" data-action="fo-nav" data-view="dashboard">Dashboard</span>
            <span class="${foView === 'history' ? 'active' : ''}" data-action="fo-nav" data-view="history">History</span>
            <span class="${foView === 'profile' ? 'active' : ''}" data-action="fo-nav" data-view="profile">Profile</span>
          </nav>
        </aside>

        <main class="dashboard-container fo-dashboard-container">
          <div class="fo-console-header">
            <div class="fo-console-title">
              ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
              <h1>Field Operations Console</h1>
            </div>
            <div class="fo-console-actions">
              <button type="button" class="fo-icon-btn fo-console-notify" title="Notifications">🔔</button>
              <div class="fo-user-meta fo-user-meta-card">
                <span>Signed in</span>
                <strong>${escapeHtml(state.user?.email || 'Field Operator')}</strong>
                <small>Field Operator</small>
              </div>
              <button type="button" class="btn btn-secondary fo-logout-inline" data-action="logout">Logout</button>
            </div>
          </div>

          ${renderFoMobileNav(foView)}

          ${renderFoCountTable(counts, 'top')}

          ${state.error ? `<div class="dashboard-summary"><span class="stitch-alert danger">${state.error}</span></div>` : ''}
          ${state.notice ? `<div class="dashboard-summary"><span class="stitch-alert success">${state.notice}</span></div>` : ''}

          ${foContent}
        </main>

        ${foCancelModal()}
      </div>
    `;
  }

  return `
    <div class="stitch-app-shell">
      <aside class="stitch-sidebar" aria-label="Navigation">
        ${renderSidebarBrand()}
        <div class="stitch-sidebar-role">${ROLE_LABEL[state.role] || state.role}</div>
        <nav class="stitch-sidebar-nav">
          <span class="active">Dashboard</span>
          <span>Requests</span>
          <span>History</span>
        </nav>
      </aside>
      <main class="dashboard-container">
        <div class="dashboard-header">
          <div class="dashboard-header-title">
            ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
            <span class="dashboard-header-icon">${ROLE_ICON[state.role] || '⚙'}</span>
            <div>
              <h1>${ROLE_LABEL[state.role] || state.role} Dashboard</h1>
              <p>${ROLE_SUBTITLE[state.role] || ''}</p>
            </div>
          </div>
          <div class="dashboard-header-actions">
            <span class="stitch-user-email">${state.user?.email || ''}</span>
            <button class="btn btn-secondary" data-action="logout">Logout</button>
          </div>
        </div>

        <div class="dashboard-kpi-grid">
          <div class="dashboard-kpi-card"><span class="dashboard-kpi-label">Total Requests</span><strong class="dashboard-kpi-value">${metrics.totalRequests}</strong></div>
          <div class="dashboard-kpi-card"><span class="dashboard-kpi-label">Pending Action</span><strong class="dashboard-kpi-value">${metrics.actionableCount}</strong></div>
          <div class="dashboard-kpi-card"><span class="dashboard-kpi-label">Completed</span><strong class="dashboard-kpi-value">${metrics.completedCount}</strong></div>
        </div>

        ${state.error ? `<div class="dashboard-summary"><span class="stitch-alert danger">${state.error}</span></div>` : ''}

        <section class="dashboard-controls">
          <div class="search-box search-box-inline">
            <input data-input="search" value="${state.searchTerm.replace(/"/g, '&quot;')}" type="text" placeholder="Search by request ID, client, or city..." />
          </div>
          ${roleActionBar()}
        </section>

        <section class="requests-section">
          <h2>Requests</h2>
          <div class="requests-table-wrapper">
            <table class="requests-table">
              <thead>
                <tr>
                  <th>Request ID</th>
                  <th>Status</th>
                  <th>Client</th>
                  <th>City</th>
                  <th>Service</th>
                  <th>Vehicles</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${tableRows()}</tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  `;
};

const ensureRole = async (user) => {
  const cachedRole = readCachedRole(user.uid);
  let fetchedRole = '';

  try {
    const token = await user.getIdToken();
    const response = await withTimeout(
      fetchWithApiFallback('/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }, import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_FUNCTIONS_BASE_URL),
      7000,
      'Timed out while fetching user role.'
    );

    if (response.ok) {
      const profile = await response.json();
      fetchedRole = normalizeRoleValue(profile?.role);
    }
  } catch {
    state.role = cachedRole || 'FO';
    return;
  }

  const role = fetchedRole || cachedRole || 'FO';

  state.role = role;
  writeCachedRole(user.uid, role);

  try {
    const token = await user.getIdToken();
    await withTimeout(
      fetchWithApiFallback('/users/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: user.email || null,
          role,
          lastLoginDate: new Date().toISOString().slice(0, 10),
        }),
      }, import.meta.env.VITE_API_BASE_URL, import.meta.env.VITE_FUNCTIONS_BASE_URL),
      5000,
      !fetchedRole ? 'Timed out while creating default role.' : 'Timed out while updating login date.'
    );
  } catch {
    // ignore profile bootstrap/update failures and continue with fallback role
  }
            const profileResponse = await fetchWithApiFallback(
              '/users/me',
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${await credential.user.getIdToken()}`
                },
                body: JSON.stringify({
                  email: state.pendingRegistration.email,
                  role: registeredRole
                })
              },
              import.meta.env.VITE_API_BASE_URL,
              import.meta.env.VITE_FUNCTIONS_BASE_URL
            );

  // Defensive fallback for corrupted role values (e.g., "null").
  if (!normalizeRoleValue(state.role)) {
    state.role = 'FO';
    writeCachedRole(user.uid, 'FO');
  }

  if (state.role === 'FO' && !state.foView) {
    state.foView = 'dashboard';
  }
  if (state.role !== 'FO') {
    state.foRequestFilter = 'all';
  }
  if (state.role !== 'RH') {
    resetRhUiState();
  }
  if (state.role === 'PAYMENT' && !state.paymentView) {
    state.paymentView = 'dashboard';
  }
  if (state.role !== 'PAYMENT') {
    resetPaymentUiState();
  }
  if (state.role === 'VENDOR' && !state.vendorView) {
    state.vendorView = 'dashboard';
  }
  if (state.role !== 'VENDOR') {
    resetVendorUiState();
  }

  subscribeRhMembers();
  subscribeRequests();
};

const render = (root) => {
  if (!root) return;

  if (!state.user) {
    root.innerHTML = authCard();
    return;
  }

  seedRequestIdSequenceFromRequests(state.requests);

  try {
    root.innerHTML = appShell();
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unexpected render error';
    console.error('Failed to render app shell:', error);
    root.innerHTML = `
      <div class="stitch-app-shell">
        <main class="dashboard-container">
          <div class="dashboard-header">
            <div class="dashboard-header-title">
              ${renderCompanyLogo({ className: 'stitch-brand-logo compact', alt: 'lets transport' })}
              <div>
                <h1>Dashboard Temporarily Unavailable</h1>
                <p>Please refresh once. If this persists, logout and sign in again.</p>
              </div>
            </div>
            <div class="dashboard-header-actions">
              <span class="stitch-user-email">${escapeHtml(state.user?.email || '')}</span>
              <button class="btn btn-secondary" data-action="logout">Logout</button>
            </div>
          </div>

          <div class="dashboard-summary">
            <span class="stitch-alert danger">${escapeHtml(details)}</span>
          </div>
        </main>
      </div>
    `;
  }
};

export const initVanillaApp = (root) => {
  mountRootEvents(root);

  let authInitialized = false;
  const authInitTimeoutId = globalThis.setTimeout(() => {
    if (!authInitialized && state.loading) {
      state.loading = false;
      state.error = 'Session initialization timed out. Please sign in manually.';
      render(root);
    }
  }, 6000);

  onAuthStateChanged(auth, async (user) => {
    authInitialized = true;
    globalThis.clearTimeout(authInitTimeoutId);

    state.loading = true;
    state.authBusy = false;
    state.error = '';

    if (!user) {
      state.user = null;
      state.role = null;
      state.requests = [];
      state.notice = '';
      resetRhUiState();
      resetPaymentUiState();
      resetVendorUiState();
      state.rhMembers = buildRhMembers();
      state.foForm = createFoFormState();
      state.foCancelRequestId = null;
      state.foCancelVehicleNumber = '';
      state.foBusy = false;
      state.authBusy = false;
      state.foView = 'dashboard';
      state.foRequestFilter = 'all';
      if (state.unsubscribeRequests) {
        state.unsubscribeRequests();
        state.unsubscribeRequests = null;
      }
      if (state.unsubscribeRhMembers) {
        state.unsubscribeRhMembers();
        state.unsubscribeRhMembers = null;
      }
      state.loading = false;
      render(root);
      return;
    }

    try {
      await initializeSignedInSession(user);
    } catch (error) {
      state.error = error?.message || 'Failed to initialize session.';
    } finally {
      state.loading = false;
      state.authBusy = false;
      render(root);
    }
  });

  render(root);
};
