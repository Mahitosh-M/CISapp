import { readFirebaseConfig } from '../publicFirebaseConfig';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp(readFirebaseConfig(import.meta.env?.VITE_SALESAPP_FIREBASE_CONFIG, 'VITE_SALESAPP_FIREBASE_CONFIG'), 'salesapp-directory');
const db = getFirestore(app);
export type SalesStaffDirectoryEntry = { token: string; name: string };
export async function getSalesappBranchStaff(branchId: 'SINDHANUR' | 'MASKI'): Promise<SalesStaffDirectoryEntry[]> {
  const snap = await getDocs(collection(db, 'cisStaffDirectory', branchId, 'staff'));
  return snap.docs.map((doc) => ({ token: doc.id, name: String(doc.data().name || '') })).filter((row) => row.name).sort((a, b) => a.name.localeCompare(b.name));
}
