import { useEffect, useMemo, useState } from 'react';
import { Download, Share2, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'medicoins:installPromptDismissedAt';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

const isStandaloneApp = () => {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
};

const isDismissedRecently = () => {
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY));
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_MS;
};

const rememberDismissal = () => {
  window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
};

const InstallAppPrompt = ({ disabled = false }: { disabled?: boolean }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  const isIosSafari = useMemo(() => {
    const userAgent = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && 'ontouchend' in document);
    const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent);
    return isIos && isSafari;
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (disabled || isStandaloneApp() || isDismissedRecently()) {
      setVisible(false);
      return undefined;
    }

    if (!deferredPrompt && !isIosSafari) {
      return undefined;
    }

    const timerId = window.setTimeout(() => setVisible(true), 4000);
    return () => window.clearTimeout(timerId);
  }, [deferredPrompt, disabled, isIosSafari]);

  const closePrompt = () => {
    rememberDismissal();
    setVisible(false);
  };

  const installApp = async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  const isIosPrompt = isIosSafari && !deferredPrompt;

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 86, zIndex: 15, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 420, borderRadius: 22, overflow: 'hidden', background: '#FFFFFF', color: '#061B3A', boxShadow: '0 22px 45px rgba(6,27,58,0.24)', pointerEvents: 'auto', border: '1px solid rgba(246,195,67,0.35)' }}>
        <div style={{ background: 'linear-gradient(135deg, #061B3A, #102A4C)', color: '#FFFFFF', padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
          <img src="/icons/icon-192.png" alt="" style={{ width: 46, height: 46, borderRadius: 13, boxShadow: '0 8px 18px rgba(246,195,67,0.22)' }} />
          <div>
            <div style={{ color: '#F6C343', fontSize: 12, fontWeight: 900 }}>{isIosPrompt ? 'iPhone Home Screen' : 'Quick Access'}</div>
            <div style={{ fontWeight: 900, fontSize: 17 }}>{isIosPrompt ? 'Install COINS on iPhone' : 'Install COINS App'}</div>
          </div>
        </div>
        <div style={{ padding: 15 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: '#4B5871', fontWeight: 700, lineHeight: 1.45, fontSize: 13 }}>
            {isIosPrompt ? <Share2 size={22} color="#F6C343" /> : <Smartphone size={22} color="#F6C343" />}
            <span>
              {isIosPrompt
                ? 'Tap the Share button, then choose "Add to Home Screen".'
                : 'Add this app to your mobile home screen for quick access to invoices, offers, outstanding and Partner Coin rewards.'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            <button type="button" onClick={closePrompt} style={{ border: 0, borderRadius: 13, background: '#E8EDF4', color: '#061B3A', padding: 11, fontWeight: 900 }}>
              {isIosPrompt ? 'Later' : 'Later'}
            </button>
            <button type="button" onClick={isIosPrompt ? closePrompt : installApp} style={{ border: 0, borderRadius: 13, background: '#F6C343', color: '#061B3A', padding: 11, fontWeight: 900, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 7 }}>
              {isIosPrompt ? null : <Download size={16} />}
              {isIosPrompt ? 'Got it' : 'Install App'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstallAppPrompt;
