import {describe,it,expect} from 'vitest';
import {assessInvoiceCharges,chargeDate} from './invoiceCharges';
const invoice={id:'i',totalSales:100,lateChargePolicy:{version:1 as const,firstChargeDate:'2026-01-31',nextIndex:0}};
describe('invoice late charges',()=>{
 it('starts after 30 days then compounds every 15 days in whole rupees',()=>{
  expect(chargeDate('2026-01-01',30)).toBe('2026-01-31');
  expect(assessInvoiceCharges(invoice,[],'2026-01-30','now').added).toBe(0);
  const result=assessInvoiceCharges(invoice,[],'2026-03-02','now');
  expect(result.events.map(e=>[e.rateBasisPoints,e.baseAmount,e.amount])).toEqual([[200,100,2],[100,102,1],[100,103,1]]);
 });
 it('charges only what remains after partial payments',()=>{
  const result=assessInvoiceCharges({...invoice,totalSales:1000},[{invoiceId:'i',date:'2026-01-20',amount:500},{invoiceId:'i',date:'2026-02-10',amount:300}],'2026-02-15','now');
  expect(result.events.map(e=>[e.baseAmount,e.amount])).toEqual([[500,10],[210,2]]);
 });
 it('stops when fully settled and never duplicates previously assessed periods',()=>{
  expect(assessInvoiceCharges(invoice,[{invoiceId:'i',date:'2026-01-20',amount:100}],'2026-03-01','now').events).toEqual([]);
  const first=assessInvoiceCharges(invoice,[],'2026-01-31','now');
  const again=assessInvoiceCharges({...invoice,lateChargeEvents:first.events,lateChargesTotal:2,lateChargePolicy:{...invoice.lateChargePolicy,nextIndex:first.nextIndex}},[],'2026-01-31','later');
  expect(again.added).toBe(0);expect(again.events).toEqual([]);
 });
 it('does not recompute a posted charge after a backdated payment',()=>{
  const first=assessInvoiceCharges(invoice,[],'2026-01-31','now');
  const result=assessInvoiceCharges({...invoice,lateChargeEvents:first.events,lateChargesTotal:2,lateChargePolicy:{...invoice.lateChargePolicy,nextIndex:1}},[{invoiceId:'i',date:'2026-01-20',amount:50}],'2026-02-15','later');
  expect(result.events[0].baseAmount).toBe(52);expect(first.events[0].amount).toBe(2);
 });
 it('rounds once to whole rupees, without double rounding at half-rupee boundaries',()=>{
  const result=assessInvoiceCharges({...invoice,totalSales:24.75},[],'2026-01-31','now');
  expect(result.events[0].amount).toBe(0);
  expect(assessInvoiceCharges({...invoice,totalSales:25},[],'2026-01-31','now').added).toBe(1);
 });
 it('uses November payments for December 1 then compounds the unpaid balance on December 16',()=>{
  const opening={id:'opening',totalSales:1000,lateChargePolicy:{version:1 as const,firstChargeDate:'2026-12-01',nextIndex:0,paymentCutoff:'before_date' as const,openingBalanceIncluded:true}};
  const payments=[{invoiceId:'opening',date:'2026-11-30',amount:500},{invoiceId:'opening',date:'2026-12-10',amount:200}];
  expect(assessInvoiceCharges(opening,payments,'2026-11-30','now').events).toEqual([]);
  const result=assessInvoiceCharges(opening,payments,'2026-12-16','now');
  expect(result.events.map(e=>[e.date,e.baseAmount,e.amount])).toEqual([['2026-12-01',500,10],['2026-12-16',310,3]]);
 });
 it('cleared November debt has no charges, while December 1 payment follows the opening assessment',()=>{
  const i={...invoice,lateChargePolicy:{...invoice.lateChargePolicy,firstChargeDate:'2026-12-01',paymentCutoff:'before_date' as const}};
  expect(assessInvoiceCharges(i,[{invoiceId:'i',date:'2026-11-30',amount:100}],'2026-12-16','now').events).toEqual([]);
  const result=assessInvoiceCharges(i,[{invoiceId:'i',date:'2026-12-01',amount:102}],'2026-12-16','now');
  expect(result.events.map(e=>e.amount)).toEqual([2]);expect(result.nextDate).toBe(null);
 });
});
