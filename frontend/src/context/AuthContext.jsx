import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import { buildApiBaseCandidates, fetchWithApiFallback } from '../services/apiBase';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
} from 'firebase/auth';

const AuthContext = createContext();

const API_BASE_URL = buildApiBaseCandidates(
  import.meta.env.VITE_API_BASE_URL,
  import.meta.env.VITE_FUNCTIONS_BASE_URL,
)[0] || '/api';
const PROFILE_CACHE_PREFIX = 'gps.auth.profile.v1:';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [error, setError] = useState(null);
  const companyEmailDomain = String(import.meta.env.VITE_COMPANY_EMAIL_DOMAIN || 'letstransport.team').toLowerCase();

  const getTodayKey = () => new Date().toISOString().slice(0, 10);
  const normalizePhoneNumber = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);
  const trimOrNull = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
  };

  const getProfileCacheKey = (uid) => `${PROFILE_CACHE_PREFIX}${String(uid || '').trim()}`;

  const readCachedProfile = (uid) => {
    if (typeof window === 'undefined' || !uid) {
      return null;
    }

    try {
      const cached = window.localStorage.getItem(getProfileCacheKey(uid));
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  };

  const writeCachedProfile = (uid, profileData) => {
    if (typeof window === 'undefined' || !uid || !profileData) {
      return;
    }

    try {
      window.localStorage.setItem(getProfileCacheKey(uid), JSON.stringify(profileData));
    } catch {
      // Ignore storage quota/privacy errors.
    }
  };

  const clearCachedProfile = (uid) => {
    if (typeof window === 'undefined' || !uid) {
      return;
    }

    try {
      window.localStorage.removeItem(getProfileCacheKey(uid));
    } catch {
      // Ignore storage errors during logout.
    }
  };

  const buildFallbackProfile = (currentUser) => {
    const cachedProfile = readCachedProfile(currentUser?.uid);
    if (cachedProfile) {
      return cachedProfile;
    }

    return {
      id: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      name: currentUser?.displayName ?? null,
      employeeId: null,
      phoneNumber: null,
      role: null,
      profileCompleted: false,
    };
  };

  const shouldUseCachedProfileOnly = (currentUser) => {
    if (!currentUser || typeof window === 'undefined') {
      return false;
    }

    const cachedProfile = readCachedProfile(currentUser.uid);
    if (!cachedProfile) {
      return false;
    }

    const configuredBase = String(import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_FUNCTIONS_BASE_URL || '').trim();
    if (!configuredBase) {
      return true;
    }

    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBase);
  };

  const isCompanyEmail = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.endsWith(`@${companyEmailDomain}`);
  };

  const isProfileComplete = (profileData) => {
    const name = String(profileData?.name || '').trim();
    const employeeId = String(profileData?.employeeId || '').trim();
    const phone = normalizePhoneNumber(profileData?.phoneNumber || '');
    return Boolean(name && employeeId && /^\d{10}$/.test(phone));
  };

  const resolveProfileCompleted = (profileData) => {
    if (!profileData) {
      return false;
    }

    if (profileData.profileCompleted === true) {
      return true;
    }

    return isProfileComplete(profileData);
  };

  const mergeProfilePayload = (payload, fallbackProfile = null) => {
    const mergedProfile = {
      ...(payload || {}),
    };

    if (fallbackProfile && resolveProfileCompleted(fallbackProfile) && !resolveProfileCompleted(mergedProfile)) {
      ['name', 'employeeId', 'phoneNumber', 'role', 'email', 'photoURL'].forEach((key) => {
        if (mergedProfile[key] === undefined || mergedProfile[key] === null || mergedProfile[key] === '') {
          mergedProfile[key] = fallbackProfile[key] ?? mergedProfile[key];
        }
      });
    }

    mergedProfile.profileCompleted = resolveProfileCompleted(mergedProfile);
    return mergedProfile;
  };

  const getAuthHeaders = async (currentUser = auth.currentUser) => {
    const idToken = currentUser ? await currentUser.getIdToken(true) : '';
    return {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    };
  };

  const requestWithApiFallback = async (path, init = {}) => {
    return fetchWithApiFallback(path, init, API_BASE_URL);
  };

  const fetchCurrentUserProfile = async (currentUser = auth.currentUser) => {
    if (!currentUser) {
      return null;
    }

    const cachedProfile = readCachedProfile(currentUser.uid);

    if (shouldUseCachedProfileOnly(currentUser)) {
      return buildFallbackProfile(currentUser);
    }

    let response;
    try {
      response = await requestWithApiFallback('/users/me', {
        method: 'GET',
        headers: await getAuthHeaders(currentUser),
      });
    } catch {
      return buildFallbackProfile(currentUser);
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 503) {
      return buildFallbackProfile(currentUser);
    }

    if (!response.ok) {
      if (response.status >= 500 && response.status < 600) {
        return buildFallbackProfile(currentUser);
      }

      const message = String(payload?.error || payload?.details || 'Failed to fetch user profile');
      throw new Error(message);
    }

    const mergedProfile = mergeProfilePayload(payload, cachedProfile);
    writeCachedProfile(currentUser.uid, mergedProfile);

    return mergedProfile;
  };

  const patchCurrentUserProfile = async (updates = {}, currentUser = auth.currentUser) => {
    if (!currentUser) {
      throw new Error('No authenticated user found.');
    }

    const cachedProfile = readCachedProfile(currentUser.uid);

    let response;
    try {
      response = await requestWithApiFallback('/users/me', {
        method: 'PATCH',
        headers: await getAuthHeaders(currentUser),
        body: JSON.stringify(updates || {}),
      });
    } catch {
      const fallbackProfile = {
        ...buildFallbackProfile(currentUser),
        ...(updates || {}),
      };
      writeCachedProfile(currentUser.uid, fallbackProfile);
      return fallbackProfile;
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 503) {
      const fallbackProfile = {
        ...buildFallbackProfile(currentUser),
        ...(updates || {}),
      };
      writeCachedProfile(currentUser.uid, fallbackProfile);
      return fallbackProfile;
    }

    if (response.status >= 500 && response.status < 600) {
      const fallbackProfile = {
        ...buildFallbackProfile(currentUser),
        ...(updates || {}),
      };
      writeCachedProfile(currentUser.uid, fallbackProfile);
      return fallbackProfile;
    }

    if (!response.ok) {
      const message = String(payload?.error || payload?.details || 'Failed to update user profile');
      throw new Error(message);
    }

    const mergedProfile = mergeProfilePayload(payload, cachedProfile);
    writeCachedProfile(currentUser.uid, mergedProfile);

    return mergedProfile;
  };

  const applyProfileState = (profileData) => {
    if (!profileData) {
      setUserProfile(null);
      setUserRole(null);
      return;
    }

    const normalizedProfile = {
      ...profileData,
      profileCompleted: resolveProfileCompleted(profileData),
    };

    setUserProfile(normalizedProfile);
    setUserRole(normalizedProfile.role ?? null);
  };

  const refreshProfile = async (currentUser = auth.currentUser) => {
    if (!currentUser) {
      setUserProfile(null);
      setUserRole(null);
      return;
    }

    const profile = await fetchCurrentUserProfile(currentUser);
    applyProfileState(profile);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (currentUser) {
          setUser(currentUser);
          setProfileLoading(true);
          await refreshProfile(currentUser);
        } else {
          setUser(null);
          setUserRole(null);
          setUserProfile(null);
        }
      } catch (err) {
        console.error('Auth listener error:', err);
        setError(err.message);
      } finally {
        setProfileLoading(false);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      return () => {};
    }

    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const profile = await fetchCurrentUserProfile();
        if (!active) {
          return;
        }
        applyProfileState(profile);
      } catch {
        // Keep session alive even if profile polling fails transiently.
      }
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.uid]);

  const login = async (email, password) => {
    try {
      setError(null);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await patchCurrentUserProfile({ lastLoginDate: getTodayKey() }, userCredential.user);
      await refreshProfile(userCredential.user);
      return userCredential.user;
    } catch (loginError) {
      setError(loginError.message);
      throw loginError;
    }
  };

  const register = async (email, password, role) => {
    try {
      setError(null);

      if (!isCompanyEmail(email)) {
        const domainError = new Error(`Only @${companyEmailDomain} email addresses are allowed for new registrations.`);
        setError(domainError.message);
        throw domainError;
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await patchCurrentUserProfile(
        {
          role,
          lastLoginDate: getTodayKey(),
          profileCompleted: false,
        },
        userCredential.user
      );
      await refreshProfile(userCredential.user);
      setUserRole(role);
      return userCredential.user;
    } catch (registerError) {
      setError(registerError.message);
      throw registerError;
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await signOut(auth);
      setUser(null);
      setUserRole(null);
      setUserProfile(null);
    } catch (logoutError) {
      setError(logoutError.message);
      throw logoutError;
    }
  };

  const saveUserProfile = async (profileUpdates = {}) => {
    if (!user?.uid) {
      throw new Error('No authenticated user found.');
    }

    const nextName = trimOrNull(profileUpdates.name);
    const nextEmployeeId = trimOrNull(profileUpdates.employeeId);
    const nextPhone = trimOrNull(profileUpdates.phoneNumber);
    const nextPhoto = trimOrNull(profileUpdates.photoURL);
    const nextTitle = trimOrNull(profileUpdates.title);
    const nextDepartment = trimOrNull(profileUpdates.department);
    const nextOfficeLocation = trimOrNull(profileUpdates.officeLocation);

    const normalizedPhone = nextPhone ? normalizePhoneNumber(nextPhone) : null;
    if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
      throw new Error('Phone number must be exactly 10 digits.');
    }

    const payload = {
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'name') ? { name: nextName } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'employeeId') ? { employeeId: nextEmployeeId } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'phoneNumber') ? { phoneNumber: normalizedPhone } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'photoURL') ? { photoURL: nextPhoto } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'title') ? { title: nextTitle } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'department') ? { department: nextDepartment } : {}),
      ...(Object.prototype.hasOwnProperty.call(profileUpdates, 'officeLocation') ? { officeLocation: nextOfficeLocation } : {}),
    };

    const mergedProfile = {
      ...(userProfile || {}),
      ...payload,
      email: user.email ?? userProfile?.email ?? null,
    };

    payload.profileCompleted = isProfileComplete(mergedProfile);

    const updated = await patchCurrentUserProfile(payload);
    applyProfileState(updated);
  };

  const changePassword = async (currentPassword, newPassword) => {
    const activeUser = auth.currentUser;
    if (!activeUser || !activeUser.email) {
      throw new Error('No authenticated user found.');
    }

    const normalizedCurrent = String(currentPassword || '');
    const normalizedNext = String(newPassword || '');

    if (!normalizedCurrent) {
      throw new Error('Current password is required.');
    }

    if (normalizedNext.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    const credential = EmailAuthProvider.credential(activeUser.email, normalizedCurrent);
    await reauthenticateWithCredential(activeUser, credential);
    await updatePassword(activeUser, normalizedNext);

    await patchCurrentUserProfile({ passwordUpdatedAt: new Date().toISOString() }, activeUser);
  };

  const needsProfileCompletion = Boolean(user && !profileLoading && userProfile && !resolveProfileCompleted(userProfile));

  const value = {
    user,
    userRole,
    loading,
    profileLoading,
    userProfile,
    needsProfileCompletion,
    error,
    login,
    register,
    logout,
    saveUserProfile,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
