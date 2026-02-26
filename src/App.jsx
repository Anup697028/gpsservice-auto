import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { FoDashboard } from './pages/FoDashboard.tsx';
import { RhDashboard } from './pages/RhDashboard.tsx';
import { PaymentDashboard } from './pages/PaymentDashboard.tsx';
import { VendorDashboard } from './pages/VendorDashboard.tsx';
import { AdminStats } from './pages/AdminStats.tsx';
import './App.css';

const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { user, userRole, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
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
        path="/admin"
        element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminStats />
          </ProtectedRoute>
        }
      />

      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

const Dashboard = () => {
  const { user, userRole, loading } = useAuth();
  const navigate = useNavigate();
  const [waitTime, setWaitTime] = React.useState(0);

  React.useEffect(() => {
    console.log('Dashboard - loading:', loading, 'user:', user?.email, 'userRole:', userRole);
  }, [loading, user, userRole]);

  // Track how long we've been waiting
  React.useEffect(() => {
    const timer = setInterval(() => {
      setWaitTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const getDashboardRoute = () => {
    switch (userRole) {
      case 'FO':
        return '/fo-dashboard';
      case 'RH':
        return '/rh-dashboard';
      case 'PAYMENT':
        return '/payment-dashboard';
      case 'VENDOR':
        return '/vendor-dashboard';
      default:
        return null;
    }
  };

  React.useEffect(() => {
    // If still loading auth, wait
    if (loading) {
      console.log('Still loading auth...');
      return;
    }

    // If no user, go to login
    if (!user) {
      console.log('No user, redirecting to login');
      navigate('/login');
      return;
    }

    // Use role if set, otherwise default to FO (requester)
    const assignedRole = userRole || 'FO';
    const route = assignedRole === 'FO' ? '/fo-dashboard' 
                : assignedRole === 'RH' ? '/rh-dashboard'
                : assignedRole === 'PAYMENT' ? '/payment-dashboard'
                : assignedRole === 'VENDOR' ? '/vendor-dashboard'
                : null;
    
    console.log('User assigned role:', assignedRole, '| Redirecting to:', route);
    if (route) {
      navigate(route);
    } else {
      console.error('Unknown role:', assignedRole);
      navigate('/login');
    }
  }, [userRole, user, loading, navigate]);

  return (
    <div style={{ textAlign: 'center', padding: '40px' }}>
      <h2>Loading your dashboard...</h2>
      <p>Please wait while we prepare your workspace.</p>
      {waitTime > 3 && (
        <p style={{ color: '#666', marginTop: '20px' }}>
          Taking longer than expected... ({waitTime}s)
        </p>
      )}
      {user && !userRole && waitTime > 2 && (
        <div style={{ marginTop: '20px', padding: '10px', background: '#fff3cd', borderRadius: '4px' }}>
          <p><strong>Debug Info:</strong></p>
          <p>User: {user.email}</p>
          <p>Role: {userRole || 'Not set'}</p>
          <p>Loading: {loading ? 'Yes' : 'No'}</p>
        </div>
      )}
    </div>
  );
};

const Unauthorized = () => (
  <div className="error-page">
    <h1>Access Denied</h1>
    <p>You do not have permission to access this page.</p>
    <a href="/login">Back to Login</a>
  </div>
);

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
