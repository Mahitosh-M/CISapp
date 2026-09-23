import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { disableNotifications, enableNotifications, notificationsConfigured, notificationsOptedIn } from '../services/notificationService';

export default function NotificationControl() {
  const { userProfile } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!notificationsConfigured || !userProfile?.active || !notificationsOptedIn()) return;
    let current = true;
    setBusy(true);
    enableNotifications(userProfile.uid, userProfile.role, false)
      .then(() => { if (current) setEnabled(Notification.permission === 'granted'); })
      .catch(() => { if (current) setError('Notifications paused. Tap to retry.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [userProfile?.uid, userProfile?.role, userProfile?.active]);
  if (!notificationsConfigured || !userProfile || !('Notification' in window)) return null;
  const toggle = async () => {
    setBusy(true); setError('');
    try {
      if (enabled) await disableNotifications();
      else await enableNotifications(userProfile.uid, userProfile.role, true);
      setEnabled(!enabled);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to enable notifications.'); }
    finally { setBusy(false); }
  };
  return <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, maxWidth: 220 }}>
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={enabled}
      title={enabled ? 'Turn off notifications on this device' : 'Enable notifications on this device'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 10, padding: '8px 10px', border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
      {enabled ? <Bell size={16} /> : <BellOff size={16} />} {busy ? 'Setting up…' : enabled ? 'Notifications on' : 'Enable alerts'}
    </button>
    {error && <small role="status">{error}</small>}
  </span>;
}
