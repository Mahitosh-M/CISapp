// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within,waitFor} from '@testing-library/react';
import type {BonusPcRequest,RedemptionRequest,LoyaltyLedgerEntry} from '../../types';
import {getTodayDateString} from '../../utils/dateUtils';
import {MemoryRouter} from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import {DEFAULT_SETTINGS} from '../../utils/settings';
const context=vi.hoisted(()=>({customer:{id:'c',name:'Akshata',customerType:'customer',tier:'Tier 4',totalOutstandingAmount:500,advanceBalance:0},invoices:[],payments:[],invoiceViews:[],settings:{},apcSummary:{apcBalance:50},bonusPcRequests:[] as BonusPcRequest[],overduePcRequests:[],redemptionRequests:[] as RedemptionRequest[],refreshPcBalance:vi.fn(async()=>{})}));
vi.mock('../../components/CustomerMobileLayout',()=>({useCustomerPortalContext:()=>context}));
const reads=vi.hoisted(()=>({redemptions:vi.fn(async()=>[] as LoyaltyLedgerEntry[])}));
vi.mock('../../services/firestoreService',()=>({getCustomerPcRedemptionEntries:reads.redemptions}));
import CustomerDashboard from './CustomerDashboard';
beforeEach(()=>{context.customer.customerType='customer';context.settings=DEFAULT_SETTINGS;context.bonusPcRequests=[];context.redemptionRequests=[];vi.clearAllMocks();reads.redemptions.mockReset().mockResolvedValue([]);});
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


it.each(['customer','medical'])('loads signed redemption history only on click for %s, using original ledger dates',async customerType=>{
 context.customer.customerType=customerType;
 const month=getTodayDateString().slice(0,7),date=month+'-01T09:00:00Z';
 context.bonusPcRequests=[{id:'bonus',customerId:'c',customerName:'Akshata',bonusLabel:'Monthly bonus',approvedCoins:60,status:'Approved',generatedAt:date,reviewedAt:date} as BonusPcRequest];
 context.redemptionRequests=[{id:'request',customerId:'c',customerName:'Akshata',rewardId:'reward',rewardName:'Test reward',points:150,status:'Gifted',requestedAt:date,reviewedAt:month+'-04T09:00:00Z'}];
 const entry:LoyaltyLedgerEntry={id:'debit',customerId:'c',type:'redemption',points:-150,reason:'Gift approved',referenceId:'request',month,createdAt:date};
 reads.redemptions.mockResolvedValue([entry,{...entry,id:'return',type:'redemption_reversal',points:25,referenceId:'return',createdAt:month+'-02T09:00:00Z'},{...entry,id:'foreign',customerId:'other',points:-9999},{...entry,id:'older',month:'2025-01',points:-8888}]);
 render(<MemoryRouter><CustomerDashboard/></MemoryRouter>);
 expect(reads.redemptions).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Toggle monthly PC history'}));
 const title=await screen.findByText('Redeemed: Test reward');
 const history=within(screen.getByRole('region',{name:'Monthly PC history'}));
 expect(reads.redemptions).toHaveBeenCalledExactlyOnceWith('c',month);
 const row=title.closest('[data-portal-box="card"]')!;
 expect(within(row as HTMLElement).getByText('−150')).toHaveStyle({color:'#B42318'});
 expect(within(row as HTMLElement).getByText('Redeemed on 01-'+month.slice(5)+'-'+month.slice(0,4))).toBeInTheDocument();
 expect(screen.getByText('+85')).toBeInTheDocument();
 expect(screen.getByText('PC redeemed')).toBeInTheDocument();
 expect(history.getByText('Monthly bonus')).toBeInTheDocument();
 expect(screen.queryByText(/9,999|8,888/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Redeemed'}));
 expect(history.queryByText('Monthly bonus')).not.toBeInTheDocument();
 expect(screen.getByText('Redemption returned')).toBeInTheDocument();
 expect(screen.getByText('+25')).toHaveStyle({color:'#166534'});
 fireEvent.click(screen.getByRole('button',{name:'Purchase'}));
 expect(screen.getByText('No PC transactions in this category for the current month.')).toBeInTheDocument();
 expect(reads.redemptions).toHaveBeenCalledTimes(1);
 expect(context.apcSummary.apcBalance).toBe(50);
});

it('shows a redemption read failure and retries without changing the PC balance',async()=>{
 reads.redemptions.mockRejectedValueOnce(new Error('Network unavailable'));
 render(<MemoryRouter><CustomerDashboard/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Toggle monthly PC history'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load redeemed coins.');
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
 expect(reads.redemptions).toHaveBeenCalledTimes(2);
 expect(context.apcSummary.apcBalance).toBe(50);
});
