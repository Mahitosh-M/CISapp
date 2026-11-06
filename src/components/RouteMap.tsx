import {mapProvider} from '../utils/map-provider';
import {useEffect,useRef,useState} from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {validPoint,type GeoPoint} from '../utils/route-geo';
export interface MapPoint extends GeoPoint {id:string;name:string;}
export function RouteMap({points,colour='#2878dd',selected,onSelect,position,showExplanations=true}:{showExplanations?:boolean;points:MapPoint[];colour?:string;selected?:string;onSelect?:(point:GeoPoint,id?:string)=>void;position?:GeoPoint|null}){
 const element=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),gps=useRef<L.CircleMarker|null>(null),callback=useRef(onSelect);
 const [tilesFailed,setTilesFailed]=useState(false);callback.current=onSelect;
 useEffect(()=>{if(!element.current)return;const m=L.map(element.current,{scrollWheelZoom:false}).setView([15.96,76.66],10);map.current=m;layer.current=L.layerGroup().addTo(m);
  if(navigator.onLine){const url=mapProvider.tiles.url;if(url.startsWith('https://'))L.tileLayer(url,{maxZoom:19,attribution:mapProvider.tiles.attribution}).on('tileerror',()=>setTilesFailed(true)).addTo(m);}
  m.on('click',e=>callback.current?.({lat:e.latlng.lat,lng:e.latlng.lng}));const resize=new ResizeObserver(()=>m.invalidateSize());resize.observe(element.current);return()=>{resize.disconnect();m.remove();map.current=null;};
 },[]);
 useEffect(()=>{if(!map.current||!layer.current)return;const m=map.current,l=layer.current;l.clearLayers();const valid=points.filter(validPoint);for(const [index,p]of valid.entries()){
  const marker=L.marker([p.lat,p.lng],{draggable:!!onSelect,icon:L.divIcon({className:'route-map-pin',html:`<span style="background:${/^#[0-9a-f]{6}$/i.test(colour)?colour:'#2878dd'}">${index+1}</span>`,iconSize:[30,30],iconAnchor:[15,30]})}).addTo(l);
  const label=document.createElement('span');label.textContent=p.name;marker.bindTooltip(label);marker.on('click',e=>{L.DomEvent.stopPropagation(e);callback.current?.(p,p.id);});marker.on('dragend',()=>{const v=marker.getLatLng();callback.current?.({lat:v.lat,lng:v.lng},p.id);});if(p.id===selected)marker.setZIndexOffset(1000);
 }if(valid.length>1)L.polyline(valid.map(p=>[p.lat,p.lng] as L.LatLngTuple),{color:colour,weight:3,dashArray:'7 7'}).addTo(l);if(valid.length)m.fitBounds(L.latLngBounds(valid.map(p=>[p.lat,p.lng] as L.LatLngTuple)),{padding:[30,30],maxZoom:15});
 },[JSON.stringify(points),colour,selected,!!onSelect]);
 useEffect(()=>{if(!map.current)return;if(gps.current){gps.current.remove();gps.current=null;}if(position&&validPoint(position))gps.current=L.circleMarker([position.lat,position.lng],{radius:9,color:'#fff',weight:3,fillColor:'#087bea',fillOpacity:1}).addTo(map.current);},[position?.lat,position?.lng]);
 return <section className="route-map-shell"><div ref={element} className="route-map" aria-label="Route location map"/>{(!navigator.onLine||tilesFailed)&&<p role="status">Road map unavailable. Saved pins and itinerary remain available.</p>}<small>{showExplanations?<>Dashed lines join saved coordinates; they are not road directions.{onSelect?' Select a stop, then click the map or drag its marker.':''}</>:'Direct-distance links'}</small></section>;
}
