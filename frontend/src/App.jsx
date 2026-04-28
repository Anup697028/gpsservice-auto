import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Register } from './pages/Register.jsx';
import { FoDashboard } from './pages/FoDashboard.tsx';
import FoHistory from './pages/FoHistory.tsx';
import FoCancelled from './pages/FoCancelled.tsx';
import FoProfile from './pages/FoProfile.tsx';
import { RhDashboard } from './pages/RhDashboard.tsx';
import RhHistory from './pages/RhHistory.tsx';
import RhProfile from './pages/RhProfile.tsx';
import { PaymentDashboard } from './pages/PaymentDashboard.tsx';
import PaymentHistory from './pages/PaymentHistory.tsx';
import PaymentProfile from './pages/PaymentProfile.tsx';
import { VendorDashboard } from './pages/VendorDashboard.tsx';
import VendorHistory from './pages/VendorHistory.tsx';
import VendorProfile from './pages/VendorProfile.tsx';
import { ProfileCompletionModal } from './components/ProfileCompletionModal.jsx';
import { Loader } from './components/Loader';
import './App.css';

const normalizeRole = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (normalized === 'FIELD_OPERATOR') {
    return 'FO';
  }
  if (normalized === 'REGIONAL_HEAD') {
    return 'RH';
  }
  return normalized;
};

const ROLE_ROUTE_MAP = {
  FO: '/fo-dashboard',
  RH: '/rh-dashboard',
  PAYMENT: '/payment-dashboard',
  VENDOR: '/vendor-dashboard',
};

const MissingRoleState = () => {
  const { logout, refreshProfile, userRole, profileLoading } = useAuth();
  const [retrying, setRetrying] = useState(true);
  const attemptsRef = useRef(3);

  useEffect(() => {
    let mounted = true;

    const attempt = async () => {
      if (!mounted) return;
      if (profileLoading) {
        // wait for profile loading to finish; effect will re-run when `profileLoading` changes
        return;
      }

      if (userRole) {
        setRetrying(false);
        return;
      }

      if (attemptsRef.current <= 0) {
        setRetrying(false);
        return;
      }

      try {
        await refreshProfile();
      } catch (e) {
        // ignore transient errors
      }

      attemptsRef.current -= 1;

      if (attemptsRef.current > 0 && mounted) {
        setTimeout(attempt, 2000);
      } else if (mounted) {
        setRetrying(false);
      }
    };

    attempt();

    return () => {
      mounted = false;
    };
  }, [profileLoading, userRole, refreshProfile]);

  if (profileLoading || retrying) {
    return <Loader />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#f26a21]">Account setup</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Your role is not assigned yet</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your login is valid, but the app could not resolve a dashboard role for this account yet.
          Retry a few times – if the issue persists, sign out and contact an administrator.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => void refreshProfile()}
            className="rounded-lg bg-[#f26a21] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { user, userRole, loading, profileLoading } = useAuth();
  const normalizedUserRole = normalizeRole(userRole);
  const normalizedRequiredRole = normalizeRole(requiredRole);

  if (loading || profileLoading) {
    return <Loader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (normalizedRequiredRole) {
    if (!normalizedUserRole) {
      return <MissingRoleState />;
    }

    if (normalizedUserRole !== normalizedRequiredRole) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
};

const DashboardRedirect = () => {
  const { user, userRole, loading, profileLoading } = useAuth();
  const normalizedUserRole = normalizeRole(userRole);

  if (loading || profileLoading) {
    return <Loader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!normalizedUserRole) {
    return <MissingRoleState />;
  }

  const nextRoute = ROLE_ROUTE_MAP[normalizedUserRole] || '/unauthorized';
  return <Navigate to={nextRoute} replace />;
};

function AppRoutes() {
  const { user, needsProfileCompletion, profileLoading } = useAuth();
  const location = useLocation();
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/register';

  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <Register />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRedirect />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fo-dashboard"
          element={
            <ProtectedRoute requiredRole="FO">
              <FoDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/rh-dashboard"
          element={
            <ProtectedRoute requiredRole="RH">
              <RhDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payment-dashboard"
          element={
            <ProtectedRoute requiredRole="PAYMENT">
              <PaymentDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/vendor-dashboard"
          element={
            <ProtectedRoute requiredRole="VENDOR">
              <VendorDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fo-history"
          element={
            <ProtectedRoute requiredRole="FO">
              <FoHistory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fo-cancelled"
          element={
            <ProtectedRoute requiredRole="FO">
              <FoCancelled />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fo-profile"
          element={
            <ProtectedRoute requiredRole="FO">
              <FoProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/rh-history"
          element={
            <ProtectedRoute requiredRole="RH">
              <RhHistory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/rh-profile"
          element={
            <ProtectedRoute requiredRole="RH">
              <RhProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payment-history"
          element={
            <ProtectedRoute requiredRole="PAYMENT">
              <PaymentHistory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payment-profile"
          element={
            <ProtectedRoute requiredRole="PAYMENT">
              <PaymentProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/vendor-history"
          element={
            <ProtectedRoute requiredRole="VENDOR">
              <VendorHistory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/vendor-profile"
          element={
            <ProtectedRoute requiredRole="VENDOR">
              <VendorProfile />
            </ProtectedRoute>
          }
        />

        <Route path="/unauthorized" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>

      <ProfileCompletionModal isOpen={Boolean(!isAuthRoute && user && !profileLoading && needsProfileCompletion)} />
    </>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
