import BACKEND_API_URL from '../../../config/api.js';

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const pushCandidate = (candidates, seen, value) => {
  const normalized = normalizeUrl(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  candidates.push(normalized);
};

export const buildApiBaseCandidates = (...inputs) => {
  const candidates = [];
  const seen = new Set();

  pushCandidate(candidates, seen, BACKEND_API_URL);

  for (const input of inputs) {
    pushCandidate(candidates, seen, input);
  }

  pushCandidate(candidates, seen, '/api');

  return candidates;
};

export const getApiBaseUrl = (...inputs) => buildApiBaseCandidates(...inputs)[0] || '/api';

export const fetchWithApiFallback = async (path, init = {}, ...baseInputs) => {
  const candidates = buildApiBaseCandidates(...baseInputs);
  let lastError = null;
  let lastResponse = null;

  if (candidates.length === 0) {
    throw new Error('No API base URL configured.');
  }

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);

      if (response.status >= 500 && response.status < 600) {
        lastResponse = response;
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error('Failed to reach API endpoint');
};
