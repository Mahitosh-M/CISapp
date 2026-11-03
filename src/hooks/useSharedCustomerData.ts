import {useMemo} from 'react';
import {useSharedCustomerMode} from '../contexts/SharedCustomerModeContext';
import {getCustomers,getInvoices,getPayments} from '../services/firestoreService';
import {matchesCustomerMode,readModePage} from '../utils/sharedCustomerMode';
export function useSharedCustomerData(){
 const context=useSharedCustomerMode();
 const mode=context?.mode;
 return useMemo(()=>{
  const customers:typeof getCustomers=async(options)=>{
   if(!mode)return getCustomers(options);
   const {limitCount,...sort}=options??{};
   const rows=(await getCustomers(sort)).filter(customer=>matchesCustomerMode(customer,mode));
   return limitCount?rows.slice(0,limitCount):rows;
  };
  const invoices:typeof getInvoices=async(options)=>{
   if(!mode)return getInvoices(options);
   const ids=new Set((await customers()).map(customer=>customer.id));
   if(!ids.size)return [];
   return readModePage(limitCount=>getInvoices({...options,limitCount}),row=>ids.has(row.customerId),options?.limitCount);
  };
  const payments:typeof getPayments=async(options)=>{
   if(!mode)return getPayments(options);
   const ids=new Set((await customers()).map(customer=>customer.id));
   if(!ids.size)return [];
   return readModePage(limitCount=>getPayments({...options,limitCount}),row=>ids.has(row.customerId),options?.limitCount);
  };
  return {mode,getCustomers:customers,getInvoices:invoices,getPayments:payments};
 },[mode]);
}
