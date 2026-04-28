import fs from 'node:fs';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Secrets are fetched once from Google Secret Manager and cached in memory for the rest of the process.
const client = new SecretManagerServiceClient();
const secretCache = new Map<string, string>();
const pendingSecrets = new Map<string, Promise<string>>();

type SecretLoadConfig = {
  projectId?: string;
  secrets: string[];
};

function normalizeSecretName(secretName: string) {
  return String(secretName || '').trim();
}

export function resolveProjectId(explicitProjectId?: string) {
  const fromArgument = String(explicitProjectId || '').trim();
  if (fromArgument) {
    return fromArgument;
  }

  const fromEnv = String(
    process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      '',
  ).trim();
  if (fromEnv) {
    return fromEnv;
  }

  const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (credentialsPath && fs.existsSync(credentialsPath)) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as { project_id?: string };
    const fromCredentials = String(credentials.project_id || '').trim();
    if (fromCredentials) {
      return fromCredentials;
    }
  }

  throw new Error(
    'Google Cloud project id is missing. Set GOOGLE_CLOUD_PROJECT, GCP_PROJECT_ID, GCLOUD_PROJECT, or GOOGLE_APPLICATION_CREDENTIALS.',
  );
}

async function fetchSecret(projectId: string, secretName: string): Promise<string> {
  const normalizedSecretName = normalizeSecretName(secretName);
  if (!normalizedSecretName) {
    throw new Error('Secret name is required.');
  }

  if (secretCache.has(normalizedSecretName)) {
    return secretCache.get(normalizedSecretName) as string;
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
      const err = error as { code?: number; message?: string };
      if (err.code === 5) {
        throw new Error(`Secret ${normalizedSecretName} was not found in project ${projectId}.`);
      }
      if (err.code === 7) {
        throw new Error(`Permission denied while accessing secret ${normalizedSecretName}. Grant roles/secretmanager.secretAccessor to the runtime identity.`);
      }

      throw new Error(`Failed to load secret ${normalizedSecretName}: ${err.message || String(error)}`);
    } finally {
      pendingSecrets.delete(normalizedSecretName);
    }
  })();

  pendingSecrets.set(normalizedSecretName, pending);
  return pending;
}

export async function loadSecrets(config: SecretLoadConfig): Promise<Record<string, string>> {
  const projectId = resolveProjectId(config.projectId);
  const resolved: Record<string, string> = {};

  for (const secretName of config.secrets) {
    const value = await fetchSecret(projectId, secretName);
    resolved[normalizeSecretName(secretName)] = value;
  }

  return resolved;
}

export function getSecret(secretName: string): string | undefined {
  const normalizedSecretName = normalizeSecretName(secretName);
  return normalizedSecretName ? secretCache.get(normalizedSecretName) : undefined;
}

export function getRequiredSecret(secretName: string): string {
  const value = getSecret(secretName);
  if (value === undefined) {
    throw new Error(`Secret ${normalizeSecretName(secretName)} has not been loaded. Call loadSecrets() during startup.`);
  }

  return value;
}

export function getJsonSecret<T = unknown>(secretName: string): T | undefined {
  const value = getSecret(secretName);
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(value) as T;
}
