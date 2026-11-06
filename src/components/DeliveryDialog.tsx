import {routeDays,nextRouteDate,type WeeklyRoute} from '../utils/dispatchRoutes';
import DeliveryLocationEditor from './DeliveryLocationEditor';
import type {DeliveryLocation} from '../utils/route-geo';
import {Truck, CalendarDays, Package, MapPin, Phone, FileText, X, Check} from "lucide-react";
import "../delivery.css";
import { useState, useEffect, useRef, type FormEvent } from "react";
import type { Invoice } from "../types";
import { dispatchRequest } from "../services/dispatchService";
import { getTodayDateString } from "../utils/dateUtils";
export interface DeliveryTarget {
  id: string;
  shopId?: string;
  invoiceNumber: string;
  customerName: string;
  deliveryDetails?: Invoice["deliveryDetails"];
}
export default function DeliveryDialog({
  invoice,
  onClose,
  onSaved,
  allowMasterEdit = false,
}: {
  invoice: DeliveryTarget;
  onClose: () => void;
  onSaved: () => void;
  allowMasterEdit?: boolean;
}) {
  const [value, setValue] = useState({
    routeId: invoice.deliveryDetails?.routeId || "",
    routeStopId: invoice.deliveryDetails?.routeStopId || "",
    required: true,
    scheduledDate:
      invoice.deliveryDetails?.scheduledDate || getTodayDateString(),
    address: invoice.deliveryDetails?.address || "",
    contact: invoice.deliveryDetails?.contact || "",
    packages: invoice.deliveryDetails?.packages || 1,
    instructions: invoice.deliveryDetails?.instructions || "",
    location: invoice.deliveryDetails?.location ?? null,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [routes,setRoutes]=useState<WeeklyRoute[]>([]),[routeError,setRouteError]=useState(''),[routesLoading,setRoutesLoading]=useState(true);
  async function loadRoutes(){setRoutesLoading(true);setRouteError('');try{const result=await dispatchRequest<{routes:WeeklyRoute[]}>('routeCatalog');setRoutes(result.routes.filter(r=>!invoice.shopId||r.shopIds.includes(invoice.shopId)));}catch(e){setRouteError((e as Error).message);}finally{setRoutesLoading(false);}}
  useEffect(()=>{void loadRoutes();},[invoice.id]);
  const selectedRoute=routes.find(r=>r.id===value.routeId);
  const locationEdited=useRef(false),[masterCustomerId,setMasterCustomerId]=useState(''),[locationError,setLocationError]=useState('');
  useEffect(()=>{let active=true;void dispatchRequest<{customerId:string;location:DeliveryLocation|null}>('invoiceDeliveryLocation',{invoiceId:invoice.id}).then(result=>{if(!active)return;setMasterCustomerId(result.customerId);if(invoice.deliveryDetails?.location===undefined&&!locationEdited.current)setValue(v=>({...v,location:result.location}));}).catch(()=>{if(active)setLocationError('Saved customer pin unavailable. Select an invoice pin manually or retry later.');});return()=>{active=false;};},[invoice.id]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await dispatchRequest("markDelivery", {
        invoiceId: invoice.id,
        ...value,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to mark delivery");
    } finally {
      setBusy(false);
    }
  }
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';formRef.current?.focus();return()=>{document.body.style.overflow=overflow;previous?.focus();};},[]);
  return <div className="cis-delivery-backdrop" role="dialog" aria-modal="true" aria-label="Mark invoice for delivery" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}} onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const elements=formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select');if(!elements?.length)return;const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}>
    <form ref={formRef} tabIndex={-1} onSubmit={save} className="cis-delivery-dialog">
      <header className="cis-delivery-heading"><span className="cis-delivery-icon"><Truck size={24} aria-hidden="true"/></span><div><small>INVOICE DELIVERY</small><h2>{invoice.invoiceNumber}</h2><p>{invoice.customerName}</p></div><button type="button" className="cis-icon-button" aria-label="Close delivery request" disabled={busy} onClick={onClose}><X size={20}/></button></header>
      <label className="cis-delivery-toggle"><span><Truck size={18} aria-hidden="true"/> Delivery required</span><input type="checkbox" checked={value.required} onChange={e=>setValue({...value,required:e.target.checked})}/></label>
      {value.required&&<>
        <label><span><Truck size={17} aria-hidden="true"/> Delivery route</span><select className="cis-route-select" required disabled={routesLoading} value={value.routeId} onChange={e=>{const route=routes.find(r=>r.id===e.target.value);setValue({...value,routeId:e.target.value,routeStopId:'',scheduledDate:route?nextRouteDate(route.days,getTodayDateString())??value.scheduledDate:value.scheduledDate});}}><option value="">Route not selected</option>{value.routeId&&!routes.some(r=>r.id===value.routeId)&&<option value={value.routeId}>{invoice.deliveryDetails?.routeName||'Previously selected route'} (unavailable)</option>}{routes.filter(r=>r.active||r.id===value.routeId).map(r=><option key={r.id} value={r.id}>{r.name} - {r.from} to {r.to}{r.active?'':' (inactive)'}</option>)}</select></label>
        {routesLoading&&<small>Loading current weekly schedule...</small>}
        {routeError&&<div className="cis-delivery-error" role="alert">Route schedule unavailable: {routeError} <button type="button" onClick={()=>void loadRoutes()}>Retry routes</button></div>}
        {selectedRoute&&<div className="cis-route-schedule"><strong className="cis-route-name">{selectedRoute.name}</strong><span>{selectedRoute.from} to {selectedRoute.to}</span><span>Weekly loading / dispatch: {routeDays(selectedRoute)}</span>{allowMasterEdit && <small>Saving creates or joins the daily route draft.</small>}</div>}
        {selectedRoute&&selectedRoute.stops.length>0&&<label><span><MapPin size={17} aria-hidden="true"/> Route stop</span><select value={value.routeStopId} onChange={e=>setValue({...value,routeStopId:e.target.value})}><option value="">Select stop (optional)</option>{selectedRoute.stops.map((st,index)=><option key={st.id} value={st.id}>{index+1}. {st.name}</option>)}</select></label>}
        <div className="cis-delivery-grid">
          <label><span><CalendarDays size={17} aria-hidden="true"/> Scheduled date</span><input required type="date" value={value.scheduledDate} onChange={e=>setValue({...value,scheduledDate:e.target.value})}/></label>
          <label><span><Package size={17} aria-hidden="true"/> Packages</span><input required type="number" min={1} max={10000} value={value.packages} onChange={e=>setValue({...value,packages:Number(e.target.value)})}/></label>
        </div>
        <label><span><MapPin size={17} aria-hidden="true"/> Verified delivery address</span><textarea required rows={3} value={value.address} onChange={e=>setValue({...value,address:e.target.value})}/></label>
        <label><span><Phone size={17} aria-hidden="true"/> Delivery contact</span><input required type="tel" maxLength={40} value={value.contact} onChange={e=>setValue({...value,contact:e.target.value})}/></label>
        <DeliveryLocationEditor showExplanations={allowMasterEdit} value={value.location} route={selectedRoute} onChange={location=>{locationEdited.current=true;setValue({...value,location});}}/>
        {locationError&&<small role="status">{locationError}</small>}
        {selectedRoute&&<small>Daily route date: {nextRouteDate(selectedRoute.days,value.scheduledDate)??'Unscheduled'}</small>}
        {allowMasterEdit&&<button type="button" disabled={busy||!masterCustomerId||!value.location?.confirmed} onClick={async()=>{if(!window.confirm('Update this customer’s saved delivery pin for future invoices? Existing invoices retain their location snapshots.'))return;try{setBusy(true);await dispatchRequest('saveCustomerDeliveryLocation',{customerId:masterCustomerId,location:value.location});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save confirmed pin to customer profile (Admin)</button>}
        <label><span><FileText size={17} aria-hidden="true"/> Instructions</span><textarea rows={2} maxLength={1500} value={value.instructions} onChange={e=>setValue({...value,instructions:e.target.value})}/></label>
      </>}
      {error&&<p className="cis-delivery-error" role="alert">{error}</p>}
      <footer>{allowMasterEdit && <small>Invoice amounts and payments stay unchanged.</small>}<div><button type="button" className="cis-secondary" disabled={busy} onClick={onClose}>Close</button><button disabled={busy} type="submit" className="cis-save"><Check size={18} aria-hidden="true"/>{busy?'Saving...':'Save delivery request'}</button></div></footer>
    </form>
  </div>;
}
