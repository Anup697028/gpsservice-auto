import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../services/firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getTodayKey = () => new Date().toISOString().slice(0, 10);

  const ensureUserDoc = async (currentUser, source) => {
    const userDocRef = doc(db, 'users', currentUser.uid);
    const userDocSnap = await getDoc(userDocRef);

    console.log(`${source} - User:`, currentUser.email);
    console.log(`${source} - User doc exists:`, userDocSnap.exists());
    console.log(`${source} - User doc data:`, userDocSnap.data());

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      setUserRole(userData.role ?? null);
      console.log(`${source} - Role set to:`, userData.role ?? null);
      return;
    }

    console.warn(`${source} - User document does not exist in Firestore`);
    await setDoc(
      userDocRef,
      {
        email: currentUser.email ?? null,
        role: null,
        createdAt: new Date(),
      },
      { merge: true }
    );
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (currentUser) {
          setUser(currentUser);
          await ensureUserDoc(currentUser, 'Auth');
        } else {
          setUser(null);
          setUserRole(null);
          console.log('Auth - User logged out');
        }
      } catch (err) {
        console.error('Auth listener error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);
      console.log('Attempting login for:', email);
      console.log('Auth instance:', auth);
      console.log('Auth domain:', auth.config.authDomain);
      
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(db, 'users', userCredential.user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        const lastLoginDate = userData.lastLoginDate || null;
        const todayKey = getTodayKey();

        if (userData.role === 'RH' && lastLoginDate === todayKey) {
          await signOut(auth);
          throw new Error('Regional Head can login only once per calendar day.');
        }

        await updateDoc(userDocRef, { lastLoginDate: todayKey });
      }

      await ensureUserDoc(userCredential.user, 'Login');
      return userCredential.user;
    } catch (error) {
      console.error('Login error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error details:', JSON.stringify(error, null, 2));
      
      if (error.code === 'auth/network-request-failed') {
        console.error('Network diagnostics:');
        console.error('- Check internet connection');
        console.error('- Firebase Auth Domain:', auth.config.authDomain);
        console.error('- Try accessing: https://' + auth.config.authDomain);
        const enhancedError = new Error(
          'Network error: Unable to reach Firebase servers. Please check your internet connection and firewall settings.'
        );
        enhancedError.code = error.code;
        setError(enhancedError.message);
        throw enhancedError;
      }
      
      setError(error.message);
      throw error;
    }
  };

  const register = async (email, password, role) => {
    try {
      setError(null);
      console.log('Attempting registration for:', email, 'with role:', role);
      console.log('Auth instance:', auth);
      console.log('Auth domain:', auth.config.authDomain);
      
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      // Store user role in Firestore
      const userDocRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userDocRef, {
        email,
        role,
        createdAt: new Date(),
        lastLoginDate: getTodayKey(),
      });
      setUserRole(role);
      return userCredential.user;
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await signOut(auth);
      setUser(null);
      setUserRole(null);
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  const value = {
    user,
    userRole,
    loading,
    error,
    login,
    register,
    logout,
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
