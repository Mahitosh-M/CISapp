import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Route, X } from 'lucide-react';
import { dispatchRequest } from '../services/dispatchService';

export interface DailyRoutePlan {
  id: string; name: string; date: string; revision: number; routeId: string;
  stops: { id: string; customerId: string; customerName: string; invoiceId: string; invoiceNumber: string;
    packages: number; shopId: string; routeStopName: string; locked: boolean }[];
}

export default function DailyRoutePlans({ plans, customerIds, isAdmin, onSaved }: {
  plans: DailyRoutePlan[]; customerIds?: Set<string>; isAdmin: boolean; onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<DailyRoutePlan | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; editor.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [!!editing]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const visible = plans.map(plan => ({ ...plan, stops: plan.stops.filter(stop => !customerIds || customerIds.has(stop.customerId)) }))
    .filter(plan => plan.stops.length > 0);
  function move(index: number, offset: number) {
    if (!editing) return;
    const stops = [...editing.stops];
    [stops[index], stops[index + offset]] = [stops[index + offset], stops[index]];
    setEditing({ ...editing, stops });
  }
  async function save() {
    if (!editing) return;
    setBusy(true); setError('');
    try {
      await dispatchRequest('saveDailyRouteOrder', { id: editing.id, revision: editing.revision, stopIds: editing.stops.map(stop => stop.id) });
      setEditing(null); await onSaved();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Unable to save route'); }
    finally { setBusy(false); }
  }
  return <section>
    <h2><Route size={20} aria-hidden="true" /> Daily route drafts</h2>
    {!visible.length && <p>No automatic route drafts.{isAdmin && ' Select a weekly route when marking an invoice for delivery.'}</p>}
    {visible.map(plan => <article key={plan.id} className="cis-delivery-request">
      <Route size={20} aria-hidden="true" />
      <div><strong>{plan.name}</strong><span>{plan.date} | Draft</span><small>{plan.stops.length} deliveries | {plan.stops.reduce((sum, stop) => sum + stop.packages, 0)} packages</small></div>
      <button type="button" onClick={() => { setError(''); setEditing(structuredClone(plan)); }}>Edit route</button>
    </article>)}
    {isAdmin && visible.length > 0 && <a className="invoice-delivery-link" href="https://delivery-28165.web.app/routes" target="_blank" rel="noreferrer">Assign vehicle and driver in Dispatch</a>}
    {editing && <div className="cis-delivery-backdrop" role="dialog" aria-modal="true" aria-label="Edit daily route">
      <div ref={editor} tabIndex={-1} className="cis-delivery-dialog" onKeyDown={event => {
          if (event.key === 'Escape' && !busy) setEditing(null);
          if (event.key === 'Tab') {
            const items = editor.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]');
            if (!items?.length) return;
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className="cis-delivery-heading"><Route size={24} aria-hidden="true" /><div><h2>{editing.name}</h2><p>{editing.date} | Draft</p></div>
          <button type="button" className="cis-icon-button" aria-label="Close route editor" disabled={busy} onClick={() => setEditing(null)}><X size={20} /></button></header>
        {isAdmin && <p>Arrange the deliveries shown here. Other shop and customer groups keep their positions.</p>}
        <ol className="cis-daily-route-stops">{editing.stops.map((stop, index) => <li key={stop.id}>
          <span className="cis-daily-route-number">{index + 1}</span><div><strong>{stop.customerName}</strong><small>{stop.invoiceNumber} | {stop.packages} packages{stop.routeStopName ? ` | ${stop.routeStopName}` : ''}</small></div>
          <button type="button" aria-label={`Move delivery ${index + 1} up`} disabled={busy || stop.locked || index === 0 || editing.stops[index - 1]?.locked} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
          <button type="button" aria-label={`Move delivery ${index + 1} down`} disabled={busy || stop.locked || index === editing.stops.length - 1 || editing.stops[index + 1]?.locked} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
        </li>)}</ol>
        <a className="invoice-delivery-link" href="/invoices">{isAdmin ? 'Change delivery date, route or packages in Invoices' : 'Edit delivery details'}</a>
        {error && <p role="alert" className="cis-delivery-error">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="button" className="cis-save" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save route order'}</button></footer>
      </div>
    </div>}
  </section>;
}
