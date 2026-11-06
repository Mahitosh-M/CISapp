import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

export function openOrderAdmin(onError: (message: string) => void) {
  const target = new URL(import.meta.env.DEV ? 'http://127.0.0.1:5174/admin' : 'https://orderapp-35200.web.app/admin');
  const nonce = crypto.randomUUID();
  target.hash = new URLSearchParams({ nonce, source: window.location.origin }).toString();
  const child = window.open(target.href, '_blank');
  if (!child) { onError('Allow pop-ups to open Orderapp Admin.'); return; }
  let exchanging = false;
  const cleanup = () => { window.removeEventListener('message', receive); window.clearTimeout(timer); };
  const receive = async (event: MessageEvent) => {
    if (event.origin !== target.origin || event.source !== child || event.data?.nonce !== nonce || exchanging) return;
    if (event.data.type === 'orderapp-admin-connected') { cleanup(); return; }
    if (event.data.type !== 'orderapp-admin-ready') return;
    exchanging = true;
    try {
      const result = await httpsCallable<Record<string, never>, { token: string }>(getFunctions(app, 'asia-south1'), 'createOrderAdminSession')({});
      if (child.closed) { cleanup(); return; }
      child.postMessage({ type: 'cisapp-admin-session', nonce, token: result.data.token }, target.origin);
      exchanging = false;
    } catch { cleanup(); onError('Unable to open Orderapp Admin. Check your Admin access and try again.'); }
  };
  const timer = window.setTimeout(() => { cleanup(); onError('Orderapp Admin connection timed out. Please try again.'); }, 60000);
  window.addEventListener('message', receive);
}
