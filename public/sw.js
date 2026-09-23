const CACHE_NAME = 'coins-static-v3';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (!requestUrl.pathname.startsWith('/icons/') && requestUrl.pathname !== '/manifest.json') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request))
  );
});

// FCM data-only Web Push uses this existing worker. Never send FCM's automatic
// `notification` payload: it would bypass the shared-device logout gate below.
function readNotificationSession() {
  return new Promise((resolve) => {
    const open = indexedDB.open('cisapp-notification-session', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('session');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('session', 'readonly');
      const request = transaction.objectStore('session').get('current');
      transaction.oncomplete = () => { db.close(); resolve(request.result || null); };
      transaction.onerror = () => { db.close(); resolve(null); };
    };
  });
}
function notificationAllowed(data, session) {
  if (!session?.uid || !data || typeof data.title !== 'string' || typeof data.body !== 'string') return false;
  if (data.title.length > 120 || data.body.length > 500) return false;
  if (['invoice', 'payment'].includes(data.type)) return data.recipientUid === session.uid && ['customer', 'Medical'].includes(session.role);
  if (data.type === 'order') return data.recipientUid === session.uid && session.role === 'Staff';
  if (data.type === 'broadcast') {
    if (data.topic === 'staff_announcements') return session.role === 'Staff';
    return ['customers_all', 'customers_general', 'customers_medicals'].includes(data.topic) && ['customer', 'Medical'].includes(session.role);
  }
  return false;
}
function notificationPath(data, session) {
  if (data.type === 'invoice') return '/customer/invoices';
  if (data.type === 'payment') return '/customer/dashboard';
  return ['customer', 'Medical'].includes(session.role) ? '/customer' : '/';
}
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json()?.data; } catch { return; }
    const session = await readNotificationSession();
    if (!notificationAllowed(data, session)) return;
    const tag = `cisapp:${data.type}:${data.entityId || Date.now()}`;
    await self.registration.showNotification(data.title, {
      body: data.body, icon: '/icons/icon-192.png', tag,
      data: { ...data, openedForUid: session.uid }
    });
    // Also close a push if logout happened while showNotification was pending.
    const current = await readNotificationSession();
    if (!current || current.uid !== session.uid) {
      (await self.registration.getNotifications({ tag })).forEach(notification => notification.close());
    }
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data;
    const session = await readNotificationSession();
    if (!notificationAllowed(data, session) || data.openedForUid !== session.uid) return;
    // Fixed same-origin destinations; never trust a URL embedded in a push.
    const target = new URL(notificationPath(data, session), self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); await existing.focus(); }
    else await self.clients.openWindow(target);
  })());
});
