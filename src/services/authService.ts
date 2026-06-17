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
import { auth, firebaseConfig } from '../firebase';
import {
  createUserProfile,
  getUserProfileByEmail,
  getUserProfileByUid
} from './firestoreService';
import type { UserProfile, UserRole } from '../types';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const listenToAuthState = (callback: (user: User | null) => void) => onAuthStateChanged(auth, callback);

export const loginWithEmail = async (email: string, password: string) => {
  await setPersistence(auth, browserLocalPersistence);
<<<<<<< HEAD
  return signInWithEmailAndPassword(auth, normalizeEmail(email), password);
=======
  return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
>>>>>>> Development
};

export const logoutUser = async () => {
  return signOut(auth);
};

export const loadOrCreateUserProfile = async (user: User): Promise<UserProfile> => {
  const existingByUid = await getUserProfileByUid(user.uid);

  if (existingByUid) {
    if (existingByUid.id !== user.uid) {
      await createUserProfile({
        uid: user.uid,
<<<<<<< HEAD
        email: normalizeEmail(existingByUid.email || user.email || ''),
        name: existingByUid.name || user.displayName || user.email || 'ERP User',
=======
        email: existingByUid.email || user.email || '',
        name: existingByUid.name,
>>>>>>> Development
        role: existingByUid.role,
        customerId: existingByUid.customerId,
        customerName: existingByUid.customerName,
        active: existingByUid.active
      });
<<<<<<< HEAD

      return {
        ...existingByUid,
        id: user.uid,
        uid: user.uid,
        email: normalizeEmail(existingByUid.email || user.email || '')
      };
=======
>>>>>>> Development
    }

    return existingByUid;
  }

  const rawEmail = user.email || '';
  const email = normalizeEmail(rawEmail);
  const existingByEmail = email
    ? (await getUserProfileByEmail(email)) || (rawEmail !== email ? await getUserProfileByEmail(rawEmail) : undefined)
    : undefined;

  if (existingByEmail) {
<<<<<<< HEAD
    await createUserProfile({
=======
    const repairedProfile = {
      uid: user.uid,
      email: existingByEmail.email || user.email || '',
      name: existingByEmail.name,
      role: existingByEmail.role,
      customerId: existingByEmail.customerId,
      customerName: existingByEmail.customerName,
      active: true
    };

    await updateUserProfileRecord(existingByEmail.id, {
>>>>>>> Development
      uid: user.uid,
      email,
      name: existingByEmail.name || user.displayName || user.email || 'ERP User',
      role: existingByEmail.role,
      customerId: existingByEmail.customerId,
      customerName: existingByEmail.customerName,
      active: true
    });
    await createUserProfile(repairedProfile);

    return {
      ...existingByEmail,
      id: user.uid,
      uid: user.uid,
      email,
      active: true
    };
  }

  // First unmatched Firebase Auth login becomes Admin so a fresh project can bootstrap.
  // After bootstrap, Admin-created users get deterministic users/{uid} profiles.
  const role: UserRole = 'Admin';

  await createUserProfile({
    uid: user.uid,
    email,
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
<<<<<<< HEAD
  const normalizedEmail = normalizeEmail(email);

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);

    await createUserProfile({
      uid: credential.user.uid,
      email: normalizedEmail,
      name,
      role,
      active: true
    });
=======
  const cleanEmail = email.trim().toLowerCase();

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);

    try {
      await createUserProfile({
        uid: credential.user.uid,
        email: cleanEmail,
        name: name.trim(),
        role,
        active: true
      });
    } catch (err) {
      await deleteUser(credential.user);
      throw err;
    }
>>>>>>> Development

    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
};

export const createCustomerAuthAccount = async (
  email: string,
  password: string,
  customerId: string,
  customerName: string
) => {
  // A secondary Firebase app prevents customer login creation from replacing the current Admin session.
  const secondaryApp = initializeApp(firebaseConfig, `customer-admin-${Date.now()}`);
<<<<<<< HEAD
  const normalizedEmail = normalizeEmail(email);

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);

    await createUserProfile({
      uid: credential.user.uid,
      email: normalizedEmail,
      name: customerName,
      role: 'customer',
      customerId,
      customerName,
      active: true
    });
=======
  const cleanEmail = email.trim().toLowerCase();

  try {
    const secondaryAuth = getAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);

    try {
      await createUserProfile({
        uid: credential.user.uid,
        email: cleanEmail,
        name: customerName.trim(),
        role: 'customer',
        customerId,
        customerName: customerName.trim(),
        active: true
      });
    } catch (err) {
      await deleteUser(credential.user);
      throw err;
    }
>>>>>>> Development

    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
};

export const sendUserPasswordResetEmail = async (email: string) => {
  // Firebase Auth never exposes existing passwords. Admin can safely help a user
  // regain access by sending the official Firebase reset email instead.
  return sendPasswordResetEmail(auth, normalizeEmail(email));
};
