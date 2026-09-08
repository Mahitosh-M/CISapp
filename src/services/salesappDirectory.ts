import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({ apiKey: 'AIzaSyDfVigFg3Kn25c2T2mY8Gqpv9HaZxRzQvc', authDomain: 'salesapp-aaa7b.firebaseapp.com', projectId: 'salesapp-aaa7b', storageBucket: 'salesapp-aaa7b.firebasestorage.app', messagingSenderId: '695799416355', appId: '1:695799416355:web:d2880f7d992db922e65396' }, 'salesapp-directory');
const db = getFirestore(app);
export type SalesStaffDirectoryEntry = { token: string; name: string };
export async function getSalesappBranchStaff(branchId: 'SINDHANUR' | 'MASKI'): Promise<SalesStaffDirectoryEntry[]> {
  const snap = await getDocs(collection(db, 'cisStaffDirectory', branchId, 'staff'));
  return snap.docs.map((doc) => ({ token: doc.id, name: String(doc.data().name || '') })).filter((row) => row.name).sort((a, b) => a.name.localeCompare(b.name));
}
