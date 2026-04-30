import process from 'node:process';
import admin from 'firebase-admin';
import { PrismaClient } from '@prisma/client';
import secretsManager from './secrets-manager.cjs';
import BACKEND_API_URL from '../../config/api.js';

const { loadSecrets, getJsonSecret } = secretsManager;
const apiKey = process.env.VITE_FIREBASE_API_KEY;
const apiBaseUrl = String(BACKEND_API_URL || process.env.BACKEND_API_URL || process.env.REACT_APP_BACKEND_API_URL || process.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

if (!apiKey) {
  throw new Error('VITE_FIREBASE_API_KEY missing from the environment');
}

if (!apiBaseUrl) {
  throw new Error('BACKEND_API_URL missing from the environment');
}

await loadSecrets({ secrets: ['FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_PROJECT_ID'] });
const serviceAccount = getJsonSecret('FIREBASE_SERVICE_ACCOUNT_JSON');
if (!serviceAccount) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing from Secret Manager');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: String(serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || '').trim() || undefined,
});

const prisma = new PrismaClient();

const normalizeStatusValue = (value) => String(value || '').trim().toUpperCase();

const normalizeVehicleNumberKey = (value) =>
  String(value ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const normalizeVehicles = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => (value[key] ?? {}));
  }

  return [];
};

const toBooleanFlag = (value) => {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
};

const isVehicleDropped = (vehicle) => {
  if (!vehicle || typeof vehicle !== 'object') {
    return false;
  }

  const vehicleStatus = normalizeStatusValue(vehicle.status);
  return (
    toBooleanFlag(vehicle.paymentRejected) ||
    toBooleanFlag(vehicle.isCancelled) ||
    toBooleanFlag(vehicle.cancelled) ||
    toBooleanFlag(vehicle.rhRejected) ||
    vehicleStatus === 'CANCELLED' ||
    vehicleStatus === 'HALTED' ||
    vehicleStatus === 'REJECTED'
  );
};

const getStringValue = (value) => String(value ?? '').trim();

const getRequestLtpocRows = (request) => normalizeVehicles(request.ltpocDetails || request.lptocDetails);

const getRequestLevelLtpoc = (request) => ({
  ltpocName: getStringValue(request.ltpocName || request.lptocName),
  ltpocPhone: getStringValue(request.ltpocPhone || request.lptocPhone),
});

const requestHasAnyLtpocData = (request) => {
  const requestLevel = getRequestLevelLtpoc(request);
  if (requestLevel.ltpocName || requestLevel.ltpocPhone) {
    return true;
  }

  const rows = getRequestLtpocRows(request);
  if (rows.some((row) => getStringValue(row?.ltpocName || row?.lptocName || row?.ltpocPhone || row?.lptocPhone))) {
    return true;
  }

  const vehicles = normalizeVehicles(request?.vehicles);
  return vehicles.some((vehicle) => getStringValue(vehicle?.ltpocName || vehicle?.lptocName || vehicle?.ltpocPhone || vehicle?.lptocPhone));
};

const resolveLtpocForRequestVehicle = (request, vehicle, vehicleIndex) => {
  const requestLevel = getRequestLevelLtpoc(request);
  const rows = getRequestLtpocRows(request);

  const vehicleNumber = getStringValue(vehicle?.vehicleNumber);
  const vehicleKey = normalizeVehicleNumberKey(vehicleNumber);
  const rowByVehicle = rows.find((row) => normalizeVehicleNumberKey(row?.vehicleNumber || '') === vehicleKey);
  const rowByIndex = Number.isInteger(vehicleIndex) && vehicleIndex >= 0 && vehicleIndex < rows.length ? rows[vehicleIndex] : null;
  const fallbackRow = rows.find((row) => getStringValue(row?.ltpocName || row?.lptocName || row?.ltpocPhone || row?.lptocPhone)) || null;

  const ltpocName = getStringValue(
    vehicle?.ltpocName ||
      vehicle?.lptocName ||
      rowByVehicle?.ltpocName ||
      rowByVehicle?.lptocName ||
      rowByIndex?.ltpocName ||
      rowByIndex?.lptocName ||
      fallbackRow?.ltpocName ||
      fallbackRow?.lptocName ||
      requestLevel.ltpocName
  );

  const ltpocPhone = getStringValue(
    vehicle?.ltpocPhone ||
      vehicle?.lptocPhone ||
      rowByVehicle?.ltpocPhone ||
      rowByVehicle?.lptocPhone ||
      rowByIndex?.ltpocPhone ||
      rowByIndex?.lptocPhone ||
      fallbackRow?.ltpocPhone ||
      fallbackRow?.lptocPhone ||
      requestLevel.ltpocPhone
  );

  return { ltpocName, ltpocPhone };
};

const addAuditRow = (acc, context, request, vehicle, vehicleIndex) => {
  const requestId = String(request.id || request.requestId || '').trim() || 'UNKNOWN';
  const resolved = resolveLtpocForRequestVehicle(request, vehicle || null, vehicleIndex);
  const hasAnySource = requestHasAnyLtpocData(request);
  const hasResolved = Boolean(resolved.ltpocName || resolved.ltpocPhone);

  const bucket = acc[context];
  bucket.rows += 1;
  if (hasAnySource) {
    bucket.rowsWithAnyLtpocSource += 1;
  }
  if (hasResolved) {
    bucket.rowsResolved += 1;
    bucket.requestIdsResolved.add(requestId);
  }
  if (hasAnySource && !hasResolved) {
    bucket.rowsMissing += 1;
    bucket.requestIdsMissing.add(requestId);
  }
};

