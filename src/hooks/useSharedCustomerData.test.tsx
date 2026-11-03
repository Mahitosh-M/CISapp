// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import type {Customer,Invoice,Payment} from '../types';
const source=vi.hoisted(()=>({customers:[] as Customer[],invoices:[] as Invoice[],payments:[] as Payment[],getCustomers:vi.fn(),getInvoices:vi.fn(),getPayments:vi.fn()}));
vi.mock('../services/firestoreService',()=>({getCustomers:source.getCustomers,getInvoices:source.getInvoices,getPayments:source.getPayments}));
import {SharedCustomerModeContext} from '../contexts/SharedCustomerModeContext';
import {useSharedCustomerData} from './useSharedCustomerData';
import type {SharedCustomerMode} from '../utils/sharedCustomerMode';
const wrapper=(mode:SharedCustomerMode)=>({children}:{children:React.ReactNode})=><SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>{},leaveMedical:()=>false}}>{children}</SharedCustomerModeContext.Provider>;
beforeEach(()=>{
 source.customers=[{id:'normal',customerType:'customer'},{id:'med',customerType:'medical'},{id:'legacy'}] as Customer[];
 source.invoices=Array.from({length:30},(_,index)=>({id:'i'+index,customerId:index===28?'med':'normal'})) as Invoice[];
 source.payments=[{id:'p-normal',customerId:'normal'},{id:'p-med',customerId:'med'},{id:'p-orphan',customerId:'missing'},{id:'p-legacy',customerId:'legacy'}] as Payment[];
 source.getCustomers.mockReset().mockImplementation(async()=>source.customers);
 source.getInvoices.mockReset().mockImplementation(async(options)=>source.invoices.slice(0,options?.limitCount));
 source.getPayments.mockReset().mockImplementation(async(options)=>source.payments.slice(0,options?.limitCount));
});
it('finds Medical records beyond a page of regular records, with type filtering before page limits',async()=>{
 const {result}=renderHook(useSharedCustomerData,{wrapper:wrapper('medical')});
 expect((await result.current.getCustomers({limitCount:1})).map(customer=>customer.id)).toEqual(['med']);
 expect((await result.current.getInvoices({limitCount:1,sortBy:'invoiceNumber'})).map(invoice=>invoice.id)).toEqual(['i28']);
 expect(source.getInvoices.mock.calls.length).toBeGreaterThan(1);
 expect((await result.current.getPayments()).map(payment=>payment.id)).toEqual(['p-med']);
});
it('keeps legacy untyped customers in Customers mode, excludes Medical and orphan records',async()=>{
 const {result}=renderHook(useSharedCustomerData,{wrapper:wrapper('customer')});
 expect((await result.current.getCustomers()).map(customer=>customer.id)).toEqual(['normal','legacy']);
 expect((await result.current.getPayments()).map(payment=>payment.id)).toEqual(['p-normal','p-legacy']);
});
it('does not query transactions when this mode has no customers',async()=>{
 source.customers=source.customers.filter(customer=>customer.customerType!=='medical');const {result}=renderHook(useSharedCustomerData,{wrapper:wrapper('medical')});expect(await result.current.getInvoices()).toEqual([]);expect(await result.current.getPayments()).toEqual([]);expect(source.getInvoices).not.toHaveBeenCalled();expect(source.getPayments).not.toHaveBeenCalled();
});
it('preserves unscoped behavior outside the shared Staff/Admin layout',async()=>{
 const {result}=renderHook(useSharedCustomerData);expect(await result.current.getCustomers()).toEqual(source.customers);expect(await result.current.getPayments()).toEqual(source.payments);
});
