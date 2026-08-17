import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Placeholder Firebase configuration. Replace with your real project values.
export const firebaseConfig = {
  apiKey: "AIzaSyATEp0aDCh1vLcI21KB3Nphy5Rygy7_CMU",
  authDomain: "cisapp-236ab.firebaseapp.com",
  projectId: "cisapp-236ab",
  storageBucket: "cisapp-236ab.firebasestorage.app",
  messagingSenderId: "835565586103",
  appId: "1:835565586103:web:c46c8f8137288c21366f32"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Firebase setup is complete. Use `db` for Firestore, `auth` for secure ERP login,
// and `storage` for Admin-managed offer images.