const initContext = () => ({
  rows: 0,
  rowsWithAnyLtpocSource: 0,
  rowsResolved: 0,
  rowsMissing: 0,
  requestIdsResolved: new Set(),
  requestIdsMissing: new Set(),
});

const contexts = {
  FoHistoryCsv: initContext(),
  FoCancelledRows: initContext(),
  VendorHistoryCsv: initContext(),
  VendorDashboardCsvPath: initContext(),
  PaymentCsvPath: initContext(),
};

const parseRemovedVehicleNumber = (notes) => {
  const text = String(notes || '').trim();
  if (!text) return '';
  const match = text.match(/removed vehicle\s+(.+?)\s+from\s+bulk/i);
  return match?.[1]?.trim() || '';
};

const run = async () => {
  const existingUser = await prisma.user.findFirst({ select: { id: true } });
  if (!existingUser?.id) {
    throw new Error('No user found in prisma.user; cannot satisfy domain middleware fallback');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const customToken = await admin.auth().createCustomToken(existingUser.id);

  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  if (!signInResponse.ok) {
    const details = await signInResponse.text();
    throw new Error(`Firebase custom token sign-in failed (${signInResponse.status}): ${details}`);
  }

  const signInPayload = await signInResponse.json();
  const idToken = String(signInPayload.idToken || '').trim();
  if (!idToken) {
    throw new Error('No idToken returned from custom token exchange');
  }

  const requestsResponse = await fetch(`${apiBaseUrl}/requests?limit=10000`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!requestsResponse.ok) {
    const details = await requestsResponse.text();
    throw new Error(`GET /requests failed (${requestsResponse.status}): ${details}`);
  }

  const requestsPayload = await requestsResponse.json();
  const requests = Array.isArray(requestsPayload.requests) ? requestsPayload.requests : [];

  for (const request of requests) {
    const vehicles = normalizeVehicles(request.vehicles);

    // FO History CSV path
    for (let i = 0; i < vehicles.length; i += 1) {
      addAuditRow(contexts, 'FoHistoryCsv', request, vehicles[i], i);
    }

    // Vendor History CSV path
    for (let i = 0; i < vehicles.length; i += 1) {
      addAuditRow(contexts, 'VendorHistoryCsv', request, vehicles[i], i);
    }

    // Vendor Dashboard CSV path (non-dropped rows only)
    const nonDroppedVehicles = vehicles.filter((v) => !isVehicleDropped(v));
    for (let i = 0; i < nonDroppedVehicles.length; i += 1) {
      addAuditRow(contexts, 'VendorDashboardCsvPath', request, nonDroppedVehicles[i], i);
    }

    // Payment CSV path (bulk non-dropped; single request primary)
    if (toBooleanFlag(request.isBulkRequest) && vehicles.length > 0) {
      const bulkActiveVehicles = vehicles.filter((v) => !isVehicleDropped(v));
      for (let i = 0; i < bulkActiveVehicles.length; i += 1) {
        addAuditRow(contexts, 'PaymentCsvPath', request, bulkActiveVehicles[i], i);
      }
    } else {
      const primaryVehicle = vehicles[0] || {};
      addAuditRow(contexts, 'PaymentCsvPath', request, primaryVehicle, 0);
    }

    // FO Cancelled rows path (request-level cancelled + dropped/removed vehicles)
    const statusText = String(request.status || request.currentStatus || request.workflowStatus || '').toLowerCase();
    const requestCancelled = statusText.includes('cancel') || statusText.includes('reject') || statusText.includes('halt');
    if (requestCancelled) {
      addAuditRow(contexts, 'FoCancelledRows', request, vehicles[0] || null, 0);
    }

    for (let i = 0; i < vehicles.length; i += 1) {
      if (isVehicleDropped(vehicles[i])) {
        addAuditRow(contexts, 'FoCancelledRows', request, vehicles[i], i);
      }
    }

    const history = Array.isArray(request.history) ? request.history : [];
    for (const historyEntry of history) {
      const action = normalizeStatusValue(historyEntry?.action);
      if (action !== 'FO_REMOVE_VEHICLE') {
        continue;
      }

      const removedVehicleNumber = parseRemovedVehicleNumber(historyEntry?.notes);
      if (!removedVehicleNumber) {
        continue;
      }

      const removedVehicle = vehicles.find(
        (vehicle) => normalizeVehicleNumberKey(vehicle?.vehicleNumber || '') === normalizeVehicleNumberKey(removedVehicleNumber)
      );

      const removedVehicleIndex = removedVehicle ? vehicles.indexOf(removedVehicle) : undefined;
      addAuditRow(
        contexts,
        'FoCancelledRows',
        request,
        removedVehicle || { vehicleNumber: removedVehicleNumber },
        removedVehicleIndex
      );
    }
  }

  const summarize = (name, data) => ({
    context: name,
    rows: data.rows,
    rowsWithAnyLtpocSource: data.rowsWithAnyLtpocSource,
    rowsResolved: data.rowsResolved,
    rowsMissing: data.rowsMissing,
    requestIdsResolved: Array.from(data.requestIdsResolved).slice(0, 30),
    requestIdsMissing: Array.from(data.requestIdsMissing).slice(0, 30),
  });

  const summary = {
    auditedAt: new Date().toISOString(),
    apiBaseUrl,
    totalRequests: requests.length,
    matrix: Object.entries(contexts).map(([name, data]) => summarize(name, data)),
  };

  const outputPath = path.join(repoRoot, 'artifacts', 'ltpoc-csv-smoke-latest.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSaved: ${outputPath}`);
};

run()
  .catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
