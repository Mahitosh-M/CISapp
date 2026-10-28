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
});
