#!/usr/bin/env node
/**
 * Startup wrapper that loads secrets from Google Secret Manager and starts the API.
 */

import { startServer } from './server';
import { loadSecrets } from './secretManager';

async function main() {
  try {
    // 🔥 STEP 1: Load secrets BEFORE starting server
    await loadSecrets({
      secrets: [
        "FIREBASE_API_KEY",
        "FIREBASE_AUTH_DOMAIN",
        "FIREBASE_PROJECT_ID",
        "FIREBASE_STORAGE_BUCKET",
        "FIREBASE_MESSAGING_SENDER_ID",
        "FIREBASE_APP_ID",
      ],
    });

    console.log("✅ Secrets loaded successfully");

    // 🔥 STEP 2: Start server AFTER secrets are ready
    await startServer();

  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

main();