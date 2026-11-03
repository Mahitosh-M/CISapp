import {formatNumber} from '../utils/formatters';
const formatWheelMoney=(amount:number)=>'₹'+formatNumber(amount);
import './MedicalInvoiceBalanceWheel.css';

export default function MedicalInvoiceBalanceWheel({invoiceAmount,pendingAmount,paidAmount}:{invoiceAmount:number;pendingAmount:number;paidAmount:number}){
 const pending=Math.max(0,pendingAmount);
 const paid=Math.max(0,paidAmount);
 const total=Math.max(0,invoiceAmount);
 const pendingPercentage=total>0?Math.min(100,pending/total*100):0;
 return <div className="medical-invoice-circle medical-invoice-balance-wheel" role="img" aria-label={'Pending '+formatWheelMoney(pending)+'. Paid '+formatWheelMoney(paid)+'. Invoice amount '+formatWheelMoney(total)} style={{background:total>0?'conic-gradient(#FF003D 0% '+pendingPercentage+'%, #00E676 '+pendingPercentage+'% 100%)':'#64748B'}}>
  <div className="medical-invoice-circle-center medical-invoice-balance-center">
   <strong className="medical-invoice-pending-value">{formatWheelMoney(pending)}</strong>
   <span className="medical-invoice-paid-value">{formatWheelMoney(paid)}</span>
   <small className="medical-invoice-total-value">{formatWheelMoney(total)}</small>
  </div>
 </div>;
}
