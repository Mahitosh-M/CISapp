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
        console.error(err);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const role = userProfile?.role ?? null;

    return {
      firebaseUser,
      userProfile,
      role,
      loading,
      login: async (email: string, password: string) => {
        await loginWithEmail(email, password);
      },
      logout: logoutUser,
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
