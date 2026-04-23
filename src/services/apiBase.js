const LOCALHOST_PORTS = ['3002', '3003'];
const LOCAL_API_HEALTH_CACHE_KEY = 'gps.api.local-health.v1';
const LOCAL_API_OFFLINE_TTL_MS = 10 * 60 * 1000;

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const isCloudFunctionsUrl = (value) => /cloudfunctions\.net/i.test(normalizeUrl(value));

const isBrowserLocalhost = () => {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }

  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
};

const isLocalhostLike = (value) => {
  const normalized = normalizeUrl(value).toLowerCase();
  return (
    normalized === 'http://localhost' ||
    normalized === 'https://localhost' ||
    normalized === 'http://127.0.0.1' ||
    normalized === 'https://127.0.0.1' ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)
  );
};

const pushCandidate = (candidates, seen, value) => {
  const normalized = normalizeUrl(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  candidates.push(normalized);
};

const readLocalApiHealth = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_API_HEALTH_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeLocalApiHealth = (value) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_API_HEALTH_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures and continue with network fallback.
  }
};

const isLocalApiTemporarilyDisabled = () => {
  const state = readLocalApiHealth();
  if (!state || state.status !== 'offline') {
    return false;
  }

  const lastFailureAt = Number(state.lastFailureAt || 0);
  return Number.isFinite(lastFailureAt) && Date.now() - lastFailureAt < LOCAL_API_OFFLINE_TTL_MS;
};

const markLocalApiHealthy = () => {
  writeLocalApiHealth({ status: 'online', lastSuccessAt: Date.now() });
};

const markLocalApiOffline = () => {
  writeLocalApiHealth({ status: 'offline', lastFailureAt: Date.now() });
};

const isLocalhostCandidate = (value) => isLocalhostLike(value) || value === '/api';

export const buildApiBaseCandidates = (...inputs) => {
  const candidates = [];
  const seen = new Set();
  const explicitInputs = [];
  const allowLocalhostRequests = !isLocalApiTemporarilyDisabled();

  for (const input of inputs) {
    const normalized = normalizeUrl(input);
    if (!normalized) {
      continue;
    }

    explicitInputs.push(normalized);
  }

  const runningOnLocalhost = isBrowserLocalhost();

  const sortedExplicitInputs = [...explicitInputs].sort((left, right) => {
    const leftCloud = isCloudFunctionsUrl(left);
    const rightCloud = isCloudFunctionsUrl(right);

    if (leftCloud === rightCloud) {
      return 0;
    }

    return leftCloud ? 1 : -1;
  });

  if (runningOnLocalhost) {
    // Prefer explicit backend URLs and direct localhost ports first so stale Vite
    // proxy targets do not cause global 5xx failures across auth/workflow/email.
    for (const value of sortedExplicitInputs) {
      if (isCloudFunctionsUrl(value)) {
        continue;
      }

      if (!allowLocalhostRequests && isLocalhostLike(value)) {
        continue;
      }

      pushCandidate(candidates, seen, value);
    }

    if (allowLocalhostRequests) {
      for (const port of LOCALHOST_PORTS) {
        pushCandidate(candidates, seen, `http://localhost:${port}`);
        pushCandidate(candidates, seen, `http://127.0.0.1:${port}`);
      }
    }
  } else {
    for (const value of sortedExplicitInputs) {
      pushCandidate(candidates, seen, value);
    }

    pushCandidate(candidates, seen, '/api');
  }

  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const { protocol, hostname } = window.location;
    if (allowLocalhostRequests) {
      for (const port of LOCALHOST_PORTS) {
        pushCandidate(candidates, seen, `${protocol}//${hostname}:${port}`);
      }
    }
  }

  if (allowLocalhostRequests) {
    for (const port of LOCALHOST_PORTS) {
      pushCandidate(candidates, seen, `http://localhost:${port}`);
      pushCandidate(candidates, seen, `http://127.0.0.1:${port}`);
    }
  }

  return candidates;
};

export const getApiBaseUrl = (...inputs) => buildApiBaseCandidates(...inputs)[0] || '/api';

export const fetchWithApiFallback = async (path, init = {}, ...baseInputs) => {
  const candidates = buildApiBaseCandidates(...baseInputs);
  let lastError = null;
  let lastResponse = null;

  if (candidates.length === 0) {
    throw new Error('Local API is currently offline. Start the backend or use a configured remote API base URL.');
  }

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);

      // Retry alternate candidates when the local proxy/backend is unhealthy.
      if (response.status >= 500 && response.status < 600) {
        if (isLocalhostCandidate(baseUrl)) {
          markLocalApiOffline();
        }
        lastResponse = response;
        continue;
      }

      if (isLocalhostCandidate(baseUrl)) {
        markLocalApiHealthy();
      }

      return response;
    } catch (error) {
      lastError = error;

      if (isLocalhostCandidate(baseUrl)) {
        markLocalApiOffline();
      }
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error('Failed to reach API endpoint');
};
