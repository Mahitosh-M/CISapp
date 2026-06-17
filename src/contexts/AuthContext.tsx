import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { listenToAuthState, loadOrCreateUserProfile, loginWithEmail, logoutUser } from '../services/authService';
import type { UserProfile, UserRole } from '../types';

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  role: UserRole | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  canDeleteRecords: boolean;
  canEditRecords: boolean;
  canManageSettings: boolean;
  canViewReports: boolean;
  canApproveGifts: boolean;
  canManageUsers: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const INACTIVITY_LOGOUT_MS = 10 * 60 * 1000;
const LAST_ACTIVITY_STORAGE_KEY = 'cisapp:lastActivityAt';
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

const readStoredLastActivityAt = () => {
  try {
    const timestamp = Number(window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY));
    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
};

const writeStoredLastActivityAt = (timestamp: number) => {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Session timeout still works in this tab if localStorage is unavailable.
  }
};

const clearStoredLastActivityAt = () => {
  try {
    window.localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    // Firebase sign-out still clears the authenticated app session.
  }
};

const isSessionExpired = (timestamp: number) => {
  return !timestamp || Date.now() - timestamp >= INACTIVITY_LOGOUT_MS;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = listenToAuthState(async (currentUser) => {
      try {
        setLoading(true);
        setFirebaseUser(currentUser);

        if (!currentUser) {
          setUserProfile(null);
          clearStoredLastActivityAt();
          return;
        }

        if (isSessionExpired(readStoredLastActivityAt())) {
          setFirebaseUser(null);
          setUserProfile(null);
          await logoutUser();
          return;
        }

        // Business rule: Firestore users collection controls app roles.
        const profile = await loadOrCreateUserProfile(currentUser);
        setUserProfile(profile.active ? profile : null);
      } catch (err) {
        // If Admin deleted the Firestore user profile, Firebase Auth may still accept
        // the email/password. Clearing the app session prevents that deleted login
        // from reaching ERP pages until Admin creates a new profile.
        setUserProfile(null);
        if (currentUser) {
          await logoutUser();
        }
        clearStoredLastActivityAt();
        console.error(err);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!firebaseUser || !userProfile) return undefined;

    let timeoutId: number | undefined;
    let lastActivityAt = readStoredLastActivityAt();
    let logoutStarted = false;

    const getLastActivityAt = () => Math.max(lastActivityAt, readStoredLastActivityAt());

    const runInactivityLogout = async () => {
      if (logoutStarted) return;
      logoutStarted = true;
      clearStoredLastActivityAt();
      await logoutUser();
    };

    const scheduleLogout = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      const elapsed = Date.now() - getLastActivityAt();
      const remaining = Math.max(INACTIVITY_LOGOUT_MS - elapsed, 0);

      timeoutId = window.setTimeout(() => {
        if (Date.now() - getLastActivityAt() >= INACTIVITY_LOGOUT_MS) {
          void runInactivityLogout();
          return;
        }

        scheduleLogout();
      }, remaining);
    };

    const recordActivity = () => {
      if (document.visibilityState === 'hidden') return;

      lastActivityAt = Date.now();
      writeStoredLastActivityAt(lastActivityAt);
      scheduleLogout();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      if (Date.now() - getLastActivityAt() >= INACTIVITY_LOGOUT_MS) {
        void runInactivityLogout();
        return;
      }

      recordActivity();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_STORAGE_KEY) return;

      const timestamp = Number(event.newValue);
      if (Number.isFinite(timestamp)) {
        lastActivityAt = Math.max(lastActivityAt, timestamp);
        scheduleLogout();
      }
    };

    if (isSessionExpired(getLastActivityAt())) {
      void runInactivityLogout();
      return undefined;
    }

    recordActivity();
    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [firebaseUser, userProfile]);

  const value = useMemo<AuthContextValue>(() => {
    const role = userProfile?.role ?? null;

    return {
      firebaseUser,
      userProfile,
      role,
      loading,
      login: async (email: string, password: string) => {
        writeStoredLastActivityAt(Date.now());
        try {
          const credential = await loginWithEmail(email, password);
          const profile = await loadOrCreateUserProfile(credential.user);

          if (!profile.active) {
            throw new Error('This login is inactive. Please contact Admin.');
          }

          setFirebaseUser(credential.user);
          setUserProfile(profile);
          writeStoredLastActivityAt(Date.now());
        } catch (err) {
          setFirebaseUser(null);
          setUserProfile(null);
          clearStoredLastActivityAt();
          await logoutUser();
          throw err;
        }
      },
      logout: async () => {
        clearStoredLastActivityAt();
        await logoutUser();
      },
      canDeleteRecords: role === 'Admin',
      canEditRecords: role === 'Admin',
      canManageSettings: role === 'Admin',
      canViewReports: role === 'Admin',
      canApproveGifts: role === 'Admin',
      canManageUsers: role === 'Admin'
    };
  }, [firebaseUser, loading, userProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
};
