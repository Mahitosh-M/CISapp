import { FormEvent, useRef, useState } from 'react';
import SectionHeader from '../components/SectionHeader';
import { broadcastNotification, notificationsConfigured } from '../services/notificationService';

export default function Notifications() {
  const [audience, setAudience] = useState('customers_all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const attempt = useRef<{ content: string; id: string }>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    const content = JSON.stringify([audience, title.trim(), body.trim()]);
    if (attempt.current?.content !== content) attempt.current = { content, id: crypto.randomUUID() };
    try {
      const result = await broadcastNotification({ audience, title: title.trim(), body: body.trim(), requestId: attempt.current!.id });
      setMessage(result.data.duplicate ? 'This send was already processed. Delivery is not confirmed.' : 'Announcement submitted. Delivery depends on each device’s notification settings.');
      setTitle(''); setBody(''); attempt.current = undefined;
    } catch { setMessage('Unable to confirm sending. You can retry; the same request will not be sent twice.'); }
    finally { setBusy(false); }
  };
  return <div>
    <SectionHeader title="Notifications" />
    <form onSubmit={submit} className="card" style={{ maxWidth: 560, display: 'grid', gap: 16, padding: 20 }}>
      <label>Audience<select value={audience} onChange={event => setAudience(event.target.value)} disabled={busy}>
        <option value="customers_all">All Customers</option><option value="customers_general">General Customers</option>
        <option value="customers_medicals">Medical Customers</option><option value="staff_announcements">Staff</option>
      </select></label>
      <label>Title<input value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} disabled={busy} /></label>
      <label>Message<textarea value={body} onChange={event => setBody(event.target.value)} required maxLength={500} rows={4} disabled={busy} /></label>
      <button type="submit" disabled={busy || !notificationsConfigured || !title.trim() || !body.trim()}>{busy ? 'Sending…' : 'Send'}</button>
      {!notificationsConfigured && <p role="status">Notifications need Firebase setup before sending is available.</p>}
      {message && <p role="status">{message}</p>}
    </form>
  </div>;
}
