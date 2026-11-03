import {coordinates,validPoint,type GeoPoint} from './route-geo';
export interface SavedPlace extends GeoPoint {id:string;name:string;}
export interface RoadRoute {kilometres:number;minutes:number;geometry:GeoPoint[];provider:string;expiresAt:string;}
export interface MapProvider {
 readonly name:string;
 readonly capabilities:{externalSearch:boolean;roadRouting:boolean;roadOptimisation:boolean};
 tiles:{url:string;attribution:string};
 searchSaved(query:string,places:SavedPlace[]):SavedPlace[];
 geocode(query:string):Promise<GeoPoint|null>;
 roadRoute(points:GeoPoint[]):Promise<RoadRoute|null>;
 optimise(points:GeoPoint[],locked:number[]):Promise<number[]|null>;
}
/** Online tiles and saved coordinates only. No paid APIs or road-service calls. */
export const mapProvider:MapProvider={
 name:'OpenStreetMap / saved locations',capabilities:{externalSearch:false,roadRouting:false,roadOptimisation:false},
 tiles:{url:import.meta.env.VITE_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:import.meta.env.VITE_MAP_TILE_ATTRIBUTION||'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'},
 searchSaved(query,places){const point=coordinates(query);if(point)return[{...point,id:'coordinates',name:query}];const text=query.trim().toLowerCase();return text?places.filter(p=>validPoint(p)&&p.name.toLowerCase().includes(text)):[];},
 geocode:async()=>null,roadRoute:async()=>null,optimise:async()=>null,
};
