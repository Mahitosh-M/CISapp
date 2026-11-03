import type {Invoice,Payment} from '../types';
import {buildCustomerLedger} from './customerLedger';
import {isOpeningBalanceInvoice} from './openingBalance';
export const getLedgerBusinessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function getMedicalLedgerMonths(asOf=getLedgerBusinessDate()){
 const [year,month]=asOf.split('-').map(Number);
 return Array.from({length:4},(_,index)=>{
  const date=new Date(Date.UTC(year,month-1-index,1,12));
  return {id:date.toISOString().slice(0,7),label:new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',month:'long',year:'numeric'}).format(date)};
 });
}
export function buildMedicalLedger(invoices:Invoice[],payments:Payment[],outstanding:number,month=getLedgerBusinessDate().slice(0,7),asOf=getLedgerBusinessDate()){
 // Compute running balances across the full history before selecting a month.
 // An older month's closing balance must not be replaced by today's total.
 const history=buildCustomerLedger(invoices.filter(invoice=>invoice.date<=asOf),payments.filter(payment=>payment.date<=asOf),{endingBalance:outstanding});
 const rows=history.filter(row=>row.date.slice(0,7)===month);
 const priorRows=history.filter(row=>row.date.slice(0,7)<month);
 const first=history[0];
 const broughtForward=first?first.runningBalance-first.invoiceAmount+first.paymentAmount:outstanding;
 // Reuse the exact previous month-end balance, including across empty months.
 const openingBalance=priorRows[priorRows.length-1]?.runningBalance??broughtForward;
 return {month,rows,openingBalance,closingBalance:rows[rows.length-1]?.runningBalance??openingBalance,invoiceCount:rows.filter(row=>row.kind==='invoice'&&!row.charge&&row.invoice&&!isOpeningBalanceInvoice(row.invoice)).length,paymentCount:rows.filter(row=>row.kind==='payment'&&row.payment?.paymentKind!=='advance_application').length};
}
