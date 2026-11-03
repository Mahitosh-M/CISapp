export interface GeoPoint {lat:number;lng:number;}
export interface DeliveryLocation extends GeoPoint {confirmed:boolean;address?:string;placeId?:string;contactName?:string;phone?:string;alternate?:string;instructions?:string;reminderMinutes?:number;alertsEnabled?:boolean;timeWindow?:{from:string;to:string};}
export function deliveryLocation(value:unknown):DeliveryLocation|null {
 if(value===null||value===undefined)return null;const v=value as DeliveryLocation;if(!validPoint(v))throw new Error('Delivery location needs valid latitude and longitude');
 const result:DeliveryLocation={lat:v.lat,lng:v.lng,confirmed:v.confirmed===true,reminderMinutes:v.reminderMinutes??10,alertsEnabled:v.alertsEnabled!==false};
 if(!Number.isInteger(result.reminderMinutes)||result.reminderMinutes!<1||result.reminderMinutes!>120)throw new Error('Reminder must be 1–120 minutes');
 for(const key of ['address','placeId','contactName','phone','alternate','instructions'] as const)if(v[key]!==undefined){if(typeof v[key]!=='string'||v[key]!.length>1500)throw new Error('Invalid delivery location detail');result[key]=v[key]!.trim();}
 if(v.timeWindow){const time=/^([01]\d|2[0-3]):[0-5]\d$/;if(!time.test(v.timeWindow.from)||!time.test(v.timeWindow.to)||v.timeWindow.from>=v.timeWindow.to)throw new Error('Delivery window must start before it ends');result.timeWindow={from:v.timeWindow.from,to:v.timeWindow.to};}
 return result;
}
export function validPoint(value:unknown):value is GeoPoint {const p=value as GeoPoint;return !!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;}
export function coordinates(value:string):GeoPoint|null {const parts=value.trim().split(/\s*,\s*/);if(parts.length!==2||parts.some(p=>p===''||!/^-?\d+(\.\d+)?$/.test(p)))return null;const p={lat:Number(parts[0]),lng:Number(parts[1])};return validPoint(p)?p:null;}
export function geographicKm(a:GeoPoint,b:GeoPoint){const rad=(n:number)=>n*Math.PI/180,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng);return 6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2)));}
export function geographicRouteKm(points:GeoPoint[]){return points.slice(1).reduce((n,p,i)=>n+geographicKm(points[i],p),0);}
export function distanceToCorridorKm(point:GeoPoint,path:GeoPoint[]){if(!path.length)return null;if(path.length===1)return geographicKm(point,path[0]);const scale=Math.cos(point.lat*Math.PI/180);const xy=(p:GeoPoint)=>[(p.lng-point.lng)*scale,p.lat-point.lat];let min=Infinity;for(let i=1;i<path.length;i++){const a=xy(path[i-1]),b=xy(path[i]),dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));min=Math.min(min,Math.hypot(a[0]+t*dx,a[1]+t*dy)*111.195);}return min;}
export interface ImportedWaypoint {name:string;point:GeoPoint|null;issue?:string;}
export interface RouteImport {waypoints:ImportedWaypoint[];warnings:string[];}
/** Pure parser. Never fetches URLs, follows redirects or invents road geometry. */
export function importGoogleRoute(raw:string):RouteImport {
 if(raw.length>12000)throw new Error('Link is too long');let url:URL;try{url=new URL(raw);}catch{throw new Error('Paste a valid Google Maps HTTPS link');}
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Only public Google Maps HTTPS links are accepted');
 const host=url.hostname.toLowerCase();
 if(['maps.app.goo.gl','goo.gl'].includes(host)){if(host==='goo.gl'&&!url.pathname.startsWith('/maps/'))throw new Error('Unsupported shortened link');return{waypoints:[],warnings:['Shortened links need expansion in your browser. Paste the full Google Maps directions URL; no server fetch was performed.']};}
 if(!['google.com','www.google.com','maps.google.com','google.co.in','www.google.co.in','maps.google.co.in'].includes(host)||(!url.pathname.startsWith('/maps')&&host!=='maps.google.com'&&host!=='maps.google.co.in'))throw new Error('Only supported Google Maps hosts and paths are accepted');
 let names:string[]=[];
 if(url.searchParams.has('origin')||url.searchParams.has('destination'))names=[url.searchParams.get('origin')??'',...(url.searchParams.get('waypoints')?.split('|')??[]),url.searchParams.get('destination')??''];
 else if(url.pathname.startsWith('/maps/dir/'))names=url.pathname.slice(10).split('/').filter(s=>s&&!s.startsWith('@')&&!s.startsWith('data=')).map(s=>decodeURIComponent(s).replace(/\+/g,' '));
 else {const q=url.searchParams.get('q')??url.searchParams.get('query');if(q)names=[q];}
 if(names.length>100)throw new Error('Maximum 100 imported waypoints');
 const waypoints=names.map((name,index)=>{const point=coordinates(name);return{name:name||`Unresolved stop ${index+1}`,point,...(!point?{issue:'Select or confirm coordinates manually; place search is not configured.'}:{})};});
 return{waypoints,warnings:[...(waypoints.some(p=>!p.point)?['Named places require manual confirmation.']:[]),...(!waypoints.length?['This link does not contain a reliable ordered waypoint list. Add stops manually.']:[]),'Imported locations are not a verified road route. Review the sequence before saving.']};
}
export function navigationUrl(point:GeoPoint){if(!validPoint(point))throw new Error('Confirmed destination required');return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;}
export const CONFIRMED_SHOPS={SHOP_A:{lat:15.960642922039911,lng:76.65706093667703},SHOP_S:{lat:15.755500311128852,lng:76.75371810583702}} as const;
