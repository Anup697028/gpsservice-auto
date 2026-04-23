import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const requiredEnv = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missingFirebaseEnv = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingFirebaseEnv.length > 0) {
  throw new Error(`Missing Firebase environment variables: ${missingFirebaseEnv.join(', ')}`);
}

const firebaseConfig = {
  apiKey: requiredEnv.VITE_FIREBASE_API_KEY as string,
  authDomain: requiredEnv.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: requiredEnv.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: requiredEnv.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: requiredEnv.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: requiredEnv.VITE_FIREBASE_APP_ID as string,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);

const configureAuthPersistence = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    return;
  } catch {
    // Continue to session fallback.
  }

  try {
    await setPersistence(auth, browserSessionPersistence);
    return;
  } catch {
    // Continue to in-memory fallback.
  }

  try {
    await setPersistence(auth, inMemoryPersistence);
  } catch {
    // Ignore persistence setup failures; auth can still work for current page lifecycle.
  }
};

void configureAuthPersistence();

// Connect to emulators in development
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFunctionsEmulator(functions, 'localhost', 5001);
  console.log('🔧 Connected to Firebase Emulators (Auth + Functions)');
}

export default app;
