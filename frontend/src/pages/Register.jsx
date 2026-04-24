import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { validateEmail, validatePassword } from '../utils/validation';
import { showToast } from '../components/Toast';
import { functionsService } from '../services/functionsService';

const ROLE_OPTIONS = [
  { value: 'FO', label: 'FO', sub: 'Fleet Ops' },
  { value: 'RH', label: 'RH', sub: 'Regional Head' },
  { value: 'PAYMENT', label: 'FIN', sub: 'Payment' },
  { value: 'VENDOR', label: 'VND', sub: 'Vendor' },
];

const PRIMARY = '#f26a21';
const PRIMARY_SOFT = 'rgba(242,106,33,0.08)';
const PRIMARY_SOFT_STRONG = 'rgba(242,106,33,0.12)';
const PRIMARY_SOFT_BORDER = 'rgba(242,106,33,0.24)';

export const Register = () => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('FO');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpToken, setOtpToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { register } = useAuth();

  const sendOtp = async () => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    setIsSendingOtp(true);
    try {
      await functionsService.sendOTP({ email, otp });
      setOtpToken(otp);
      setStep(2);
      showToast('OTP sent to your email!', 'success');
    } catch (err) {
      showToast(`Failed to send OTP: ${err.message}`, 'error');
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleStep1Submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!validateEmail(email)) {
      setError('Invalid email address');
      return;
    }
    if (!validatePassword(password)) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    await sendOtp();
  };

  const enteredOtp = otpDigits.join('');

  const handleVerify = async (event) => {
    event.preventDefault();
    setError('');
    if (enteredOtp !== otpToken) {
      setError('Invalid OTP. Please try again.');
      showToast('Invalid OTP', 'error');
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password, role);
      showToast('Account created successfully!', 'success');
      setStep(3);
    } catch (err) {
      setError(err.message || 'Registration failed');
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpInput = (index, value) => {
    if (value.length > 1) {
      return;
    }

    const next = [...otpDigits];
    next[index] = value;
    setOtpDigits(next);

    if (value && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  };

  const progressPct = step === 1 ? 33 : step === 2 ? 66 : 100;
  const stepLabel = step === 1 ? 'Step 1 of 3: Account Details' : step === 2 ? 'Step 2 of 3: Verify Email' : 'Step 3 of 3: Complete';

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f8f6f5' }}>
      <header className="bg-white border-b sticky top-0 z-50" style={{ borderColor: PRIMARY_SOFT_STRONG }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg text-white" style={{ backgroundColor: PRIMARY }}>
              <span className="material-symbols-outlined text-2xl block">location_on</span>
            </div>
            <span className="text-xl font-bold tracking-tight">
              GPS Install <span style={{ color: PRIMARY }}>Auto</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500 hidden sm:block">Already have an account?</span>
            <Link to="/login" className="text-sm font-bold transition-colors" style={{ color: PRIMARY }}>
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-2xl w-full">
          <div className="mb-8">
            <div className="flex justify-between items-end mb-2">
              <span className="font-bold text-sm tracking-wider uppercase" style={{ color: PRIMARY }}>
                {stepLabel}
              </span>
              <span className="text-slate-400 text-xs font-medium">{progressPct}% Complete</span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ backgroundColor: PRIMARY, width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            {step === 1 ? (
              <div className="p-8">
                <div className="mb-8">
                  <h1 className="text-3xl font-bold text-slate-900 mb-2">Create Account</h1>
                  <p className="text-slate-500 mb-8">Join the logistics network and manage your installations seamlessly.</p>
                </div>

                <div className="rounded-lg p-4 mb-8 flex gap-4 items-start border" style={{ backgroundColor: PRIMARY_SOFT, borderColor: PRIMARY_SOFT_BORDER }}>
                  <span className="material-symbols-outlined mt-0.5" style={{ color: PRIMARY }}>info</span>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">Role-Based Access</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Your selected role controls dashboard access, installation triggers, and payment actions. Ensure you select the correct department.
                    </p>
                  </div>
                </div>

                {error ? (
                  <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">error</span>
                    {error}
                  </div>
                ) : null}

                <form onSubmit={handleStep1Submit} className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Corporate Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="e.g. john.doe@logistics.com"
                      required
                      disabled={isSendingOtp}
                      className="w-full rounded-lg border border-slate-300 focus:outline-none p-3 text-sm transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Select Your Role</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {ROLE_OPTIONS.map((opt) => (
                        <label key={opt.value} className="cursor-pointer">
                          <input
                            type="radio"
                            name="role"
                            value={opt.value}
                            checked={role === opt.value}
                            onChange={() => setRole(opt.value)}
                            className="sr-only"
                          />
                          <div
                            className="p-3 text-center rounded-lg border transition-all"
                            style={{
                              borderColor: role === opt.value ? PRIMARY : '#e2e8f0',
                              backgroundColor: role === opt.value ? PRIMARY_SOFT : 'white',
                              color: role === opt.value ? PRIMARY : '#64748b',
                            }}
                          >
                            <span className="text-xs font-bold block">{opt.label}</span>
                            <span className="text-[10px] uppercase opacity-60">{opt.value === 'RH' ? 'Human Res' : opt.sub}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Min 6 characters"
                        required
                        disabled={isSendingOtp}
                        className="w-full rounded-lg border border-slate-300 focus:outline-none p-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Match password"
                        required
                        disabled={isSendingOtp}
                        className="w-full rounded-lg border border-slate-300 focus:outline-none p-3 text-sm"
                      />
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={isSendingOtp}
                      className="w-full text-white font-bold py-4 px-6 rounded-lg transition-all flex items-center justify-center gap-2 group"
                      style={{ backgroundColor: PRIMARY }}
                    >
                      {isSendingOtp ? (
                        <>
                          <span className="material-symbols-outlined text-xl animate-spin">sync</span>
                          Sending OTP...
                        </>
                      ) : (
                        <>
                          <span>Send OTP Verification</span>
                          <span className="material-symbols-outlined text-xl group-hover:translate-x-1 transition-transform">arrow_forward</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="p-8 border-t border-slate-100 bg-slate-50/70">
                <div className="text-center max-w-sm mx-auto">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: PRIMARY_SOFT_STRONG, color: PRIMARY }}>
                    <span className="material-symbols-outlined text-3xl">mark_email_read</span>
                  </div>
                  <h2 className="text-2xl font-bold mb-2">Verify your email</h2>
                  <p className="text-slate-500 text-sm mb-8">We've sent a 6-digit code to your email. Enter it below to continue.</p>

                  {error ? (
                    <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                      {error}
                    </div>
                  ) : null}

                  <form onSubmit={handleVerify}>
                    <div className="flex gap-3 justify-center mb-8">
                      {otpDigits.map((digit, i) => (
                        <React.Fragment key={i}>
                          {i === 3 ? <span className="flex items-center text-slate-300 text-xl">-</span> : null}
                          <input
                            id={`otp-${i}`}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(event) => handleOtpInput(i, event.target.value)}
                            onKeyDown={(event) => handleOtpKeyDown(i, event)}
                            className="w-12 h-14 text-center text-xl font-bold border-2 rounded-lg focus:outline-none transition-all"
                            style={{ borderColor: digit ? PRIMARY : '#e2e8f0' }}
                          />
                        </React.Fragment>
                      ))}
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading || enteredOtp.length < 6}
                      className="w-full text-white font-bold py-4 rounded-lg mb-4 flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                      style={{ backgroundColor: PRIMARY }}
                    >
                      {isLoading ? (
                        <>
                          <span className="material-symbols-outlined text-lg animate-spin">sync</span>
                          Verifying...
                        </>
                      ) : (
                        'Verify OTP'
                      )}
                    </button>
                  </form>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="p-12 text-center">
                <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 bg-green-100 text-green-600">
                  <span className="material-symbols-outlined text-4xl">check_circle</span>
                </div>
                <h2 className="text-3xl font-bold text-slate-900 mb-3">Registration Successful!</h2>
                <p className="text-slate-500 mb-10 max-w-md mx-auto">
                  Your partner account has been created successfully. You can now sign in and access your assigned dashboard.
                </p>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full text-white font-bold py-4 px-6 rounded-lg transition-all hover:opacity-90"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Go to Login
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-400">By registering, you agree to our Terms of Service and Privacy Policy.</p>
          </div>
        </div>
      </main>
    </div>
  );
};
