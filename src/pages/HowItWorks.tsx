import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, ClipboardCheck, CreditCard, FileText, MapPinned, PackageCheck, Pause, Play, RotateCcw, ShoppingCart, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './HowItWorks.css';

type GuideStep = { title: string; app: string; owner: string; icon: LucideIcon; result: string; actions: string[]; note: string };
export const guideSteps: GuideStep[] = [
  {
    title: 'Place an order', app: 'Orderapp', owner: 'Customer / Medical', icon: ShoppingCart,
    result: 'A pending order enters the shared order queue.',
    actions: [
      'Open Order from the CISapp portal, search or browse products, choose quantities and add items to the cart.',
      'Review the cart, choose the delivery preference, add any note and submit the order.',
      'Admin controls access in Settings: normal Customer ordering needs Turn on Order enabled and Medical Order disabled. Medical ordering uses Medical Order. Header Order controls the header button for the eligible group.'
    ],
    note: 'An order records requested products. An invoice is created separately in CISapp.'
  },
  {
    title: 'Review the order', app: 'CISapp → Orderapp', owner: 'Staff / Admin', icon: ClipboardCheck,
    result: 'The saved order becomes Confirmed.',
    actions: [
      'Staff open Orders in CISapp. The login alert opens this page when open orders are found. Use Refresh for the latest queue.',
      'Choose Manage order to open that order in Orderapp. Admin enters Orderapp from CISapp → Admin → Order.',
      'Check products and quantities. Save edits first, then Confirm. Confirmation changes the status; it does not save unfinished edits.'
    ],
    note: 'Orderapp Delivered removes the order, including its customer order history. Use it only after completion. It does not create an invoice or record driver delivery proof.'
  },
  {
    title: 'Create the invoice', app: 'CISapp', owner: 'Staff / Admin', icon: FileText,
    result: 'The invoice is saved with its customer, shop and payment terms.',
    actions: [
      'Open Invoices, select the correct Customer or Medical mode, then select the customer and shop.',
      'Enter the invoice number, date, sales amount and applicable invoice fields. Check the selected customer, credit information and totals before saving.',
      'On the saved invoice, open Mark for delivery. Enter packages, delivery address/contact and the map pin; select the active weekly route and requested date.'
    ],
    note: 'You can also select Delivery required while creating the invoice; the delivery form opens after saving. Save that delivery request to create the daily route draft.'
  },
  {
    title: 'Build the daily route', app: 'CISapp → Dispatch', owner: 'Automatic + Staff / Admin', icon: MapPinned,
    result: 'Delivery jobs join an automatic daily draft for the selected route.',
    actions: [
      'Save delivery request. The date moves to the next service weekday for the selected weekly route, on or after the entered date.',
      'Requests for the same route and day join its available draft. Saving again updates the request without duplicating the stop.',
      'Open CISapp → Delivery → Refresh → Daily route drafts → Edit route. Staff reorder their own shop’s visible stops; Admin can review the full route in Dispatch.'
    ],
    note: 'Example: a Monday route requested for Friday 6 November 2026 is planned for Monday 9 November. If a trip has already been released or a draft has 60 stops, later deliveries use another draft.'
  },
  {
    title: 'Assign and release', app: 'Dispatch', owner: 'Admin / authorised Manager', icon: Truck,
    result: 'The released trip becomes available to its assigned drivers after sync.',
    actions: [
      'Open Route planner → Automatic drafts to include future scheduled drafts. Edit the required daily route.',
      'Select an active vehicle and primary driver. Check the stops, route order, shop endpoints and any companion driver or advance. Save the draft.',
      'Release the route after its validation checks pass. Drivers sign in, reload or pull sync to download their assigned trip.'
    ],
    note: 'Automatic drafts have no vehicle or driver until assigned. Drafts stay out of the driver queue until released.'
  },
  {
    title: 'Complete each delivery', app: 'Dispatch', owner: 'Driver', icon: PackageCheck,
    result: 'Each customer stop has its own loading and delivery outcome.',
    actions: [
      'In My trips, the primary driver starts the shift with the opening odometer reading and photo.',
      'For every delivery, mark Loaded only when that customer’s boxes are on the vehicle. At the destination mark Arrived.',
      'Record Delivered with the required acknowledgement/proof, or Failed with a reason. Use the available partial-delivery or reschedule options when applicable.',
      'Record collections and other trip activity using their forms. Sync pending actions when the connection is available.'
    ],
    note: 'Completed steps turn green for each delivery. Driver delivery completion and the Orderapp Delivered action are separate operations.'
  },
  {
    title: 'Review collections', app: 'Dispatch → CISapp', owner: 'Driver + Staff / Admin', icon: CreditCard,
    result: 'Approved collections can be posted to the correct invoice.',
    actions: [
      'The driver records a collection with its invoice, amount, mode and required proof. It enters the review queue.',
      'Staff or Admin review the collection in CISapp → Delivery. Match the customer, invoice and amount before approving or rejecting it.',
      'Approve and post receipt after checking the allocation and verifying any digital payment. The default allocation clears opening balances first, then the oldest invoices; excess remains unallocated. Credit authorises an unpaid delivery without posting a payment. Refresh Payments and the ledger to check the result.'
    ],
    note: 'A delivered package is not itself a payment. Do not enter the same collection again in Payments after it has already been posted.'
  },
  {
    title: 'Close the trip', app: 'Dispatch', owner: 'Driver → Manager / Admin', icon: Check,
    result: 'The reviewed trip is closed and its vehicle becomes available.',
    actions: [
      'Complete required stops and route waypoints, or have an authorised manager resolve the exceptions.',
      'The primary driver enters the closing odometer reading and photo, then submits the end of the shift.',
      'Manager/Admin review collections, fuel, returns, cash handover and odometer evidence. Resolve outstanding review items and close the trip.',
      'Use CISapp Analytics for business results and Dispatch reporting for trip operations. Customer / Medical / Both filters select the intended business group.'
    ],
    note: 'End submitted means the driver has finished submitting the shift. The manager’s final close is a separate step.'
  }
];

