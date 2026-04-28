import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  Auth,
} from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, Functions } from 'firebase/functions';
import { resetLocalApiHealth } from './apiBase';

let app: FirebaseApp;
export let auth: Auth;
export let functions: Functions;

async function configureAuthPersistence(authInstance: Auth) {
  try {
    await setPersistence(authInstance, browserLocalPersistence);
    return;
  } catch (err) {
    console.warn('Local persistence failed:', err);
  }

  try {
    await setPersistence(authInstance, browserSessionPersistence);
    return;
  } catch (err) {
    console.warn('Session persistence failed:', err);
  }

  try {
    await setPersistence(authInstance, inMemoryPersistence);
  } catch (err) {
    console.warn('In-memory persistence failed:', err);
  }
}

export async function initFirebase() {
  try {
    // 🔥 Fetch config from backend
    const res = await fetch('http://localhost:3002/config/firebase');

    if (!res.ok) {
      throw new Error(`Backend error: ${res.status}`);
    }

    const firebaseConfig = await res.json();

    if (!firebaseConfig?.apiKey) {
      throw new Error('Invalid Firebase config received from backend');
    }

    // Initialize Firebase
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    functions = getFunctions(app);

    await configureAuthPersistence(auth);
    resetLocalApiHealth();

    // Emulators (only in dev)
    if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectFunctionsEmulator(functions, 'localhost', 5001);
      console.log('🔧 Firebase Emulators connected');
    }

    return app;
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    throw error;
  }
}

export default function getFirebaseApp(): FirebaseApp {
  if (!app) {
    throw new Error('Firebase not initialized. Call initFirebase() first.');
  }
  return app;
}