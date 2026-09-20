import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from '../firebase';

export const notificationsConfigured = Boolean(import.meta.env.VITE_FIREBASE_VAPID_KEY);
const functions = getFunctions(app, 'asia-south1');
const register = httpsCallable<{ token: string; remove: boolean }, { topics: string[] }>(functions, 'syncNotificationDevice', { timeout: 15000 });
export const broadcastNotification = httpsCallable<{
  audience: string; title: string; body: string; requestId: string;
}, { accepted: boolean; duplicate?: boolean }>(functions, 'sendNotificationBroadcast', { timeout: 30000 });

const OPT_IN = 'cisapp:notifications:enabled';
type Binding = { uid: string; token: string; role: string };
let generation = 0;
let registration: Promise<void> | undefined;
let registrationOwner = '';

// This store is also checked by the existing service worker before displaying or opening a push.
async function bindingStore(value?: Binding | null): Promise<Binding | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('cisapp-notification-session', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('session');
    open.onerror = () => reject(new Error('Notification storage is unavailable.'));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('session', value === undefined ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('session');
      const request = value === undefined ? store.get('current') : value === null ? store.delete('current') : store.put(value, 'current');
      transaction.oncomplete = () => { db.close(); resolve(value === undefined ? request.result || null : value); };
      transaction.onerror = () => { db.close(); reject(new Error('Unable to save notification preference.')); };
      transaction.onabort = () => { db.close(); reject(new Error('Unable to save notification preference.')); };
    };
  });
}
export function notificationsOptedIn() {
  try { return localStorage.getItem(OPT_IN) === 'yes'; } catch { return false; }
}
export async function clearNotificationSession() {
  generation++;
  if (!('indexedDB' in window)) return;
  await bindingStore(null);
  const worker = await navigator.serviceWorker?.getRegistration('/');
  const visible = await worker?.getNotifications();
  visible?.forEach(notification => notification.close());
}

export async function enableNotifications(uid: string, role: string, askPermission: boolean) {
  if (!notificationsConfigured || !('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Notifications are not available on this browser.');
  if (askPermission) {
    // Ask directly from the user's click, before any unrelated asynchronous work.
    if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in your browser settings to enable them.');
    localStorage.setItem(OPT_IN, 'yes');
  }
  if (!notificationsOptedIn() || Notification.permission !== 'granted') return;
  const owner = `${uid}:${generation}`;
  if (registration) {
    if (registrationOwner === owner) return registration;
    await registration.catch(() => undefined);
    if (auth.currentUser?.uid === uid) return enableNotifications(uid, role, false);
    return;
  }
  registrationOwner = owner;
  const attempt = generation;
  const stillCurrent = () => generation === attempt && auth.currentUser?.uid === uid && notificationsOptedIn();
  registration = (async () => {
    const sdk = await import('firebase/messaging');
    if (!await sdk.isSupported()) throw new Error('Notifications are not supported here. On iPhone, install the app on your Home Screen first.');
    // Reuse exactly the same worker/scope as main.tsx; do not create a Firebase-specific worker.
    await navigator.serviceWorker.register('/sw.js');
    const worker = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Notification setup took too long. Please retry.')), 15000))
    ]);
    if (!stillCurrent()) return;
    const token = await sdk.getToken(sdk.getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: worker });
    if (!stillCurrent()) return;
    await bindingStore(null);
    try { await register({ token, remove: false }); }
    catch (error) {
      if ((error as { code?: string }).code === 'functions/not-found' && stillCurrent()) {
        await sdk.deleteToken(sdk.getMessaging(app)).catch(() => undefined);
      }
      throw error;
    }
    if (!stillCurrent()) {
      // A logout during registration must never reactivate local private notifications.
      return;
    }
    await bindingStore({ uid, token, role });
    if (!stillCurrent()) await bindingStore(null);
  })().finally(() => { registration = undefined; });
  return registration;
}

// Local gate closes FIRST, even if offline. Backend/token cleanup is best effort and bounded so
// notification failure cannot prevent the existing business logout from completing.
export async function disableNotifications(forgetPreference = true) {
  if (forgetPreference) { try { localStorage.removeItem(OPT_IN); } catch { /* Still close the local gate. */ } }
  let previous: Binding | null = null;
  try { previous = await bindingStore(); } catch { /* Token deletion remains available. */ }
  await clearNotificationSession().catch(() => undefined);
  if (!notificationsConfigured) return;
  const cleanup = async () => {
    if (previous && auth.currentUser?.uid === previous.uid) {
      await register({ token: previous.token, remove: true }).catch(() => undefined);
    }
    // Keep the browser installation token dormant. Deleting it after a network timeout could
    // race a different account's login. The backend removes ownership and all topics instead.
  };
  await Promise.race([cleanup().catch(() => undefined), new Promise<void>(resolve => setTimeout(resolve, 3000))]);
}

export async function resetNotificationAccount(uid: string | null) {
  if (!notificationsConfigured || !('indexedDB' in window)) return;
  const previous = await bindingStore();
  if (!uid || (previous && previous.uid !== uid)) await clearNotificationSession();
}
