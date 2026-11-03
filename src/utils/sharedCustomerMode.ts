import type {Customer} from '../types';
export type SharedCustomerMode = 'customer' | 'medical';
export const SHARED_CUSTOMER_MODE_PREFIX = 'cisapp:shared-customer-mode:';
export const matchesCustomerMode = (customer: Pick<Customer,'customerType'>, mode: SharedCustomerMode) =>
  (customer.customerType === 'medical' ? 'medical' : 'customer') === mode;
export function filterModeRecords<T extends {customerId:string}>(records:T[], customers:Customer[], mode:SharedCustomerMode){
  const ids=new Set(customers.filter(customer=>matchesCustomerMode(customer,mode)).map(customer=>customer.id));
  return records.filter(record=>ids.has(record.customerId));
}
// Filter before applying the visible page size, so another mode cannot hide this mode's older rows.
export async function readModePage<T>(read:(limit?:number)=>Promise<T[]>, include:(row:T)=>boolean, limit?:number):Promise<T[]>{
  if(!limit)return (await read()).filter(include);
  let readLimit=limit;
  for(;;){
    const rows=await read(readLimit), visible=rows.filter(include);
    if(visible.length>=limit||rows.length<readLimit)return visible.slice(0,limit);
    readLimit=Math.max(readLimit+25,readLimit*2);
  }
}
export function clearSharedCustomerModes(){
  try{for(let index=sessionStorage.length-1;index>=0;index--){const key=sessionStorage.key(index);if(key?.startsWith(SHARED_CUSTOMER_MODE_PREFIX))sessionStorage.removeItem(key);}}catch{/* Browsing still works without session storage. */}
}
