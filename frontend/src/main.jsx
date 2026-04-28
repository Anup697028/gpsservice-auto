import './index.css';
import './App.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initFirebase } from './services/firebase.ts';

async function startApp() {
  // 🔥 Initialize Firebase from backend first
  await initFirebase();

  const { default: App } = await import('./App');

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

startApp();