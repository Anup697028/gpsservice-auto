import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { validateEmail, validatePassword } from '../utils/validation';
import { showToast } from '../components/Toast';
import { functionsService } from '../services/functionsService';
import { logNetworkDiagnostics } from '../utils/networkTest';
import '../styles/auth.css';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('login'); // login or register
  const [role, setRole] = useState('FO');
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const navigate = useNavigate();
  const { login, register } = useAuth();

  // Run network diagnostics on mount (disabled for development)
  // useEffect(() => {
  //   logNetworkDiagnostics();
  // }, []);

  const resetOtpState = () => {
    setOtpSent(false);
    setOtpInput('');
    setOtpToken('');
    setOtpSending(false);
  };

  const sendOtp = async (targetEmail) => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    setOtpSending(true);
    try {
      await functionsService.sendOTP({ email: targetEmail, otp });
      setOtpToken(otp);
      setOtpSent(true);
      showToast('OTP sent to your email!', 'success');
    } catch (error) {
      console.error('OTP Error:', error);
      showToast(`Failed to send OTP: ${error.message}`, 'error');
    } finally {
      setOtpSending(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateEmail(email)) {
      setError('Invalid email address');
      return;
    }

    if (!validatePassword(password)) {
      setError('Password must be at least 6 characters');
      return;
    }

    // For LOGIN: Direct authentication without OTP
    if (mode === 'login') {
      setIsLoading(true);
      try {
        await login(email, password);
        showToast('Login successful!', 'success');
        
        // Wait a moment for auth state to settle
        await new Promise(resolve => setTimeout(resolve, 500));
        
        navigate('/dashboard');
      } catch (err) {
        setError(err.message || 'Authentication failed');
        showToast(err.message, 'error');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // For REGISTRATION: OTP verification required
    if (!otpSent) {
      await sendOtp(email);
      return;
    }

    if (otpInput.trim() !== otpToken) {
      setError('Invalid OTP');
      showToast('Invalid OTP', 'error');
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password, role);
      showToast('Account created successfully!', 'success');
      resetOtpState();
      
      // Wait a moment for auth state to settle
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Navigate based on role
      if (role === 'FO') {
        navigate('/fo-dashboard');
      } else if (role === 'RH') {
        navigate('/rh-dashboard');
      } else if (role === 'PAYMENT') {
        navigate('/payment-dashboard');
      } else if (role === 'VENDOR') {
        navigate('/vendor-dashboard');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>GPS Installation Automation</h1>
        <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (otpSent) {
                  resetOtpState();
                }
              }}
              placeholder="Enter your email"
              disabled={isLoading || otpSending}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLoading || otpSending}
              required
            />
          </div>

          {otpSent && mode === 'register' && (
            <div className="form-group">
              <label>OTP</label>
              <input
                type="text"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                placeholder="Enter the 6-digit code"
                disabled={isLoading}
                required
              />
            </div>
          )}

          {mode === 'register' && (
            <div className="form-group">
              <label>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isLoading}
              >
                <option value="FO">Field Operator</option>
                <option value="RH">Regional Head</option>
                <option value="PAYMENT">Payment Team</option>
                <option value="VENDOR">Vendor Coordinator</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isLoading || otpSending}
          >
            {mode === 'login'
              ? isLoading
                ? 'Please wait...'
                : 'Login'
              : otpSent
              ? isLoading
                ? 'Please wait...'
                : 'Register'
              : otpSending
              ? 'Sending OTP...'
              : 'Send OTP'}
          </button>

          {otpSent && mode === 'register' && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => sendOtp(email)}
              disabled={otpSending || isLoading}
            >
              Resend OTP
            </button>
          )}
        </form>

        <p className="auth-toggle">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
              resetOtpState();
            }}
            className="link-button"
          >
            {mode === 'login' ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
};
