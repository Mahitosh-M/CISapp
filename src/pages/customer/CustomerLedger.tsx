import {useState} from 'react';
import {Navigate} from 'react-router-dom';
import {useCustomerPortalContext} from '../../components/CustomerMobileLayout';
import {calculateCustomerTotalOutstanding} from '../../utils/customerPortal';
import {buildMedicalLedger,getMedicalLedgerMonths} from '../../utils/medicalLedger';
import {getLedgerPaymentParts} from '../../utils/customerLedger';
import {formatDate,formatNumber} from '../../utils/formatters';
import {isOpeningBalanceInvoice} from '../../utils/openingBalance';
import './CustomerLedger.css';
const formatLedgerMoney=(amount:number)=>'₹'+formatNumber(amount);
export default function CustomerLedger(){
 const {customer,invoiceViews,invoices,payments,userProfile}=useCustomerPortalContext();
 const months=getMedicalLedgerMonths();
 const [selectedMonth,setSelectedMonth]=useState(months[0].id);
 if(!customer||(customer.customerType!=='medical'&&userProfile?.role!=='customer'))return <Navigate to="/customer/dashboard" replace/>;
 const outstanding=customer.totalOutstandingAmount??calculateCustomerTotalOutstanding(customer,invoiceViews);
 const ledger=buildMedicalLedger(invoices,payments,outstanding,selectedMonth);
 const displayedRows=selectedMonth===months[0].id?[...ledger.rows].reverse():ledger.rows;
 const monthLabel=months.find(month=>month.id===selectedMonth)?.label??months[0].label;
 return <section className={['medical-ledger',selectedMonth!==months[0].id?'ledger-history':''].filter(Boolean).join(' ')} aria-label={customer.customerType==='medical'?'Medical customer ledger':'Customer ledger'}>
  <h1>Ledger</h1>
  <div className="medical-ledger-total"><h2>Total Outstanding</h2><strong>{formatLedgerMoney(outstanding)}</strong></div>
  <div className="medical-ledger-months" role="group" aria-label="Ledger month">{months.map(month=><button key={month.id} type="button" aria-pressed={selectedMonth===month.id} onClick={()=>setSelectedMonth(month.id)}>{month.label}</button>)}</div>
  <h2 className="medical-ledger-month">{monthLabel}</h2>
  <p className="medical-ledger-counts">{ledger.invoiceCount} {ledger.invoiceCount===1?'invoice':'invoices'} · {ledger.paymentCount} {ledger.paymentCount===1?'payment':'payments'}</p>
  <div className="medical-ledger-table"><table><colgroup><col className="ledger-date-column"/><col className="ledger-record-column"/><col className="ledger-money-column"/><col className="ledger-money-column"/></colgroup><caption>{monthLabel} records</caption><thead><tr><th>Date</th><th>Record</th><th>Amount</th><th>Balance</th></tr></thead><tbody>
   <tr className="medical-ledger-balance"><th colSpan={3} scope="row">Opening</th><td className="medical-ledger-running ledger-opening-value">{formatLedgerMoney(ledger.openingBalance)}</td></tr>
   {displayedRows.length?displayedRows.map(row=>{
    const parts=getLedgerPaymentParts(row),discount=parts.reduce((total,part)=>total+(part.cashDiscount||0),0),advance=parts.reduce((total,part)=>total+(part.advanceCreatedAmount||0),0);
    const isAdvance=row.payment?.paymentKind==='advance_application';
    return <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.kind==='invoice'?row.charge?'Overdue charge':row.invoice&&isOpeningBalanceInvoice(row.invoice)?'Opening balance':'Invoice':isAdvance?'Advance applied':'Payment'}{row.payment?.mode&&<small>{row.payment.mode}</small>}{discount>0&&<small>Cash discount {formatLedgerMoney(discount)}</small>}{advance>0&&<small>Advance credit {formatLedgerMoney(advance)}</small>}</td><td className={row.kind==='invoice'?'medical-ledger-invoice':'medical-ledger-payment'}>{formatLedgerMoney(row.kind==='invoice'?row.invoiceAmount:isAdvance?row.paymentAmount:row.paymentReceived)}</td><td className="medical-ledger-running">{formatLedgerMoney(row.runningBalance)}</td></tr>;
   }):<tr><td colSpan={4}>No records this month.</td></tr>}
  </tbody></table></div>
  <section className="ledger-closing" aria-label="Closing balance"><h2>Closing</h2><strong>{formatLedgerMoney(ledger.closingBalance)}</strong></section>
 </section>;
}
