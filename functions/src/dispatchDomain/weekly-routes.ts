export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
import {validPoint} from './route-geo';
export type WaypointKind='Shop'|'Transit'|'Customer'|'Loading'|'Unloading';
export interface RouteStop { id: string; name: string; lat?:number;lng?:number;address?:string;placeId?:string;kind?:WaypointKind;shopId?:string;customerId?:string;durationMinutes?:number;instructions?:string;locked?:boolean; }
export interface WeeklyRoute {
 id: string; name: string; from: string; to: string; shopIds: string[];
 stops: RouteStop[]; days: number[]; active: boolean; revision: number;
 code?:string;colour?:string;status?:'Draft'|'Active'|'Archived';startShopId?:string;endShopId?:string;
 referenceKm?:number;referenceMinutes?:number;referenceSource?:string;departure?:string;targetArrival?:string;stopMinutes?:number;notes?:string;
}
export function routeDays(route: Pick<WeeklyRoute, 'days'>): string {
 return [...route.days].sort((a,b)=>(a+6)%7-(b+6)%7).map(d=>WEEKDAYS[d]).join(', ') || 'No weekly day assigned';
}
export function nextRouteDate(days: number[], today: string): string | null {
 if (!days.length) return null;
 const d = new Date(today+'T00:00:00Z');
 if (!Number.isFinite(d.getTime())) return null;
 for(let i=0;i<7;i++){if(days.includes(d.getUTCDay()))return d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+1);}
 return null;
}
/** Shared server/client validation; persistence and permission checks live on the server. */
export function validateWeeklyRoute(value: unknown): WeeklyRoute {
 const r=value as WeeklyRoute;
 const fail=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
 const label=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 const id=(v:unknown)=>label(v,128)&&!(v as string).split('').some(c=>c==='/'||c.charCodeAt(0)===92||c.charCodeAt(0)<32);
 fail(r&&typeof r==='object','Route details required');
 fail(id(r.id),'Invalid route identifier');
 fail(label(r.name,100)&&label(r.from,150)&&label(r.to,150),'Route name, starting point and destination are required');
 fail(Array.isArray(r.shopIds)&&r.shopIds.length>0&&r.shopIds.every(s=>['SHOP_A','SHOP_S'].includes(s)),'Select authorised shops');
 fail(Array.isArray(r.days)&&r.days.every(d=>Number.isInteger(d)&&d>=0&&d<=6),'Invalid weekday');
 fail(Array.isArray(r.stops)&&r.stops.length<=500&&r.stops.every(s=>s&&id(s.id)&&label(s.name,150)),'Every stop needs a name (maximum 500 stops per route)');
 fail(new Set(r.stops.map(s=>s.id)).size===r.stops.length,'Duplicate stop identifier');
 fail(Number.isSafeInteger(r.revision)&&r.revision>=0,'Invalid route revision');
 const optional:Partial<WeeklyRoute>={};
 if(r.code!==undefined){fail(typeof r.code==='string'&&/^[A-Z0-9_-]{1,40}$/.test(r.code),'Route code must use uppercase letters, numbers, _ or -');optional.code=r.code;}
 if(r.colour!==undefined){fail(/^#[0-9a-f]{6}$/i.test(r.colour),'Invalid route colour');optional.colour=r.colour;}
 if(r.status!==undefined){fail(['Draft','Active','Archived'].includes(r.status),'Invalid route status');optional.status=r.status;}
 for(const key of ['startShopId','endShopId'] as const)if(r[key]!==undefined){fail(['SHOP_A','SHOP_S'].includes(r[key]!), 'Select a source shop');optional[key]=r[key];}
 for(const key of ['referenceKm','referenceMinutes','stopMinutes'] as const)if(r[key]!==undefined){fail(Number.isFinite(r[key])&&r[key]!>=0&&r[key]!<=100000,'Invalid route distance or duration');optional[key]=r[key];}
 for(const key of ['departure','targetArrival'] as const)if(r[key]!==undefined){fail(/^([01]\d|2[0-3]):[0-5]\d$/.test(r[key]!), 'Invalid route time');optional[key]=r[key];}
 for(const key of ['referenceSource','notes'] as const)if(r[key]!==undefined){fail(typeof r[key]==='string'&&r[key]!.length<=1500,'Route note too long');optional[key]=r[key];}
 const stops=r.stops.map(s=>{const stop:RouteStop={id:s.id,name:s.name.trim()};if(s.lat!==undefined||s.lng!==undefined){fail(validPoint(s),'Invalid waypoint coordinates');stop.lat=s.lat;stop.lng=s.lng;}for(const key of ['address','placeId','shopId','customerId','instructions'] as const)if(s[key]!==undefined){fail(typeof s[key]==='string'&&s[key]!.length<=1500,'Invalid stop detail');stop[key]=s[key];}if(s.kind!==undefined){fail(['Shop','Transit','Customer','Loading','Unloading'].includes(s.kind),'Invalid waypoint type');stop.kind=s.kind;}if(s.durationMinutes!==undefined){fail(Number.isFinite(s.durationMinutes)&&s.durationMinutes>=0&&s.durationMinutes<=1440,'Invalid stop duration');stop.durationMinutes=s.durationMinutes;}if(s.locked!==undefined)stop.locked=s.locked===true;return stop;});
 if(r.status==='Active'){fail(!!r.startShopId&&!!r.endShopId,'Active route requires shop endpoints');fail(stops.length>=2&&stops.every(validPoint),'Confirm every waypoint before activating');fail(stops[0].shopId===r.startShopId&&stops[stops.length-1].shopId===r.endShopId,'First and last waypoint must match route shops');}
 return {id:r.id,name:r.name.trim(),from:r.from.trim(),to:r.to.trim(),shopIds:[...new Set(r.shopIds)],stops,days:[...new Set(r.days)].sort((a,b)=>a-b),active:r.status?r.status==='Active':r.active!==false,revision:r.revision,...optional};
}
