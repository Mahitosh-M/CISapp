import {routeDays,type WeeklyRoute} from '../utils/dispatchRoutes';
import {Truck, Package, Wallet, RefreshCw, CheckCircle2} from "lucide-react";
import "../delivery.css";
﻿import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { dispatchRequest } from "../services/dispatchService";
const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
import { getTodayDateString } from "../utils/dateUtils";
interface Claim {
  id: string;
  tripId: string;
  customerId: string;
  shopId: string;
  actorId: string;
  amount: number;
  mode: string;
  reference: string;
  note: string;
  status: string;
  postedAmount?: number;
  unallocated?: number;
  receiptIds?: string[];
  sourceIssue?: string;
  currentReceiptAmount?: number;
}
interface Reference {
  id: string;
  number: string;
  outstanding: number;
  date: string;
  opening: boolean;
}
interface Customer {
  id: string;
  name: string;
  invoices: Reference[];
}
interface Snapshot {
  claims: Claim[];
  customers: Customer[];
  requests: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    active: boolean;
    tripId: string | null;
    sourceIssue?: string;
    routeId?: string; routeName?: string; routeStopName?: string; routeDays?: number[]; scheduledDate?: string;
  }>;
}
export default function Dispatch() {
  const { role } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null),
    [note, setNote] = useState(""),
    [verified, setVerified] = useState(false),
    [override, setOverride] = useState(false),
    [allocations, setAllocations] = useState<Record<string, string>>({}),
    [postingDate, setPostingDate] = useState(getTodayDateString());
  const [routes,setRoutes]=useState<WeeklyRoute[]>([]);
  const [discount, setDiscount] = useState("0");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [next,catalog]=await Promise.all([dispatchRequest<Snapshot>("pull"),dispatchRequest<{routes:WeeklyRoute[]}>("routeCatalog")]);
      setSnapshot(next);setRoutes(catalog.routes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(reject: boolean) {
    if (!claim) return;
    if (
      !window.confirm(
        reject
          ? "Reject this claim? Reported physical cash still needs reconciliation."
          : `Post the reviewed collection to CISapp? Receipts affect invoice balances and shop funds once. Excess stays unallocated.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const rows = Object.entries(allocations)
        .filter(([, n]) => Number(n) > 0)
        .map(([invoiceId, n]) => {
          const amount = Number(n) * 100;
          if (Math.abs(amount - Math.round(amount)) > 0.0001)
            throw new Error("Use no more than two decimal places");
          return { invoiceId, amount: Math.round(amount) };
        });
      const discountPaise = Number(discount) * 100;
      if (
        !Number.isFinite(discountPaise) ||
        discountPaise < 0 ||
        Math.abs(discountPaise - Math.round(discountPaise)) > 0.0001
      )
        throw new Error("Invalid cash discount");
      const result = await dispatchRequest<{
        receiptIds: string[];
        unallocated: number;
        status: string;
      }>("approveCollection", {
        id: claim.id,
        approvalId: `review-${claim.id}`,
        reject,
        note,
        digitalVerified: verified,
        date: postingDate,
        discount: Math.round(discountPaise),
        ...(override ? { allocations: rows } : {}),
      });
      setMessage(
        `${result.status}. ${result.receiptIds.length} receipt(s). Unallocated: ${formatMoney(result.unallocated / 100)}.`,
      );
      setClaim(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const customer = snapshot?.customers.find((c) => c.id === claim?.customerId);
  return (
    <main className="cis-delivery-page">
      <h1><Truck size={28} aria-hidden="true"/> Deliveries & collections</h1>
      <p>
        Delivery requests and driver collections. CISapp remains the authority
        for invoices and receipts. Physical driver cash and handovers remain
        separate.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        <RefreshCw size={17} aria-hidden="true"/> Refresh
      </button>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {snapshot && (
        <>
          <div className="cis-delivery-metrics">
            <div><Package size={23} aria-hidden="true"/><strong>{snapshot.requests.filter(r=>r.active).length}</strong><span>Active requests</span></div>
            <div><Wallet size={23} aria-hidden="true"/><strong>{snapshot.claims.filter(c=>c.status==='Pending').length}</strong><span>Collections to review</span></div>
            <div><CheckCircle2 size={23} aria-hidden="true"/><strong>{snapshot.requests.filter(r=>r.active&&r.tripId).length}</strong><span>Assigned deliveries</span></div>
          </div>
          <section><h2>Weekly loading / dispatch routes</h2>{routes.filter(r=>r.active).map(r=><article className="cis-delivery-request" key={r.id}><Truck size={20}/><div><strong>{r.name}: {r.from} ? {r.to}</strong><span>{routeDays(r)}</span><small>{r.stops.map(s=>s.name).join(' ? ')}</small></div></article>)}{!routes.some(r=>r.active)&&<p>No routes configured by Dispatch Admin yet.</p>}<small>Weekly plan; actual loading is confirmed separately.</small></section>
          <section>
            <h2>Invoice delivery requests</h2>
            {snapshot.requests.length === 0 && (
              <p>No invoices marked for delivery.</p>
            )}
            {snapshot.requests.map((r) => (
              <article className="cis-delivery-request" key={r.id}>
                <Package size={20} aria-hidden="true"/>
                <div><strong>{r.invoiceNumber}</strong><span>{r.customerName}</span>{r.routeName&&<span>{r.routeName}{r.routeStopName?` / ${r.routeStopName}`:''} ? {routes.find(x=>x.id===r.routeId)?routeDays(routes.find(x=>x.id===r.routeId)!):'Route schedule unavailable'}</span>}{r.scheduledDate&&<span>Scheduled: {r.scheduledDate}</span>}<small className={'cis-delivery-status '+(!r.active?'needs-review':'')}>{r.active?(r.tripId?'Assigned':'Ready for Dispatch'):'Needs review'}</small>{r.sourceIssue&&<p role="alert">{r.sourceIssue}</p>}</div>
              </article>
            ))}
          </section>
          <section>
            <h2>Driver collection review</h2>
            {snapshot.claims.length === 0 && (
              <p>No collection claims received.</p>
            )}
            {snapshot.claims.map((c) => (
              <article
                key={c.id}
                className="cis-collection-tile"
              >
                <strong>
                  {snapshot.customers.find((x) => x.id === c.customerId)
                    ?.name || c.customerId}
                </strong>
                <p>
                  {c.mode} · Recorded {formatMoney(c.amount / 100)} · {c.status}
                </p>
                <p>
                  {c.reference} {c.note}
                </p>
                {c.sourceIssue && (
                  <p role="alert">
                    {c.sourceIssue}. Current receipt amount:{" "}
                    {formatMoney((c.currentReceiptAmount ?? 0) / 100)}.
                  </p>
                )}
                {c.status === "Pending" ? (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setClaim(c);
                      setNote("");
                      setVerified(false);
                      setOverride(false);
                      setDiscount("0");
                      setAllocations({});
                    }}
                  >
                    Review latest balances & approve
                  </button>
                ) : (
                  <p>
                    Posted {formatMoney((c.postedAmount ?? 0) / 100)} ·
                    Unallocated {formatMoney((c.unallocated ?? 0) / 100)} ·
                    Receipts {(c.receiptIds ?? []).join(", ") || "None"}
                  </p>
                )}
              </article>
            ))}
          </section>
        </>
      )}
      {claim && (
        <section
          role="dialog"
          aria-label="Review collection"
          className="cis-collection-review"
        >
          <h2>Review {customer?.name}</h2>
          <p>
            Default allocation: opening balance first, then oldest invoice. The
            server rechecks outstanding balances transactionally. Excess remains
            unallocated; no advance is automatically created.
          </p>
          <label>
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => {
                setOverride(e.target.checked);
                setDiscount("0");
              }}
            />{" "}
            Override allocation
          </label>
          {customer?.invoices
            .filter((i) => i.outstanding > 0)
            .map((i) => (
              <div key={i.id} style={{ margin: 8 }}>
                {i.number} · Outstanding {formatMoney(i.outstanding / 100)}{" "}
                {override && (
                  <label>
                    Allocate (₹)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={i.outstanding / 100}
                      value={allocations[i.id] || ""}
                      onChange={(e) =>
                        setAllocations({
                          ...allocations,
                          [i.id]: e.target.value,
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          {claim.mode !== "Credit" && !override && (
            <label>
              Approved cash discount (₹)
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </label>
          )}
          <label>
            Posting date
            <input
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
          </label>
          <label>
            Verification / decision note
            <textarea
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {!["Cash", "Credit"].includes(claim.mode) && (
            <label>
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />{" "}
              Independently verified destination account / bank transaction;
              screenshot alone is insufficient
            </label>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              disabled={busy || !note.trim()}
              onClick={() => void review(false)}
            >
              {claim.mode === "Credit"
                ? "Authorise unpaid delivery"
                : "Approve and post receipt"}
            </button>
            <button
              disabled={busy || !note.trim()}
              onClick={() => void review(true)}
            >
              Reject claim
            </button>
            <button disabled={busy} onClick={() => setClaim(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      {role === "Admin" && <section><h2>Dispatch accounts and settings</h2><p>Manage driver logins, roles, vehicles and shops from Administration in the authenticated CIS Dispatch dev application. Existing accounts retain their own passwords.</p></section>}
    </main>
  );
}
