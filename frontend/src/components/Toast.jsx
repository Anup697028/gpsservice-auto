import React from 'react';
import '../styles/toast.css';

let toastContainerId = 'toast-container';

export const showToast = (message, type = 'success', duration = 3000) => {
  let container = document.getElementById(toastContainerId);
  if (!container) {
    container = document.createElement('div');
    container.id = toastContainerId;
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

export const Toast = ({ message, type = 'success' }) => {
  return <div className={`toast toast-${type}`}>{message}</div>;
};
