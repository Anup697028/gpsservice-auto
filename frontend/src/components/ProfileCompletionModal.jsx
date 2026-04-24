import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { showToast } from './Toast';

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

export const ProfileCompletionModal = ({ isOpen }) => {
  const { userProfile, saveUserProfile } = useAuth();
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName(String(userProfile?.name || '').trim());
    setEmployeeId(String(userProfile?.employeeId || '').trim());
    const normalizedPhone = normalizePhone(userProfile?.phoneNumber || '');
    setPhoneNumber(normalizedPhone);
    const existingPhoto = String(userProfile?.photoURL || '').trim();
    setPhotoURL(existingPhoto);
    setPreviewSrc(existingPhoto);
  }, [isOpen, userProfile]);

  if (!isOpen) {
    return null;
  }

  const handlePhotoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Profile image must be smaller than 2 MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setPhotoURL(result);
      setPreviewSrc(result);
    };
    reader.onerror = () => {
      showToast('Failed to read the selected image.', 'error');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmployeeId = employeeId.trim();
    const normalizedPhone = normalizePhone(phoneNumber);

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

    setSaving(true);
    try {
      await saveUserProfile({
        name: trimmedName,
        employeeId: trimmedEmployeeId,
        phoneNumber: normalizedPhone,
        photoURL: photoURL.trim(),
      });
      showToast('Profile details saved successfully.', 'success');
    } catch (error) {
      showToast((error && error.message) || 'Failed to save profile details.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="flex h-6 items-center justify-center border-b border-slate-100 bg-slate-50">
          <span className="h-1 w-12 rounded-full bg-slate-300" />
        </div>

        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Complete Your Profile</h2>
          <p className="mt-1 text-sm text-slate-500">
            First-time login requires profile details before you continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Full Name</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your full name"
                required
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Employee ID</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                type="text"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="Enter your employee ID"
                required
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Phone Number</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(normalizePhone(event.target.value))}
                placeholder="10-digit mobile number"
                required
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Profile Picture (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary hover:file:bg-primary/20"
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-4">
            <div className="h-16 w-16 rounded-full border border-slate-300 bg-white overflow-hidden flex items-center justify-center">
              {previewSrc ? (
                <img src={previewSrc} alt="Profile preview" className="h-full w-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-slate-400">person</span>
              )}
            </div>
            <div className="text-xs text-slate-500 space-y-1">
              <p>If no profile picture is provided, it will stay empty.</p>
              <p>Supported formats: JPG, PNG, WEBP (max 2 MB).</p>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
