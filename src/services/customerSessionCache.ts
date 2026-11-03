const PREFIX='cisapp:customer-session:';
const pending=new Map<string,Promise<unknown>>();
let generation=0;
const storage=()=>{try{return typeof window==='undefined'?undefined:window.sessionStorage;}catch{return undefined;}};
/** Deduplicate both concurrent loads and completed reads until this sign-in session ends. */
export function readCustomerSessionResource<T>(key:string,loader:()=>Promise<T>):Promise<T>{
 const existing=pending.get(key);if(existing)return existing as Promise<T>;
 const store=storage();
 try{const saved=store?.getItem(PREFIX+key);if(saved!==null&&saved!==undefined){const result=Promise.resolve(JSON.parse(saved) as T);pending.set(key,result);return result;}}catch{try{store?.removeItem(PREFIX+key);}catch{/* In-memory caching remains available. */}}
 const version=generation;
 const request=Promise.resolve().then(()=>{if(generation!==version)throw new Error('Customer session ended.');return loader();}).then(value=>{if(generation===version){try{if(value!==undefined)store?.setItem(PREFIX+key,JSON.stringify(value));}catch{/* Storage limits do not repeat a successful in-memory load. */}}return value;}).catch(error=>{if(pending.get(key)===request)pending.delete(key);throw error;});
 pending.set(key,request);return request;
}
export function clearCustomerSessionCache(){
 generation++;pending.clear();const store=storage();try{if(store)for(let i=store.length-1;i>=0;i--){const key=store.key(i);if(key?.startsWith(PREFIX))store.removeItem(key);}}catch{/* Sign-out still revokes access. */}
}
