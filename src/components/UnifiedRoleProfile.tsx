import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { RolePageLayout } from './RolePageLayout';
import { showToast } from './Toast';

type RoleKey = 'FO' | 'RH' | 'PAYMENT' | 'VENDOR';

type UnifiedRoleProfileProps = {
  role: RoleKey;
  pageTitle: string;
  subtitle: string;
};

type UserProfileData = {
  [key: string]: unknown;
  name?: string | null;
  employeeId?: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  email?: string | null;
};

type RoleDefaults = {
  name: string;
  roleLabel: string;
  employeeId: string;
  email: string;
  phone: string;
  region: string;
  regionalHead: string;
  regionalHeadContact: string;
  title: string;
  division: string;
  department: string;
  officeLocation: string;
  footerText: string;
  settingsHeading: string;
  notificationsDescription: string;
  tertiarySettingLabel: string;
  tertiarySettingDescription: string;
};

const ROLE_DEFAULTS: Record<RoleKey, RoleDefaults> = {
  FO: {
    name: 'Alex Thompson',
    roleLabel: 'Field Operations',
    employeeId: 'OPS-77219',
    email: 'alex.thompson@fieldops.io',
    phone: '+1 (555) 234-8890',
    region: 'North America West (NAW)',
    regionalHead: 'Marcus Vane',
    regionalHeadContact: 'm.vane@fieldops.io - Ext. 442',
    title: 'Senior Field Operator',
    division: 'Field Operations',
    department: 'Field Operations',
    officeLocation: 'West Terminal Hub',
    footerText: '(c) 2024 FIELD OPS SYSTEM',
    settingsHeading: 'SECURITY & SETTINGS',
    notificationsDescription: 'Critical alerts and weekly reports',
    tertiarySettingLabel: 'Desktop Push',
    tertiarySettingDescription: 'Real-time terminal updates',
  },
  RH: {
    name: 'Marcus Vane',
    roleLabel: 'Regional Head',
    employeeId: 'RH-77291',
    email: 'marcus.vane@gps-system.com',
    phone: '+1 (555) 118-9012',
    region: 'North America West',
    regionalHead: 'N/A',
    regionalHeadContact: 'N/A',
    title: 'Regional Head',
    division: 'Regional Leadership',
    department: 'Regional Command',
    officeLocation: 'Central Operations HQ',
    footerText: '(c) 2024 GPS INSTALLATION SYSTEM',
    settingsHeading: 'SETTINGS & SECURITY',
    notificationsDescription: 'Digest of regional activity',
    tertiarySettingLabel: 'Two-Factor Authentication',
    tertiarySettingDescription: 'Add an extra layer of security',
  },
  PAYMENT: {
    name: 'Sarah Jenkins',
    roleLabel: 'Controller',
    employeeId: 'EMP-9921-2024',
    email: 'sarah.jenkins@paycorp-global.com',
    phone: '+1 (555) 884-1104',
    region: 'N/A',
    regionalHead: 'N/A',
    regionalHeadContact: 'N/A',
    title: 'Controller',
    division: 'Payments',
    department: 'Payment Team',
    officeLocation: 'Hudson Yards, New York',
    footerText: '(c) 2024 PayCorp Global Financial Systems',
    settingsHeading: 'SETTINGS & SECURITY',
    notificationsDescription: 'Critical alerts and weekly reports',
    tertiarySettingLabel: 'Desktop Push',
    tertiarySettingDescription: 'Real-time status updates',
  },
  VENDOR: {
    name: 'Alex Johnson',
    roleLabel: 'Vendor Coordinator',
    employeeId: 'VC-99284',
    email: 'alex.johnson@logistics-core.com',
    phone: '+1 (555) 771-9034',
    region: 'N/A',
    regionalHead: 'N/A',
    regionalHeadContact: 'N/A',
    title: 'Vendor Coordinator',
    division: 'Vendor Coordinator',
    department: 'Vendor Operations',
    officeLocation: 'Logistics Core Center',
    footerText: '(c) 2024 Logistics Core System',
    settingsHeading: 'SETTINGS & SECURITY',
    notificationsDescription: 'Critical alerts and weekly reports',
    tertiarySettingLabel: 'Desktop Push',
    tertiarySettingDescription: 'Real-time status updates',
  },
};

const normalizePhone = (value: string) => String(value || '').replace(/\D/g, '').slice(0, 10);

