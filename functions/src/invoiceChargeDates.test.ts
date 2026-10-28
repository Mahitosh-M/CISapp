import test from 'node:test';
import assert from 'node:assert/strict';
import {firstInvoiceChargeDate} from './invoiceLateCharges';

test('December grace cutoff preserves a full 30 days for every ordinary invoice',()=>{
 const policy={enabled:true,scope:'existing_from_start' as const,effectiveDate:'2026-12-01',includeOpeningBalances:true,revision:1};
 const date=(date:string)=>firstInvoiceChargeDate({invoiceNumber:'INV',date},policy);
 assert.equal(date('2026-09-01'),'2026-12-01');
 assert.equal(date('2026-11-01'),'2026-12-01');
 assert.equal(date('2026-11-20'),'2026-12-20');
 assert.equal(date('2026-12-01'),'2026-12-31');
 assert.equal(date('2027-01-01'),'2027-01-31');
 assert.equal(firstInvoiceChargeDate({invoiceNumber:'0000-OPENING-c',date:'2026-11-20',isOpeningBalance:true},policy),'2026-12-01');
});
