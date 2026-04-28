const fs = require('node:fs');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const client = new SecretManagerServiceClient();
const secretCache = new Map();
const pendingSecrets = new Map();

function normalizeSecretName(secretName) {
  return String(secretName || '').trim();
}

function resolveProjectId(explicitProjectId) {
  const fromArgument = String(explicitProjectId || '').trim();
  if (fromArgument) {
    return fromArgument;
  }

  const fromEnv = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim();
  if (fromEnv) {
    return fromEnv;
  }

  const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (credentialsPath && fs.existsSync(credentialsPath)) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const fromCredentials = String(credentials.project_id || '').trim();
    if (fromCredentials) {
      return fromCredentials;
    }
  }

  throw new Error('Google Cloud project id is missing. Set GOOGLE_CLOUD_PROJECT, GCP_PROJECT_ID, GCLOUD_PROJECT, or GOOGLE_APPLICATION_CREDENTIALS.');
}

async function fetchSecret(projectId, secretName) {
  const normalizedSecretName = normalizeSecretName(secretName);
  if (!normalizedSecretName) {
    throw new Error('Secret name is required.');
  }

  if (secretCache.has(normalizedSecretName)) {
    return secretCache.get(normalizedSecretName);
  }

  const existingPending = pendingSecrets.get(normalizedSecretName);
  if (existingPending) {
    return existingPending;
  }

  const pending = (async () => {
    try {
      const secretPath = client.secretVersionPath(projectId, normalizedSecretName, 'latest');
      const [version] = await client.accessSecretVersion({ name: secretPath });
      const payload = version.payload?.data;

      if (payload === undefined || payload === null) {
        throw new Error(`Secret ${normalizedSecretName} is empty.`);
      }

      const value = payload instanceof Uint8Array ? Buffer.from(payload).toString('utf8') : String(payload);
      secretCache.set(normalizedSecretName, value);
      return value;
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : undefined;
      const message = error instanceof Error ? error.message : String(error);

      if (code === 5) {
        throw new Error(`Secret ${normalizedSecretName} was not found in project ${projectId}.`);
      }

      if (code === 7) {
        throw new Error(`Permission denied while accessing secret ${normalizedSecretName}. Grant roles/secretmanager.secretAccessor to the runtime identity.`);
      }

      throw new Error(`Failed to load secret ${normalizedSecretName}: ${message}`);
    } finally {
      pendingSecrets.delete(normalizedSecretName);
    }
  })();

  pendingSecrets.set(normalizedSecretName, pending);
  return pending;
}

async function loadSecrets(config) {
  const projectId = resolveProjectId(config && config.projectId);
  const secrets = Array.isArray(config && config.secrets) ? config.secrets : [];
  const resolved = {};

  for (const secretName of secrets) {
    const value = await fetchSecret(projectId, secretName);
    resolved[normalizeSecretName(secretName)] = value;
  }

  return resolved;
}

function getSecret(secretName) {
  const normalizedSecretName = normalizeSecretName(secretName);
  return normalizedSecretName ? secretCache.get(normalizedSecretName) : undefined;
}

function getRequiredSecret(secretName) {
  const value = getSecret(secretName);
  if (value === undefined) {
    throw new Error(`Secret ${normalizeSecretName(secretName)} has not been loaded. Call loadSecrets() during startup.`);
  }

  return value;
}

function getJsonSecret(secretName) {
  const value = getSecret(secretName);
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(value);
}

module.exports = {
  getJsonSecret,
  getRequiredSecret,
  getSecret,
  loadSecrets,
  resolveProjectId,
};