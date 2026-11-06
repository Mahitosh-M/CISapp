import { getApp, getApps, initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore, limit, orderBy, query, where, type Timestamp } from 'firebase/firestore';
import { readFirebaseConfig } from '../publicFirebaseConfig';
export interface StaffOrderSummary {
  id: string; orderNumber: string; customerName: string; customerArea?: string; status: 'pending' | 'confirmed';
  totalProducts: number; totalQuantity: number; customerNote?: string; deliveryPreference?: string;
  createdAt?: Timestamp; items?: Array<{ productId: string; productName: string; quantity: number; packing?: string }>;
}
export function getOrderAppDb() {
  const options = readFirebaseConfig(import.meta.env.VITE_ORDERAPP_FIREBASE_CONFIG, 'VITE_ORDERAPP_FIREBASE_CONFIG');
  if (options.projectId !== 'orderapp-35200') throw new Error('Orderapp connection must use the Orderapp project.');
  const name = 'staff-orderapp';
  const app = getApps().some(app => app.name === name) ? getApp(name) : initializeApp(options, name);
  return getFirestore(app);
}
export async function loadStaffOpenOrders() {
  const result = await getDocs(query(collection(getOrderAppDb(), 'orders'), where('status', 'in', ['pending', 'confirmed']), orderBy('createdAt', 'desc'), limit(100)));
  return result.docs.map(row => ({ ...row.data(), id: row.id } as StaffOrderSummary))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}
export function staffOrderUrl(orderId?: string) {
  const url = new URL(import.meta.env.DEV ? 'http://127.0.0.1:5174/staff/orders' : 'https://orderapp-35200.web.app/staff/orders');
  url.search = new URLSearchParams({ name: 'staff', role: 'staff', returnUrl: window.location.origin + '/orders', ...(orderId ? { orderId } : {}) }).toString();
  return url.href;
}
