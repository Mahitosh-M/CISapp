// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,within,cleanup} from '@testing-library/react';
import type {ReactNode} from 'react';
import '@testing-library/jest-dom/vitest';
import type {Invoice,Payment} from '../../types';
import {calculateDueStatus,type CustomerInvoiceView} from '../../utils/customerPortal';
const context=vi.hoisted(()=>({userProfile:{role:'Medical'},customer:{customerType:'medical'},invoiceViews:[] as CustomerInvoiceView[]}));
vi.mock('../../components/CustomerMobileLayout',()=>({useCustomerPortalContext:()=>context}));
vi.mock('recharts',()=>({ResponsiveContainer:({children}:{children:ReactNode})=><div>{children}</div>,PieChart:({children}:{children:ReactNode})=><div>{children}</div>,Pie:()=>null,Cell:()=>null}));
import CustomerInvoices from './CustomerInvoices';
beforeEach(()=>{
 context.customer.customerType='medical';context.userProfile.role='Medical';
 const invoice:Invoice={id:'i',invoiceNumber:'M-1',customerId:'med',customerName:'Medical',date:'2026-11-01',dueDate:'2026-12-01',totalSales:1000,salesAmount:1000,totalCost:500,costAmount:500,totalProfit:500,transportAmount:0,notes:'',createdAt:'2026-11-01'};
 const payment:Payment={id:'p',invoiceId:'i',invoiceNumber:'M-1',customerId:'med',customerName:'Medical',date:'2026-11-02',amount:400,amountAppliedToInvoice:400,advanceCreatedAmount:0,advanceAppliedAmount:0,amountUsedForOldBalance:0,oldBalanceBeforePayment:0,oldBalanceAfterPayment:0,cashDiscount:0,mode:'Cash',notes:'',createdAt:'2026-11-02'};
 context.invoiceViews=[calculateDueStatus(invoice,[payment])];
});
afterEach(cleanup);
it.each([['medical','Medical'],['customer','customer']])('shows the same three-circle invoice presentation for %s accounts',(type,role)=>{
 context.customer.customerType=type;context.userProfile.role=role;
 render(<CustomerInvoices/>);
 const wheel=screen.getByRole('img',{name:'Pending ₹600. Paid ₹400. Invoice amount ₹1,000'});
 expect(within(wheel).getByText('₹600')).toBeInTheDocument();
 expect(within(wheel).getByText('₹400')).toBeInTheDocument();
 expect(within(wheel).getByText('₹1,000')).toBeInTheDocument();
 expect(within(wheel).queryByText(/Pending|Paid|Invoice amount/)).not.toBeInTheDocument();
 expect(screen.getByText(/Days (Left|Overdue)/)).toBeInTheDocument();
 expect(screen.getByText(/EXPECTED PC|PC EXPIRED/)).toBeInTheDocument();
});
it('does not extend the portal invoice presentation to Staff',()=>{
 context.customer.customerType='customer';context.userProfile.role='Staff';render(<CustomerInvoices/>);
 expect(screen.queryByRole('img',{name:/^Pending /})).not.toBeInTheDocument();
 expect(screen.getByText('Outstanding')).toBeInTheDocument();
});
