import type {AppState,Trip,Stop} from './domain';
import type {WeeklyRoute,WaypointKind} from './weekly-routes';
import {CONFIRMED_SHOPS,validPoint,geographicKm,distanceToCorridorKm,type GeoPoint,type DeliveryLocation} from './route-geo';
export interface ItineraryPoint extends GeoPoint {id:string;name:string;kind:WaypointKind|'Delivery'|'Collection'|'Sales visit';stopIds:string[];customerId?:string;location?:DeliveryLocation;instructions?:string;durationMinutes:number;}
export interface TripRouteSnapshot {template:WeeklyRoute|null;points:ItineraryPoint[];capturedAt:string;revision:number;}
export function plannedArrival(snapshot:TripRouteSnapshot){
 const route=snapshot.template;if(route?.referenceMinutes===undefined||!route.departure)return null;
 const [hours,minutes]=route.departure.split(':').map(Number),total=hours*60+minutes+route.referenceMinutes+snapshot.points.reduce((n,p)=>n+p.durationMinutes,0);
 return `${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(Math.floor(total%60)).padStart(2,'0')}${total>=1440?' +'+Math.floor(total/1440)+' day':''}`;
}
export interface ArrivalReminder {id:string;tripId:string;pointId:string;revision:number;customerId:string;stopIds:string[];minutes:number;source:'Manual'|'Provider';status:'Raised'|'Acknowledged'|'Dismissed';at:string;actorId:string;}
export function stopLocation(s:AppState,stop:Stop){const job=stop.jobId?s.jobs.find(j=>j.id===stop.jobId):null;const customer=s.customers.find(c=>c.id===stop.customerId);const p=job?.location!==undefined?job.location:customer?.location;return p?.confirmed&&validPoint(p)?p:null;}
function routePoints(s:AppState,t:Trip,route?:WeeklyRoute|null):ItineraryPoint[]{
 if(route){if(route.stops.length<2||route.stops.some(p=>!validPoint(p)))throw new Error('At least two confirmed route waypoints are required before release');return route.stops.map(p=>({id:p.id,name:p.name,kind:p.kind??'Transit',lat:p.lat!,lng:p.lng!,stopIds:[],instructions:p.instructions,durationMinutes:p.durationMinutes??0}));}
 return [t.startShopId,t.endShopId].map((id,index)=>{const shop=s.shops.find(x=>x.id===id),p=shop&&validPoint(shop)?shop:CONFIRMED_SHOPS[id as keyof typeof CONFIRMED_SHOPS];if(!p)throw new Error('Confirm shop coordinates before release');return{id:`shop-${index}-${id}`,name:shop?.name??id,kind:'Shop',lat:p.lat,lng:p.lng,stopIds:[],durationMinutes:0};});
}
export function anchorForStop(s:AppState,stop:Stop,route:WeeklyRoute|undefined|null):number {
 if(!route)return 0;const job=stop.jobId?s.jobs.find(j=>j.id===stop.jobId):null;
 if(job?.routeStopId){const n=route.stops.findIndex(p=>p.id===job.routeStopId);if(n<0)throw new Error('Selected route waypoint changed; review the invoice route stop');return Math.min(n,route.stops.length-2);}
 const point=stopLocation(s,stop);if(!point)throw new Error('Confirm all customer delivery pins before release');
 let best=Infinity,index=0;for(let n=1;n<route.stops.length;n++){const a=route.stops[n-1],b=route.stops[n];if(!validPoint(a)||!validPoint(b))throw new Error('Route pin missing');const km=distanceToCorridorKm(point,[a,b])!;if(km<best){best=km;index=n-1;}}return index;
}
export function buildTripRoute(s:AppState,t:Trip,route:WeeklyRoute|null,capturedAt:string):TripRouteSnapshot {
 const fixed=routePoints(s,t,route),groups=new Map<number,ItineraryPoint[]>();let previous=-1;
 for(const stop of t.stops){const location=stopLocation(s,stop);if(!location)throw new Error('Confirm every customer pin in CISapp before releasing this trip');const anchor=anchorForStop(s,stop,route);if(anchor<previous)throw new Error('Customer order crosses mandatory waypoints. Review stop order or use the constrained suggestion.');previous=anchor;
  const customer=s.customers.find(c=>c.id===stop.customerId)!,job=s.jobs.find(j=>j.id===stop.jobId),pin={...location,address:job?.address||location.address,phone:job?.phone||location.phone,instructions:location.instructions||job?.instructions||customer.instructions};const bucket=groups.get(anchor)??[],key=`customer-${stop.customerId}`;let point=bucket[bucket.length-1];
  if(!point||point.customerId!==stop.customerId||point.lat!==location.lat||point.lng!==location.lng){point={id:key+'-'+stop.id,name:customer.name,kind:stop.kind,lat:location.lat,lng:location.lng,stopIds:[],customerId:customer.id,location:structuredClone(pin),instructions:pin.instructions,durationMinutes:route?.stopMinutes??10};bucket.push(point);}point.stopIds.push(stop.id);groups.set(anchor,bucket);
 }
 const points=fixed.flatMap((p,index)=>[p,...(groups.get(index)??[])]);
 return{template:route?structuredClone(route):null,points,capturedAt,revision:(t.routeSnapshot?.revision??0)+1};
}
/** Geographic heuristic only. Locked/time-window stops keep their positions within each anchor segment. */
export function suggestConstrainedStops(s:AppState,t:Trip,route?:WeeklyRoute|null):Stop[]{
 const keyed=t.stops.map((stop,index)=>({stop,index,anchor:anchorForStop(s,stop,route)})).sort((a,b)=>a.anchor-b.anchor||a.index-b.index),result:Stop[]=[];
 if(t.stops.some((stop,index)=>(stop.locked||!!stopLocation(s,stop)?.timeWindow)&&keyed[index]?.stop.id!==stop.id))throw new Error('Locked/time-window stops conflict with mandatory waypoint order. Review the route manually.');
 for(const anchor of [...new Set(keyed.map(x=>x.anchor))]){
  const segment=keyed.filter(x=>x.anchor===anchor).map(x=>x.stop),fixed=segment.map((stop,index)=>stop.locked||!!stopLocation(s,stop)?.timeWindow?index:-1).filter(index=>index>=0);
  const shop=s.shops.find(shop=>shop.id===t.startShopId);const origin=shop&&validPoint(shop)?shop:CONFIRMED_SHOPS[t.startShopId as keyof typeof CONFIRMED_SHOPS];if(!origin)throw new Error('Starting shop coordinates required');
  let current:GeoPoint=route?.stops[anchor]&&validPoint(route.stops[anchor])?route.stops[anchor] as GeoPoint:origin;
  let start=0;for(const boundary of [...fixed,segment.length]){const pending=segment.slice(start,boundary);while(pending.length){pending.sort((a,b)=>geographicKm(current,stopLocation(s,a)!)-geographicKm(current,stopLocation(s,b)!));const next=pending.shift()!;result.push(next);current=stopLocation(s,next)!;}if(boundary<segment.length){result.push(segment[boundary]);current=stopLocation(s,segment[boundary])!;}start=boundary+1;}
 }return result;
}
export function nextCustomerPoint(t:Trip){return t.routeSnapshot?.points.find(p=>!!p.customerId&&p.stopIds.some(id=>t.stops.some(st=>st.id===id&&!st.completed)));}
/** Fully delivered physical stops; failed/partial attempts are tracked separately. */
export function completedDeliveryStops(s:AppState,t:Trip){
 const groups=t.routeSnapshot?.points.filter(p=>p.customerId).map(p=>p.stopIds)??t.stops.map(st=>[st.id]);
 return groups.filter(ids=>{const deliveries=t.stops.filter(st=>ids.includes(st.id)&&st.kind==='Delivery');return deliveries.length>0&&deliveries.every(st=>st.completed&&s.jobs.find(j=>j.id===st.jobId)?.status==='Delivered');}).length;
}
export function nextItineraryPoint(t:Trip){return t.routeSnapshot?.points.find(p=>p.customerId?p.stopIds.some(id=>t.stops.some(st=>st.id===id&&!st.completed)):!t.visitedWaypoints?.includes(p.id));}
export function reminderCandidate(t:Trip,events:ArrivalReminder[],minutes:number,source:'Manual'|'Provider',at:string,actorId:string):ArrivalReminder|null {
 const point=nextCustomerPoint(t);if(t.status!=='Active'||!t.loaded||!point?.customerId||point.location?.alertsEnabled===false||!Number.isFinite(minutes)||minutes<0||minutes>(point.location?.reminderMinutes??10))return null;
 const revision=t.routeSnapshot!.revision,id=`${t.id}:${revision}:${point.id}:${actorId}`;if(events.some(e=>e.id===id))return null;
 return{id,tripId:t.id,pointId:point.id,revision,customerId:point.customerId,stopIds:point.stopIds,minutes,source,status:'Raised',at,actorId};
}
