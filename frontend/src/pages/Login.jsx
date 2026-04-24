import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { validateEmail, validatePassword } from '../utils/validation';
import { showToast } from '../components/Toast';

const getAuthErrorMessage = (error) => {
  const code = String(error?.code || '').toLowerCase();
  if (code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
    return 'Invalid credentials. Please check your email and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Check your internet and try again.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many login attempts. Please wait and try again.';
  }
  return String(error?.message || 'Login failed. Please try again.');
};

export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const normalizedEmail = email.trim();
    if (!validateEmail(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!validatePassword(password)) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    try {
      await login(normalizedEmail, password);
      showToast('Login successful!', 'success');
      navigate('/dashboard');
    } catch (err) {
      const message = getAuthErrorMessage(err);
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    /* Stitch login_page_full exact layout */
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ backgroundColor: '#f8f6f5', fontFamily: "'IBM Plex Sans', 'Inter', sans-serif" }}>

      {/* Left Panel — hidden on mobile, shown lg+ */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between p-12 overflow-hidden" style={{ backgroundColor: 'rgba(242,106,33,0.1)' }}>
        {/* Background image with dark gradient overlay — exactly like Stitch reference */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom right, rgba(242,106,33,0.8), rgba(34,22,16,0.9))', mixBlendMode: 'multiply' }} />
          <img
            alt="Logistics warehouse with organized delivery boxes"
            className="h-full w-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDx_6dpvHwV9e-tLhijG5vjP73xiCcfsDbj02LYy7zMgmK2xl3g4O2XRf4yiXCqSjJizg7J7TM4D3Sc8F6DeOx38u-k32x2XwCgMEhPC1KdKfsqz6_U5FKoSGAfHPCJ96RrRKHYCjx7CR1CE2oGbaoAtGE1UduZ-_z10pvKdkT8IqARRUF7-IK_4j8pJEykY34zxKMFLEzPMfeR1Y62ogtnFTN3YMfT9Bnh7lKtrv1OFr3IW_x98MuKjq-xLBWsonYB5aheBO88dVM"
          />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 text-white">
            <div className="size-10 bg-white rounded-lg flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-3xl" style={{ color: '#f26a21' }}>navigation</span>
            </div>
            <span className="text-xl font-bold tracking-tight">GPS Auto-Install</span>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-5xl font-extrabold text-white leading-tight mb-6">
            Automating the standard for GPS hardware deployment.
          </h1>
          <p className="text-white/80 text-lg font-medium leading-relaxed">
            Streamline fleet installations with real-time tracking, automated verification, and logistics-grade reporting tools.
          </p>
        </div>

        {/* Stats */}
        <div className="relative z-10 flex gap-8">
          <div className="flex flex-col">
            <span className="text-white font-bold text-2xl">45k+</span>
            <span className="text-white/60 text-sm">Units Installed</span>
          </div>
          <div className="flex flex-col">
            <span className="text-white font-bold text-2xl">99.9%</span>
            <span className="text-white/60 text-sm">Uptime SLA</span>
          </div>
        </div>
      </div>

      {/* Right Panel — form area */}
      <div className="flex flex-1 flex-col justify-center px-6 py-12 lg:px-20 xl:px-32" style={{ backgroundColor: '#f8f6f5' }}>
        <div className="mx-auto w-full max-w-md">

          {/* Mobile logo — shown only on small screens */}
          <div className="mb-10 lg:hidden flex items-center gap-2">
            <span className="material-symbols-outlined text-3xl" style={{ color: '#f26a21' }}>navigation</span>
            <span className="text-xl font-bold text-slate-900">GPS Auto-Install</span>
          </div>

          <div className="space-y-2 mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Welcome Back</h2>
            <p className="text-slate-600">Log in to your partner account to manage deployments.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-slate-700">Work Email Address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. user@logistics.com"
                required
                className="block w-full rounded-lg border-slate-300 bg-white py-3.5 px-4 text-slate-900 shadow-sm text-sm placeholder:text-slate-400"
                style={{ border: '1px solid #cbd5e1' }}
              />
              <p className="text-xs text-slate-500">Enter the email associated with your service station.</p>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700">Password</label>
                <button
                  type="button"
                  onClick={() => showToast('Please contact your admin to reset password.', 'info')}
                  className="text-sm font-semibold hover:opacity-80"
                  style={{ color: '#f26a21' }}
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="block w-full rounded-lg bg-white py-3.5 px-4 pr-12 text-slate-900 shadow-sm text-sm"
                  style={{ border: '1px solid #cbd5e1' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-slate-600"
                >
                  <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            {/* Error */}
            {error ? (
              <div className="rounded-lg bg-red-50 p-4 border border-red-200">
                <div className="flex">
                  <span className="material-symbols-outlined text-red-400 mr-3 flex-shrink-0">error</span>
                  <p className="text-sm font-medium text-red-800">{error}</p>
                </div>
              </div>
            ) : null}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-4 text-sm font-bold text-white shadow-lg transition-all disabled:opacity-60"
              style={{ backgroundColor: '#f26a21' }}
            >
              {isLoading ? 'Signing in...' : 'Access Dashboard'}
            </button>

            {/* Info hint */}
            <div className="rounded-lg p-4 border" style={{ backgroundColor: 'rgba(242,106,33,0.05)', borderColor: 'rgba(242,106,33,0.1)' }}>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined flex-shrink-0" style={{ color: '#f26a21' }}>info</span>
                <p className="text-xs leading-normal text-slate-600">
                  <span className="font-bold text-slate-900">Success Redirect:</span> You will be routed to your assigned dashboard based on your role.
                </p>
              </div>
            </div>
          </form>

          <p className="mt-10 text-center text-sm text-slate-500">
            Not a partner yet?{' '}
            <Link to="/register" className="font-semibold leading-6 underline underline-offset-4 hover:opacity-80" style={{ color: '#f26a21' }}>
              Request Partner Access
            </Link>
          </p>
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-10 border-t border-slate-200">
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-xs font-medium text-slate-400">
            <span>System Status</span>
            <span>Privacy Policy</span>
            <span>Service Terms</span>
            <span>Support Desk</span>
            <span>© 2025 GPS Installation Automation</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
