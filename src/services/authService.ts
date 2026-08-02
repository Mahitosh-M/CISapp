import { deleteApp, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, firebaseConfig, functions } from '../firebase';
import {
  createUserProfile,
  getUserProfileByUid
} from './firestoreService';
import type { UserProfile, UserRole } from '../types';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isAuthEmailAlreadyInUse = (err: unknown) => {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'auth/email-already-in-use';
};

const getReusableAuthCredential = async (secondaryAuth: ReturnType<typeof getAuth>, email: string, password: string) => {
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return { credential, createdNewAuthUser: true };
  } catch (err) {
    if (!isAuthEmailAlreadyInUse(err)) {
      throw err;
    }

    try {
      const credential = await signInWithEmailAndPassword(secondaryAuth, email, password);
      return { credential, createdNewAuthUser: false };
    } catch {
      await sendPasswordResetEmail(auth, email);
      throw new Error('This email already exists in Firebase Auth with a different password. A password reset email has been sent; use the reset link, then create the Admin-selected ERP login with the updated password.');
    }
  }
};

export const listenToAuthState = (callback: (user: User | null) => void) => onAuthStateChanged(auth, callback);

export const loginWithEmail = async (email: string, password: string) => {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, normalizeEmail(email), password);
};

export const logoutUser = async () => {
  return signOut(auth);
};

export const loadUserProfile = async (user: User): Promise<UserProfile> => {
  const profile = await getUserProfileByUid(user.uid);

  if (!profile || profile.uid !== user.uid) {
    throw new Error('This email does not have Admin-created ERP access.');
  }

  return profile;
};

export const createStaffAuthAccount = async (email: string, password: string, name: string, role: Extract<UserRole, 'Admin' | 'Staff'>) => {
  // A secondary Firebase app prevents staff creation from logging out the current Admin session.
  const secondaryApp = initializeApp(firebaseConfig, `staff-admin-${Date.now()}`);
  const normalizedEmail = normalizeEmail(email);

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const { credential, createdNewAuthUser } = await getReusableAuthCredential(secondaryAuth, normalizedEmail, password);

    try {
      await createUserProfile({
        uid: credential.user.uid,
        email: normalizedEmail,
        name: name.trim(),
        role,
        active: true
      });
    } catch (err) {
      if (createdNewAuthUser) {
        await deleteUser(credential.user);
      }
      throw err;
    }

    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
};

const createCustomerPortalAuthAccount = async (
  email: string,
  password: string,
  customerId: string,
  customerName: string,
  role: Extract<UserRole, 'customer' | 'Medical'>
) => {
  // A secondary Firebase app prevents portal login creation from replacing the current Admin session.
  const secondaryApp = initializeApp(firebaseConfig, `${role.toLowerCase()}-admin-${Date.now()}`);
  const normalizedEmail = normalizeEmail(email);

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const { credential, createdNewAuthUser } = await getReusableAuthCredential(secondaryAuth, normalizedEmail, password);

    try {
      const normalizedCustomerName = customerName.trim();

      await createUserProfile({
        uid: credential.user.uid,
        email: normalizedEmail,
        name: normalizedCustomerName,
        role,
        customerId,
        customerName: normalizedCustomerName,
        active: true
      });
    } catch (err) {
      if (createdNewAuthUser) {
        await deleteUser(credential.user);
      }
      throw err;
    }

    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
};

export const createCustomerAuthAccount = (email: string, password: string, customerId: string, customerName: string) =>
  createCustomerPortalAuthAccount(email, password, customerId, customerName, 'customer');

export const createMedicalAuthAccount = (email: string, password: string, customerId: string, customerName: string) =>
  createCustomerPortalAuthAccount(email, password, customerId, customerName, 'Medical');

export const deleteManagedUserAccount = async (profileId: string, uid: string) => {
  const callable = httpsCallable<{ profileId: string; uid: string }, { ok: boolean }>(functions, 'deleteManagedUser');
  return (await callable({ profileId, uid })).data;
};

export const sendUserPasswordResetEmail = async (email: string) => {
  // Firebase Auth never exposes existing passwords. Admin can safely help a user
  // regain access by sending the official Firebase reset email instead.
  return sendPasswordResetEmail(auth, normalizeEmail(email));
};
