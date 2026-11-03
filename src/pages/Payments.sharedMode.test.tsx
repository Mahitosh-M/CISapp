// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({canDeleteRecords:false,userProfile:{role:'Staff',uid:'staff',shopId:'SHOP_A'}})}));
vi.mock('../hooks/useIsMobile',()=>({useIsMobile:()=>true}));
vi.mock('../services/derivedDataService',()=>({recalculateCustomerDerivedData:vi.fn()}));
vi.mock('../services/firestoreService',()=>({
 createPayment:vi.fn(),deletePaymentRecord:vi.fn(),updatePaymentRecord:vi.fn(),getInvoices:async()=>[],getInvoicesByCustomerId:async()=>[],getPaymentsByInvoiceIds:async()=>[],getPaymentsByCustomerId:async()=>[],getPaymentsBySplitPaymentGroupIds:async()=>[],
 getCustomers:async()=>['medical','customer'].map(type=>({id:type,name:type+' test',customerType:type,tier:'Tier 4',mobile:'9999999999',area:'test',branchId:'MASKI',previousOutstandingAmount:0,advanceBalance:0,status:'Active',notes:'',createdAt:'2026-11-01'})),
 getPayments:async()=>['customer','medical'].map(type=>({id:type+'-payment',invoiceId:'i',invoiceNumber:type==='medical'?'PAY-MED':'PAY-CUSTOMER',customerId:type,customerName:type+' test',date:'2026-11-01',amount:100,amountAppliedToInvoice:100,advanceCreatedAmount:0,advanceAppliedAmount:0,amountUsedForOldBalance:0,oldBalanceBeforePayment:0,oldBalanceAfterPayment:0,cashDiscount:0,mode:'Cash',notes:'',createdAt:'2026-11-01'}))
}));
import Payments from './Payments';
import {SharedCustomerModeContext} from '../contexts/SharedCustomerModeContext';
afterEach(cleanup);
it.each(['medical','customer'] as const)('limits payment history and entry selectors to %s mode',async mode=>{
 render(<SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>{},leaveMedical:()=>false}}><Payments/></SharedCustomerModeContext.Provider>);
 await screen.findAllByText(mode+' test');expect(screen.queryByText((mode==='medical'?'customer':'medical')+' test')).not.toBeInTheDocument();const selector=screen.getByLabelText('Customer',{exact:true});expect(within(selector).getByRole('option',{name:new RegExp(mode+' test')})).toBeInTheDocument();expect(within(selector).queryByRole('option',{name:new RegExp((mode==='medical'?'customer':'medical')+' test')})).not.toBeInTheDocument();
});
