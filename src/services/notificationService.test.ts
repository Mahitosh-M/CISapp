import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as { uid: string } | null }, register: vi.fn(), closed: vi.fn() }));
vi.mock('../firebase', () => ({ app: {}, auth: mocks.auth }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => mocks.register }));
vi.mock('firebase/messaging', () => ({ isSupported: async () => true, getMessaging: () => ({}), getToken: async () => 'a-long-browser-registration-token' }));
let current: unknown = null;
let preferences: Map<string, string>;
const worker = { getNotifications: async () => [{ close: mocks.closed }] };

beforeEach(() => {
  vi.resetModules(); vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'public-test-key');
  mocks.auth.currentUser = { uid: 'a' }; mocks.register.mockReset(); mocks.closed.mockReset();
  mocks.register.mockResolvedValue({ data: { topics: ['customers_all', 'customers_general'] } });
  current = null; preferences = new Map();
  const database = { close() {}, transaction() {
    const transaction = { oncomplete: undefined as (() => void) | undefined, onerror: undefined, onabort: undefined,
      objectStore: () => ({
        get: () => ({ result: current }),
        put: (value: unknown) => { current = value; return {}; },
        delete: () => { current = null; return {}; }
      }) };
    queueMicrotask(() => transaction.oncomplete?.());
    return transaction;
  } };
  const indexedDB = { open: () => {
    const request = { result: database, onsuccess: undefined as (() => void) | undefined, onerror: undefined, onupgradeneeded: undefined };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } };
  vi.stubGlobal('window', { indexedDB, Notification: {}, });
  vi.stubGlobal('indexedDB', indexedDB);
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => worker, ready: Promise.resolve(worker), getRegistration: async () => worker } });
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
  vi.stubGlobal('localStorage', { getItem: (key: string) => preferences.get(key), setItem: (key: string, value: string) => preferences.set(key, value), removeItem: (key: string) => preferences.delete(key) });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it('permission is requested only on explicit enable; registration does not trust client roles', async () => {
  const service = await import('./notificationService');
  await service.enableNotifications('a', 'customer', false);
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  await service.enableNotifications('a', 'customer', true);
  expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
  expect(mocks.register).toHaveBeenCalledWith({ token: 'a-long-browser-registration-token', remove: false });
  expect(current).toMatchObject({ uid: 'a', role: 'customer' });
});

it('logout closes the local private gate before failed network cleanup and retains opt-in for next login', async () => {
  const service = await import('./notificationService');
  await service.enableNotifications('a', 'customer', true);
  mocks.register.mockImplementation(async () => { expect(current).toBeNull(); throw new Error('offline'); });
  await service.disableNotifications(false);
  expect(current).toBeNull(); expect(mocks.closed).toHaveBeenCalled();
  expect(service.notificationsOptedIn()).toBe(true);
});

it('logout cannot be undone by a registration completing late', async () => {
  const service = await import('./notificationService');
  let started!: () => void;
  const hasStarted = new Promise<void>(resolve => { started = resolve; });
  let finish!: (value: unknown) => void;
  mocks.register.mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const pending = service.enableNotifications('a', 'customer', true);
  await hasStarted;
  await service.clearNotificationSession(); mocks.auth.currentUser = null;
  finish({ data: { topics: [] } }); await pending;
  expect(current).toBeNull();
});

it('account change clears the previous account binding', async () => {
  const service = await import('./notificationService');
  await service.enableNotifications('a', 'customer', true);
  await service.resetNotificationAccount('b');
  expect(current).toBeNull();
});
