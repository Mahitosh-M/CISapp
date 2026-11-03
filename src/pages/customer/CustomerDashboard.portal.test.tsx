// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import {DEFAULT_SETTINGS} from '../../utils/settings';
const context=vi.hoisted(()=>({customer:{id:'c',name:'Akshata',customerType:'customer',tier:'Tier 4',totalOutstandingAmount:500,advanceBalance:0},invoices:[],payments:[],invoiceViews:[],settings:{},apcSummary:{apcBalance:50},bonusPcRequests:[],overduePcRequests:[],refreshPcBalance:vi.fn(async()=>{})}));
vi.mock('../../components/CustomerMobileLayout',()=>({useCustomerPortalContext:()=>context}));
import CustomerDashboard from './CustomerDashboard';
beforeEach(()=>{context.customer.customerType='customer';context.settings=DEFAULT_SETTINGS;vi.clearAllMocks();});
afterEach(cleanup);
it('keeps the Customer total as a static value without outstanding history',()=>{
 render(<MemoryRouter><CustomerDashboard/></MemoryRouter>);
 expect(screen.getByText('Total Outstanding')).toBeInTheDocument();
 expect(screen.getByText('Rs. 500')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Rs. 500'})).not.toBeInTheDocument();
 expect(document.getElementById('customer-outstanding-history')).toBeNull();
 expect(screen.queryByText('Outstanding Record')).not.toBeInTheDocument();
});
it.each(['customer','medical'])('welcomes %s and keeps coin history without the Explore Rewards button',(customerType)=>{
 context.customer.customerType=customerType;
 render(<MemoryRouter><CustomerDashboard/></MemoryRouter>);
 expect(screen.getByRole('heading',{name:'Welcome back'})).toBeInTheDocument();
 expect(screen.getByText('AKSHATA')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Folded hands in a Namaste greeting'})).toHaveAttribute('src','/images/dashboard-namaste-v2.png');
 expect(screen.queryByRole('button',{name:/Explore Rewards/i})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Toggle monthly PC history'}));
 expect(screen.getByText('This Month PC History')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Close PC history'}));
 expect(screen.queryByText('This Month PC History')).not.toBeInTheDocument();
 if(customerType==='medical')expect(screen.queryByText('Total Outstanding')).not.toBeInTheDocument();
});
