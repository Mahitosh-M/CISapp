import {it,expect} from 'vitest';
import type {Invoice,Payment} from '../types';
import {buildMedicalLedger,getMedicalLedgerMonths} from './medicalLedger';
const invoice=(id:string,date:string,amount=1000):Invoice=>({id,invoiceNumber:id,customerId:'med',customerName:'Medical',date,dueDate:date,totalSales:amount,salesAmount:amount,costAmount:700,totalCost:700,totalProfit:300,transportAmount:0,notes:'',createdAt:date});
const payment=(id:string,date:string,amount:number):Payment=>({id,invoiceId:'i',invoiceNumber:'i',customerId:'med',customerName:'Medical',date,amount,amountAppliedToInvoice:amount,advanceCreatedAmount:0,advanceAppliedAmount:0,amountUsedForOldBalance:0,oldBalanceBeforePayment:0,oldBalanceAfterPayment:0,cashDiscount:0,mode:'Cash',notes:'',createdAt:date});
it('offers four calendar months across a year boundary',()=>{expect(getMedicalLedgerMonths('2026-01-03').map(month=>[month.id,month.label])).toEqual([['2026-01','January 2026'],['2025-12','December 2025'],['2025-11','November 2025'],['2025-10','October 2025']]);});
it('shows every invoice and payment in chronological order with a running balance and counts',()=>{
 const invoices=[invoice('old','2026-10-20'),invoice('i','2026-11-01'),invoice('i2','2026-11-03')];
 const payments=[payment('p1','2026-11-02',400),payment('p2','2026-11-04',100),payment('p3','2026-11-05',100),payment('p4','2026-11-06',100)];
 const result=buildMedicalLedger(invoices,payments,2300,'2026-11','2026-11-15');
 expect(result.rows.map(row=>[row.id,row.runningBalance])).toEqual([['invoice:i',2000],['payment:p1',1600],['invoice:i2',2600],['payment:p2',2500],['payment:p3',2400],['payment:p4',2300]]);
 expect(result).toMatchObject({openingBalance:1000,closingBalance:2300,invoiceCount:2,paymentCount:4});
});
it('uses historical month balances instead of reusing the present outstanding for each month',()=>{
 const invoices=[invoice('sept','2026-09-01'),invoice('oct','2026-10-01'),invoice('nov','2026-11-01')],payments=[payment('oct-p','2026-10-02',300),payment('nov-p','2026-11-02',200)];
 const october=buildMedicalLedger(invoices,payments,2500,'2026-10','2026-11-15');expect(october.rows.map(row=>row.runningBalance)).toEqual([2000,1700]);expect(october).toMatchObject({openingBalance:1000,closingBalance:1700});
 const august=buildMedicalLedger(invoices,payments,2500,'2026-08','2026-11-15');expect(august).toMatchObject({rows:[],openingBalance:0,closingBalance:0});
 const december=buildMedicalLedger(invoices,payments,2500,'2026-12','2026-11-15');expect(december).toMatchObject({rows:[],openingBalance:2500,closingBalance:2500});
});
it('groups split receipts once and retains discounts and existing charges in balance arithmetic',()=>{
 const i={...invoice('i','2026-11-01'),lateChargeEvents:[{id:'old-charge',date:'2026-11-02',amount:20,index:0,rateBasisPoints:200,baseAmount:1000,roundingPaise:0,createdAt:'2026-11-02'}]};
 const parts=[{...payment('p1','2026-11-03',200),cashDiscount:20,splitPaymentGroupId:'group',splitPaymentPart:1,splitPaymentCount:2},{...payment('p2','2026-11-03',300),splitPaymentGroupId:'group',splitPaymentPart:2,splitPaymentCount:2}];
 const result=buildMedicalLedger([i],parts,500,'2026-11','2026-11-15');expect(result.rows.map(row=>row.runningBalance)).toEqual([1000,1020,500]);expect(result).toMatchObject({invoiceCount:1,paymentCount:1});expect(result.rows[2]).toMatchObject({paymentReceived:500,paymentAmount:520});
});

it('carries every month closing into the next opening, including an empty month',()=>{
 const invoices=[invoice('july','2026-07-01',500),invoice('aug','2026-08-01',1000),invoice('oct','2026-10-01',800),invoice('nov','2026-11-01',300)];
 const payments=[payment('aug-p','2026-08-02',200),payment('oct-p','2026-10-02',100),payment('nov-p','2026-11-02',50)];
 const months=['2026-08','2026-09','2026-10','2026-11'].map(month=>buildMedicalLedger(invoices,payments,2250,month,'2026-11-15'));
 expect(months.map(month=>[month.openingBalance,month.closingBalance])).toEqual([[500,1300],[1300,1300],[1300,2000],[2000,2250]]);
 for(let index=1;index<months.length;index++)expect(months[index].openingBalance).toBe(months[index-1].closingBalance);
 expect(months[1].rows).toEqual([]);
});