function DeliveryExample() {
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(false);
  const delivered = completed - (failed && completed > 0 ? 1 : 0);
  const failedCount = failed && completed > 0 ? 1 : 0;
  const data = [
    { label: 'Delivered', count: delivered, color: '#4ade80' },
    { label: 'Failed', count: failedCount, color: '#fb7185' },
    { label: 'Remaining', count: 4 - completed, color: '#93c5fd' }
  ];
  return <section className="how-card" aria-labelledby="delivery-example-title">
    <div className="how-eyebrow">Interactive example · fictional deliveries</div>
    <h2 id="delivery-example-title">Watch a route progress</h2>
    <p>Four customer stops. Advance the example to see how delivery outcomes change the route chart.</p>
    <div className="how-example-stops" aria-label="Example delivery stops">
      {[0, 1, 2, 3].map(i => <div key={i} className={i < completed ? (failed && i === completed - 1 ? 'failed' : 'done') : ''}>
        <span>{i < completed ? (failed && i === completed - 1 ? '!' : <Check size={19} />) : i + 1}</span>
        <strong>Stop {i + 1}</strong>
        <small>{i < completed ? (failed && i === completed - 1 ? 'Failed' : 'Delivered') : 'Pending'}</small>
      </div>)}
    </div>
    <div className="how-bars" role="img" aria-label={data.map(d => d.label + ': ' + d.count).join(', ')}>
      {data.map(d => <div className="how-bar-row" key={d.label}><span>{d.label}</span><div className="how-bar-track"><div style={{ width: (d.count / 4 * 100) + '%', background: d.color }} /></div><strong>{d.count}</strong></div>)}
    </div>
    <div className="how-controls">
      <button type="button" onClick={() => setCompleted(value => Math.min(4, value + 1))} disabled={completed === 4}>Complete next stop <ArrowRight size={16} /></button>
      <button type="button" className="how-secondary" onClick={() => { setCompleted(0); setFailed(false); }}><RotateCcw size={16} />Reset example</button>
    </div>
    <label className="how-checkbox"><input type="checkbox" checked={failed} onChange={event => setFailed(event.target.checked)} />Show the latest completed stop as failed</label>
    <p className="how-caption">Training controls only. They never change a real order, invoice, route or payment.</p>
  </section>;
}

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (active === guideSteps.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setActive(value => value + 1), 6500);
    return () => window.clearTimeout(timer);
  }, [playing, active]);
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  const select = (index: number) => { setPlaying(false); setActive(index); };
  const step = guideSteps[active];
  const Icon = step.icon;
  return <div className="how-guide">
    <header className="how-hero">
      <div className="how-eyebrow"><BookOpen size={16} /> Admin guide · Updated 6 November 2026</div>
      <h1>How it works</h1>
      <p>From the first order to the final delivery. Follow the complete workflow across your three apps.</p>
      <div className="how-apps"><span>Orderapp <small>Products & orders</small></span><ArrowRight aria-hidden="true" /><span>CISapp <small>Invoices & accounts</small></span><ArrowRight aria-hidden="true" /><span>Dispatch <small>Routes & deliveries</small></span></div>
    </header>

    <section className="how-card" aria-labelledby="journey-title">
      <div className="how-section-heading"><div><div className="how-eyebrow">The complete journey</div><h2 id="journey-title">Order to trip closing</h2></div><button type="button" onClick={() => { if (active === guideSteps.length - 1) setActive(0); setPlaying(value => !value); }}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? 'Pause walkthrough' : 'Play walkthrough'}</button></div>
      <div className="how-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={1} aria-valuemax={guideSteps.length} aria-valuenow={active + 1}><div style={{ width: ((active + 1) / guideSteps.length * 100) + '%' }} /></div>
      <ol className="how-flow" aria-label="Workflow steps">
        {guideSteps.map((item, index) => { const StepIcon = item.icon; return <li key={item.title}><button type="button" aria-pressed={active === index} aria-controls="guide-step-detail" onClick={() => select(index)} className={active === index ? 'selected' : index < active ? 'visited' : ''}><span className="how-step-icon"><StepIcon size={21} /></span><small>{String(index + 1).padStart(2, '0')}</small><strong>{item.title}</strong></button></li>; })}
      </ol>
      <article id="guide-step-detail" className="how-detail" key={active} aria-labelledby="guide-step-heading">
        <div className="how-detail-heading"><div className="how-large-icon"><Icon size={28} /></div><div><span className="how-eyebrow">Step {active + 1} of {guideSteps.length} · {step.app}</span><h3 id="guide-step-heading">{step.title}</h3></div></div>
        <span className="how-owner">{step.owner}</span>
        <ol className="how-actions">{step.actions.map(action => <li key={action}>{action}</li>)}</ol>
        <div className="how-note">{step.note}</div>
        <p className="how-result"><Check size={18} /><strong>{step.result}</strong></p>
      </article>
      <div className="how-step-controls"><button type="button" className="how-secondary" disabled={active === 0} onClick={() => select(active - 1)}><ChevronLeft size={18} />Previous</button><span aria-live="polite">Step {active + 1} / {guideSteps.length}</span><button type="button" className="how-secondary" disabled={active === guideSteps.length - 1} onClick={() => select(active + 1)}>Next<ChevronRight size={18} /></button></div>
    </section>

    <div className="how-two-columns">
      <DeliveryExample />
      <section className="how-card" aria-labelledby="handoff-title">
        <div className="how-eyebrow">Who does what</div><h2 id="handoff-title">The handoff map</h2>
        <div className="how-handoff">
          <div><ShoppingCart /><strong>Customer / Medical</strong><span>Choose products → submit order</span></div>
          <ArrowRight className="how-down-arrow" aria-hidden="true" />
          <div><FileText /><strong>Staff / Admin</strong><span>Review → invoice → delivery request</span></div>
          <ArrowRight className="how-down-arrow" aria-hidden="true" />
          <div><MapPinned /><strong>Automatic draft</strong><span>Group by weekly route + service date</span></div>
          <ArrowRight className="how-down-arrow" aria-hidden="true" />
          <div><Truck /><strong>Planner → Driver → Reviewer</strong><span>Assign & release → deliver → reconcile & close</span></div>
        </div>
      </section>
    </div>

    <section className="how-card" aria-labelledby="setup-title">
      <div className="how-eyebrow">Before your first delivery</div><h2 id="setup-title">Admin setup checklist</h2>
      <div className="how-setup-grid">
        <div><strong>1. People & shops</strong><p>Create the Customer or Medical login and assign Staff to the correct shop. In Dispatch, activate drivers and vehicles.</p><Link to="/admin">Open Admin <ArrowRight size={15} /></Link></div>
        <div><strong>2. Weekly routes</strong><p>Create an active weekly route with its service day, departure/return shop and ordered waypoints. Check delivery addresses and pins.</p><a href="https://delivery-28165.web.app/routes" target="_blank" rel="noopener noreferrer">Open Route planner <ArrowRight size={15} /></a></div>
        <div><strong>3. Ordering & catalogue</strong><p>Set the required ordering toggles. Open Admin → Order to manage category/product images, availability and orders with the verified Admin session.</p><Link to="/settings">Open Settings <ArrowRight size={15} /></Link></div>
      </div>
    </section>

    <section className="how-card" aria-labelledby="questions-title">
      <div className="how-eyebrow">Quick answers</div><h2 id="questions-title">When something is missing</h2>
      <details><summary>The driver cannot see a trip</summary><p>Check the service date, driver and vehicle. Save and Release the draft in Dispatch, then sign in again, reload or pull sync on the driver device. Check that the driver account is active and assigned to that trip.</p></details>
      <details><summary>A daily draft is missing from today’s list</summary><p>Open Automatic drafts in Dispatch to include future dates. The requested date is moved forward to the weekly route’s service day. In CISapp, Refresh Delivery and confirm the Customer / Medical mode and Staff shop.</p></details>
      <details><summary>I need to change a planned delivery</summary><p>Before release, edit the saved invoice’s delivery request to change the route, date or packages. Use Daily route drafts to change stop order. After release, use the authorised Dispatch review/change flow; the published trip is protected from silent changes.</p></details>
      <details><summary>The customer’s balance has not reduced</summary><p>Check that a payment was posted to the correct invoice. An order confirmation, delivered package or collection waiting for approval does not settle the invoice. Refresh the ledger after posting and check the receipt before entering another payment.</p></details>
      <details><summary>Customer and Medical ordering behave differently</summary><p>Medical Order enables Medical ordering and suppresses normal Customer ordering. With Medical Order off, Turn on Order enables normal Customer ordering. Header Order only shows the header button when that role is eligible to order.</p></details>
      <details><summary>Where are accounts, rewards and reports?</summary><p>Customers and Medicals view invoices, balances, ledger and eligible rewards in their portals. Admin uses Loyalty for reward/offers audiences and Analytics → Customer / Medical / Both for reports. Payments and invoice terms remain in CISapp; Dispatch handles trip operations.</p></details>
    </section>
    <footer className="how-caption">This guide is maintained with app releases. The walkthrough and charts use examples and do not read business records.</footer>
  </div>;
}
