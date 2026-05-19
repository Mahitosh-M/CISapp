import { deleteApp, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, firebaseConfig } from '../firebase';
import {
  createUserProfile,
  getUserProfileByEmail,
  getUserProfileByUid,
  getUserProfiles,
  updateUserProfileRecord
} from './firestoreService';
import type { UserProfile, UserRole } from '../types';

export const listenToAuthState = (callback: (user: User | null) => void) => onAuthStateChanged(auth, callback);

export const loginWithEmail = async (email: string, password: string) => {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, email, password);
};

export const logoutUser = async () => {
  return signOut(auth);
};

export const loadOrCreateUserProfile = async (user: User): Promise<UserProfile> => {
  const existingByUid = await getUserProfileByUid(user.uid);

  if (existingByUid) {
    return existingByUid;
  }

  const existingByEmail = user.email ? await getUserProfileByEmail(user.email) : undefined;

  if (existingByEmail) {
    await updateUserProfileRecord(existingByEmail.id, {
      uid: user.uid,
      active: true
    });

    return {
      ...existingByEmail,
      uid: user.uid,
      active: true
    };
  }

  // First login becomes Admin so a fresh Firebase project can bootstrap itself without server code.
  const existingProfiles = await getUserProfiles();
  const role: UserRole = existingProfiles.length === 0 ? 'Admin' : 'Staff';

  await createUserProfile({
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || user.email || 'ERP User',
    role,
    active: true
  });

  const createdProfile = await getUserProfileByUid(user.uid);

  if (!createdProfile) {
    throw new Error('User profile could not be created.');
  }

  return createdProfile;
};

export const createStaffAuthAccount = async (email: string, password: string, name: string, role: UserRole) => {
  // A secondary Firebase app prevents staff creation from logging out the current Admin session.
  const secondaryApp = initializeApp(firebaseConfig, `staff-admin-${Date.now()}`);

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await createUserProfile({
      uid: credential.user.uid,
      email,
      name,
      role,
      active: true
    });

    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
};
