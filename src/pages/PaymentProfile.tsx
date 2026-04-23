import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/Loader';
import { PaymentConsoleLayout } from '../components/PaymentConsoleLayout';
import { showToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';

type UserProfileData = {
  [key: string]: unknown;
  name?: string | null;
  title?: string | null;
  employeeId?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  department?: string | null;
  officeLocation?: string | null;
  passwordUpdatedAt?: unknown;
};

type AuthShape = {
  user: { email?: string | null } | null;
  userRole: string | null;
  userProfile: UserProfileData | null;
  loading: boolean;
  profileLoading: boolean;
  logout: () => Promise<void>;
  saveUserProfile: (updates: Record<string, unknown>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const PAYMENT_FOOTER_TEXT = '© 2024 PayCorp Global Financial Systems';

const pickProfileString = (profile: UserProfileData | null, keys: string[]) => {
  for (const key of keys) {
    const raw = profile?.[key];
    if (typeof raw === 'string') {
      const normalized = raw.trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
};

const normalizePhone = (value: string) => String(value || '').replace(/\D/g, '').slice(0, 10);

const formatPhone = (value: string) => {
  const digits = normalizePhone(value);
  if (digits.length !== 10) {
    return String(value || '').trim() || 'Not provided';
  }
  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const parseTimestampMs = (value: unknown): number | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'object') {
    const record = value as { seconds?: unknown; toDate?: () => Date };
    if (typeof record.toDate === 'function') {
      return record.toDate().getTime();
    }

    if (typeof record.seconds === 'number' && Number.isFinite(record.seconds)) {
      return record.seconds * 1000;
    }
  }

  return null;
};

const formatPasswordMeta = (value: unknown) => {
  const timestampMs = parseTimestampMs(value);
  if (!timestampMs) {
    return 'Update your security credentials';
  }

  return `Last changed on ${new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(timestampMs)}`;
};

const Toggle: React.FC<{ enabled: boolean; onToggle: () => void; label: string }> = ({ enabled, onToggle, label }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={label}
    className={`relative h-4 w-8 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-slate-200'}`}
  >
    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} />
  </button>
);

const PaymentProfile: React.FC = () => {
  const navigate = useNavigate();
  const { user, userRole, userProfile, loading, profileLoading, logout, saveUserProfile, changePassword } = useAuth() as AuthShape;

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileTitle, setProfileTitle] = useState('');
  const [profileEmployeeId, setProfileEmployeeId] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileDepartment, setProfileDepartment] = useState('');
  const [profileOfficeLocation, setProfileOfficeLocation] = useState('');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [desktopPushEnabled, setDesktopPushEnabled] = useState(false);

  const isPaymentRole = String(userRole || '').trim().toUpperCase() === 'PAYMENT';

  if (loading || profileLoading || !isPaymentRole) {
    return <Loader />;
  }

  const displayNameRaw = pickProfileString(userProfile, ['name', 'fullName']);
  const displayTitleRaw = pickProfileString(userProfile, ['title', 'designation', 'roleTitle']);
  const displayEmployeeIdRaw = pickProfileString(userProfile, ['employeeId', 'employeeID']);
  const displayDepartmentRaw = pickProfileString(userProfile, ['department', 'team']);
  const displayOfficeLocationRaw = pickProfileString(userProfile, ['officeLocation', 'location', 'office']);
  const displayPhoneRaw = pickProfileString(userProfile, ['phoneNumber', 'phone', 'mobile']);

  const displayName = displayNameRaw || 'Payment User';
  const displayTitle = displayTitleRaw || 'Not provided';
  const displayEmail = String(user?.email || '').trim() || pickProfileString(userProfile, ['email']) || 'Not provided';
  const displayEmployeeId = displayEmployeeIdRaw || 'Not provided';
  const displayPhone = displayPhoneRaw ? formatPhone(displayPhoneRaw) : 'Not provided';
  const displayDepartment = displayDepartmentRaw || 'Not provided';
  const displayOfficeLocation = displayOfficeLocationRaw || 'Not provided';

  useEffect(() => {
    setProfileName(displayNameRaw || '');
    setProfileTitle(displayTitleRaw || '');
    setProfileEmployeeId(displayEmployeeIdRaw || '');
    setProfilePhone(normalizePhone(displayPhoneRaw || ''));
    setProfileDepartment(displayDepartmentRaw || '');
    setProfileOfficeLocation(displayOfficeLocationRaw || '');
  }, [displayNameRaw, displayTitleRaw, displayEmployeeIdRaw, displayPhoneRaw, displayDepartmentRaw, displayOfficeLocationRaw]);

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = profileName.trim();
    const trimmedEmployeeId = profileEmployeeId.trim();
    const normalizedPhone = normalizePhone(profilePhone);

    if (!trimmedName) {
      showToast('Full name is required.', 'error');
      return;
    }

    if (!trimmedEmployeeId) {
      showToast('Employee ID is required.', 'error');
      return;
    }

    if (!/^\d{10}$/.test(normalizedPhone)) {
      showToast('Phone number must be exactly 10 digits.', 'error');
      return;
    }

    setSavingProfile(true);
    try {
      await saveUserProfile({
        name: trimmedName,
        title: profileTitle.trim(),
        employeeId: trimmedEmployeeId,
        phoneNumber: normalizedPhone,
        department: profileDepartment.trim(),
        officeLocation: profileOfficeLocation.trim(),
      });
      setEditingProfile(false);
      showToast('Profile information updated.', 'success');
    } catch (error) {
      showToast((error as Error).message || 'Failed to update profile information.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!currentPassword) {
      showToast('Current password is required.', 'error');
      return;
    }

    if (newPassword.length < 6) {
      showToast('New password must be at least 6 characters.', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('New password and confirmation do not match.', 'error');
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      showToast('Password changed successfully.', 'success');
    } catch (error) {
      showToast((error as Error).message || 'Failed to change password.', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <PaymentConsoleLayout
      activePage="profile"
      userName={displayName}
      userTitle={displayTitle}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
      topTitle="Profile"
      showTopBar={false}
      showTopRightLogout={false}
      showSidebarIdentity={false}
      contentClassName="px-4 py-8 md:px-12 md:py-12"
    >
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-12">
          <h1 className="mb-2 text-3xl font-light tracking-tight text-primary">Profile</h1>
          <p className="text-sm font-normal text-slate-500">Manage your account details and operational metrics.</p>
        </header>

        <section className="mb-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-primary">Personal Information</h2>
            <button
              type="button"
              onClick={() => setEditingProfile((value) => !value)}
              className="rounded border border-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/5"
            >
              {editingProfile ? 'Close Edit' : 'Edit Profile'}
            </button>
          </div>
          <div className="flex flex-col border-t border-primary/10">
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Full Name</span>
              <span className="text-sm font-normal text-slate-900">{displayName}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Email Address</span>
              <span className="text-sm font-normal text-slate-900">{displayEmail}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Title</span>
              <span className="text-sm font-normal text-slate-900">{displayTitle}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Employee ID</span>
              <span className="text-sm font-normal text-slate-900">{displayEmployeeId}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Phone Number</span>
              <span className="text-sm font-normal text-slate-900">{displayPhone}</span>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Regional Assignment</h2>
          <div className="flex flex-col border-t border-primary/10">
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Department</span>
              <span className="text-sm font-normal text-slate-900">{displayDepartment}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-primary/10 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-400">Office Location</span>
              <span className="text-sm font-normal text-slate-900">{displayOfficeLocation}</span>
            </div>
          </div>

          {editingProfile ? (
            <form onSubmit={handleProfileSave} className="mt-4 rounded-lg border border-primary/10 bg-primary/5 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Full Name</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="text"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="Enter full name"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="text"
                    value={profileTitle}
                    onChange={(event) => setProfileTitle(event.target.value)}
                    placeholder="Enter title"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Employee ID</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="text"
                    value={profileEmployeeId}
                    onChange={(event) => setProfileEmployeeId(event.target.value)}
                    placeholder="Enter employee ID"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone Number</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={profilePhone}
                    onChange={(event) => setProfilePhone(normalizePhone(event.target.value))}
                    placeholder="10-digit number"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Department</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="text"
                    value={profileDepartment}
                    onChange={(event) => setProfileDepartment(event.target.value)}
                    placeholder="Enter department"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Office Location</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="text"
                    value={profileOfficeLocation}
                    onChange={(event) => setProfileOfficeLocation(event.target.value)}
                    placeholder="Enter office location"
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-primary/20 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setEditingProfile(false);
                    setProfileName(displayNameRaw || '');
                    setProfileTitle(displayTitleRaw || '');
                    setProfileEmployeeId(displayEmployeeIdRaw || '');
                    setProfilePhone(normalizePhone(displayPhoneRaw || ''));
                    setProfileDepartment(displayDepartmentRaw || '');
                    setProfileOfficeLocation(displayOfficeLocationRaw || '');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          ) : null}
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">Settings &amp; Security</h2>
          <div className="flex flex-col border-t border-primary/10">
            <div className="flex items-center justify-between gap-4 border-b border-primary/10 py-4">
              <div>
                <p className="text-sm font-normal text-slate-900">Password</p>
                <p className="text-xs text-slate-400">{formatPasswordMeta(userProfile?.passwordUpdatedAt)}</p>
              </div>
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-tighter text-primary hover:underline"
                onClick={() => setShowPasswordForm((value) => !value)}
              >
                {showPasswordForm ? 'Close' : 'Update'}
              </button>
            </div>

            {showPasswordForm ? (
              <form className="grid grid-cols-1 gap-3 border-b border-primary/10 py-4 sm:grid-cols-3" onSubmit={handlePasswordUpdate}>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Password</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    placeholder="Current"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">New Password</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Minimum 6 chars"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Confirm Password</span>
                  <input
                    className="w-full rounded border border-primary/15 bg-white px-3 py-2 text-xs focus:border-primary focus:ring-0"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Confirm"
                  />
                </label>

                <div className="flex justify-end gap-2 pt-1 sm:col-span-3">
                  <button
                    type="button"
                    className="rounded border border-primary/20 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="rounded bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                  >
                    {changingPassword ? 'Updating...' : 'Save Password'}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="flex items-center justify-between gap-4 border-b border-primary/10 py-4">
              <div>
                <p className="text-sm font-normal text-slate-900">Email Notifications</p>
                <p className="text-xs text-slate-400">Critical alerts and weekly reports</p>
              </div>
              <Toggle
                enabled={emailNotificationsEnabled}
                onToggle={() => setEmailNotificationsEnabled((value) => !value)}
                label="Toggle email notifications"
              />
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-primary/10 py-4">
              <div>
                <p className="text-sm font-normal text-slate-900">Desktop Push</p>
                <p className="text-xs text-slate-400">Real-time status updates</p>
              </div>
              <Toggle
                enabled={desktopPushEnabled}
                onToggle={() => setDesktopPushEnabled((value) => !value)}
                label="Toggle desktop push notifications"
              />
            </div>
          </div>
        </section>

        <footer className="mt-20 flex flex-col gap-4 border-t border-primary/5 pt-8 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">{PAYMENT_FOOTER_TEXT}</p>
          <div className="flex items-center justify-center gap-6 sm:justify-end">
            <a
              href="#"
              className="text-[10px] uppercase tracking-widest text-slate-400 hover:text-primary"
              onClick={(event) => event.preventDefault()}
            >
              Privacy Policy
            </a>
            <a
              href="#"
              className="text-[10px] uppercase tracking-widest text-slate-400 hover:text-primary"
              onClick={(event) => event.preventDefault()}
            >
              Support
            </a>
          </div>
        </footer>
      </div>
    </PaymentConsoleLayout>
  );
};

export default PaymentProfile;
