import type { AppSettings, Invoice, Payment } from '../types';
import { getBusinessInvoices } from './openingBalance';
import { getAmountAppliedToInvoice, getPendingAmount } from './paymentUtils';
import { getEffectiveInvoiceDueDate } from './settings';
import { filterRecordsForShopScope, type AnalyticsShopScope } from './shops';

export const CAPITAL_RATE = 0.24;
export type CapitalRow = { customerId:string; customerName:string; outstanding:number; overdue:number; capitalCost:number; profit:number; days:number; overdueDays:number; overdueInvoices:number };
const days=(a:string,b:string)=>Math.max(0,Math.floor((new Date(`${b}T00:00:00`).getTime()-new Date(`${a}T00:00:00`).getTime())/86400000));
export const buildCreditCapitalImpact=(invoices:Invoice[], payments:Payment[], from:string, to:string, settings:AppSettings, scope:AnalyticsShopScope)=>{
 const rows=new Map<string,CapitalRow>(); let receivables=0, overdue=0, capitalCost=0, profit=0, weightedDays=0;
 filterRecordsForShopScope(getBusinessInvoices(invoices).filter(i=>i.date<=to),scope).forEach(invoice=>{
  const due=getEffectiveInvoiceDueDate(invoice.date,invoice.savedDueDate||invoice.dueDate,invoice.tierAtInvoice||'Tier 4',settings);
  const parts=payments.filter(p=>p.invoiceId===invoice.id&&p.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  let balance=invoice.totalSales, cost=0, cursor=invoice.date;
  parts.forEach(p=>{ const end=p.date<from?from:p.date; if(end>cursor) cost+=balance*CAPITAL_RATE*days(cursor,end)/365; balance=getPendingAmount(balance,getAmountAppliedToInvoice(p)+Math.max(0,p.cashDiscount||0)); cursor=p.date; });
  const start=cursor<from?from:cursor; if(to>start) cost+=balance*CAPITAL_RATE*days(start,to)/365;
  const isOverdue=due<to; const row=rows.get(invoice.customerId)||{customerId:invoice.customerId,customerName:invoice.customerName,outstanding:0,overdue:0,capitalCost:0,profit:0,days:0,overdueDays:0,overdueInvoices:0};
  if(invoice.date>=from){ row.profit+=Number(invoice.totalProfit)||0; profit+=Number(invoice.totalProfit)||0; }
  row.capitalCost+=cost; capitalCost+=cost; row.outstanding+=balance; receivables+=balance;
  if(balance>0){ row.days=Math.max(row.days,days(invoice.date,to)); weightedDays+=balance*days(invoice.date,to); if(isOverdue){row.overdue+=balance;row.overdueDays=Math.max(row.overdueDays,days(due,to));row.overdueInvoices++;overdue+=balance;} }
  rows.set(invoice.customerId,row);
 });
 return {receivables,overdue,capitalCost,profit,averageDays:receivables?weightedDays/receivables:0,rows:[...rows.values()].filter(r=>r.outstanding>0||r.profit!==0).sort((a,b)=>{ const aImpact=a.profit>0?a.capitalCost/a.profit:undefined; const bImpact=b.profit>0?b.capitalCost/b.profit:undefined; if(aImpact!==undefined&&bImpact!==undefined) return bImpact-aImpact||b.capitalCost-a.capitalCost; if(aImpact!==undefined) return -1; if(bImpact!==undefined) return 1; return b.capitalCost-a.capitalCost; })};
};

