import { getInvoicePaymentEffect } from './paymentUtils';

export interface InvoiceChargePolicy { version: 1; firstChargeDate: string; nextIndex: number; paymentCutoff?: 'before_date' | 'through_date'; openingBalanceIncluded?: boolean; }
export interface InvoiceChargeEvent { id: string; date: string; index: number; rateBasisPoints: number; baseAmount: number; amount: number; roundingPaise: number; createdAt: string; }
export interface ChargeInvoice { id: string; totalSales: number; lateChargesTotal?: number; lateChargePolicy?: InvoiceChargePolicy; lateChargeEvents?: InvoiceChargeEvent[]; }
export const invoiceReceivableAmount = (invoice: Pick<ChargeInvoice,'totalSales'|'lateChargesTotal'>) => invoice.totalSales + (invoice.lateChargesTotal ?? 0);
/** Historical views must not include charges assessed for later business dates. */
export const invoiceReceivableAt = (invoice: Pick<ChargeInvoice,'totalSales'|'lateChargeEvents'>, date: string, inclusive = true) => invoice.totalSales + (invoice.lateChargeEvents ?? []).filter(event=>inclusive ? event.date<=date : event.date<date).reduce((sum,event)=>sum+event.amount,0);
export const chargeDate = (date: string, days: number) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date) throw new Error('Invalid charge date');
  parsed.setUTCDate(parsed.getUTCDate()+days);return parsed.toISOString().slice(0,10);
};

/** Existing assessments are immutable. Only unassessed periods are calculated. */
export function assessInvoiceCharges(invoice: ChargeInvoice, payments: Array<{invoiceId:string;date:string;amount:number;amountAppliedToInvoice?:number;cashDiscount?:number}>, asOf: string, postedAt: string) {
  chargeDate(asOf,0);
  const policy=invoice.lateChargePolicy;
  if(!policy)return {events:[] as InvoiceChargeEvent[], nextIndex:0, nextDate:null as string|null, added:0};
  if(policy.version!==1 || !Number.isInteger(policy.nextIndex) || policy.nextIndex<0)throw new Error('Invalid charge policy');
  let index=policy.nextIndex, added=0;
  const events:InvoiceChargeEvent[]=[];
  const previous=invoice.lateChargeEvents??[];
  for(let count=0;count<100;count++){
    const date=chargeDate(policy.firstChargeDate,index*15);
    if(date>asOf)return{events,nextIndex:index,nextDate:date,added};
    const id=`${invoice.id}:${index}`;
    if(previous.some(event=>event.id===id)){index++;continue;}
    // New schedules assess at the start of the business date. Existing posted schedules
    // retain their original through-date convention unless explicitly enrolled otherwise.
    const paid=payments.filter(p=>p.invoiceId===invoice.id&&(policy.paymentCutoff==='before_date'?p.date<date:p.date<=date)).reduce((sum,p)=>sum+getInvoicePaymentEffect(p as Parameters<typeof getInvoicePaymentEffect>[0]),0);
    const assessed=previous.filter(e=>e.date<=date).reduce((sum,e)=>sum+e.amount,0)+added;
    const basePaise=Math.max(0,Math.round((invoice.totalSales+assessed-paid)*100));
    if(basePaise===0)return{events,nextIndex:index,nextDate:null,added};
    const rateBasisPoints=index===0?200:100;
    const exactPaise=Math.round(basePaise*rateBasisPoints/10000);
    const amount=Math.floor((basePaise*rateBasisPoints+500000)/1000000);
    events.push({id,date,index,rateBasisPoints,baseAmount:basePaise/100,amount,roundingPaise:amount*100-exactPaise,createdAt:postedAt});
    added+=amount;index++;
  }
  return{events,nextIndex:index,nextDate:chargeDate(policy.firstChargeDate,index*15),added};
}