const formatPhone = (value: string) => {
  const digits = normalizePhone(value);
  if (digits.length !== 10) {
    return String(value || '').trim() || 'N/A';
  }
  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

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

const renderProfileRows = (rows: Array<{ label: string; value: string }>) => (
  <div className="flex flex-col border-t border-primary/10">
    {rows.map((row) => (
      <div key={row.label} className="flex flex-col gap-1 py-4 border-b border-primary/5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-slate-400">{row.label}</span>
        <span className="text-sm font-normal text-slate-900">{row.value}</span>
      </div>
    ))}
  </div>
);

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

export const UnifiedRoleProfile: React.FC<UnifiedRoleProfileProps> = ({ role, pageTitle, subtitle }) => {
  const navigate = useNavigate();
  const { user, userProfile, changePassword, saveUserProfile, logout } = useAuth() as {
    user: { email?: string | null } | null;
    userProfile: UserProfileData | null;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    saveUserProfile: (updates: Record<string, unknown>) => Promise<void>;
    logout: () => Promise<void>;
  };

  const defaults = ROLE_DEFAULTS[role];

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileEmployeeId, setProfileEmployeeId] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);

  const displayName = pickProfileString(userProfile, ['name', 'fullName']);
  const displayEmployeeId = pickProfileString(userProfile, ['employeeId', 'employeeID']);
  const displayEmail = String(user?.email || '').trim() || pickProfileString(userProfile, ['email']);

  const rawPhone = pickProfileString(userProfile, ['phoneNumber', 'phone', 'mobile']);
  const displayPhone = rawPhone ? formatPhone(rawPhone) : '';

  const displayValue = (value: string) => value || 'Not provided';

  useEffect(() => {
    setProfileName(displayName || '');
    setProfileEmployeeId(displayEmployeeId || '');
    setProfilePhone(normalizePhone(rawPhone || ''));
  }, [displayName, displayEmployeeId, rawPhone]);

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
        employeeId: trimmedEmployeeId,
        phoneNumber: normalizedPhone,
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

  const personalRows: Array<{ label: string; value: string }> = [
    { label: 'Full Name', value: displayValue(displayName) },
    { label: 'Employee ID', value: displayValue(displayEmployeeId) },
    { label: 'Email Address', value: displayValue(displayEmail) },
    { label: 'Phone Number', value: displayValue(displayPhone) },
  ];

  return (
    <RolePageLayout
      role={role}
      activePage="profile"
      title={pageTitle || 'Profile'}
      subtitle={subtitle || 'Manage your account details and operational metrics.'}
      userEmail={user?.email}
      showHeaderIdentity={false}
      showTopRightLogout={role !== 'FO' && role !== 'RH' && role !== 'VENDOR'}
      onLogout={async () => {
        await logout();
        navigate('/login');
      }}
    >
      <div className="mx-auto w-full max-w-4xl">
        <section className="mb-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-primary">PERSONAL INFORMATION</h2>
            <button
              type="button"
              onClick={() => setEditingProfile((value) => !value)}
              className="rounded border border-primary px-3 py-1.5 text-[10px] font-bold uppercase tracking-tighter text-primary hover:bg-primary/5"
            >
              {editingProfile ? 'Close Edit' : 'Edit Profile'}
            </button>
          </div>
          {renderProfileRows(personalRows)}

          {editingProfile ? (
            <form onSubmit={handleProfileSave} className="mt-4 rounded-lg border border-primary/10 bg-primary/5 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-primary/20 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={() => {
                    setEditingProfile(false);
                    setProfileName(displayName || '');
                    setProfileEmployeeId(displayEmployeeId || '');
                    setProfilePhone(normalizePhone(rawPhone || ''));
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
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-primary">{defaults.settingsHeading}</h2>
          <div className="flex flex-col border-t border-primary/10">
            <div className="flex items-center justify-between py-4 border-b border-primary/5">
              <div>
                <p className="text-sm font-normal text-slate-900">Password</p>
                <p className="text-xs text-slate-400">
                  {role === 'RH' ? 'Update your security credentials' : 'Last changed 3 months ago'}
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-semibold uppercase tracking-tighter text-primary hover:underline"
                onClick={() => setShowPasswordForm((value) => !value)}
              >
                {showPasswordForm ? 'Close' : 'Update'}
              </button>
            </div>

            {showPasswordForm && (
              <form className="grid grid-cols-1 gap-3 py-4 border-b border-primary/5 sm:grid-cols-3" onSubmit={handlePasswordUpdate}>
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

                <div className="sm:col-span-3 flex justify-end gap-2 pt-1">
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
            )}

            <div className="flex items-center justify-between py-4 border-b border-primary/5">
              <div>
                <p className="text-sm font-normal text-slate-900">Email Notifications</p>
                <p className="text-xs text-slate-400">{defaults.notificationsDescription}</p>
              </div>
              <Toggle
                enabled={emailNotificationsEnabled}
                onToggle={() => setEmailNotificationsEnabled((value) => !value)}
                label="Toggle email notifications"
              />
            </div>
          </div>
        </section>

        <footer className="mt-20 flex items-center justify-between border-t border-primary/5 pt-8">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">{defaults.footerText}</p>
          <div className="flex gap-6">
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
    </RolePageLayout>
  );
};
