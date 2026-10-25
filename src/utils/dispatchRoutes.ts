export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export interface RouteStop { id: string; name: string; }
export interface WeeklyRoute {
 id: string; name: string; from: string; to: string; shopIds: string[];
 stops: RouteStop[]; days: number[]; active: boolean; revision: number;
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
 return {id:r.id,name:r.name.trim(),from:r.from.trim(),to:r.to.trim(),shopIds:[...new Set(r.shopIds)],stops:r.stops.map(s=>({id:s.id,name:s.name.trim()})),days:[...new Set(r.days)].sort((a,b)=>a-b),active:r.active!==false,revision:r.revision};
}
