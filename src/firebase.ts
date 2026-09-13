import { readFirebaseConfig } from './publicFirebaseConfig';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Public browser options are supplied by the build environment.
export const firebaseConfig = readFirebaseConfig(import.meta.env?.VITE_FIREBASE_CONFIG, 'VITE_FIREBASE_CONFIG');

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Firebase setup is complete. Use `db` for Firestore, `auth` for secure ERP login,
// and `storage` for Admin-managed offer images.
