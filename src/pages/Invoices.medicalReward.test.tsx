// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
vi.mock('../components/RouteMap',()=>({RouteMap:()=>null}));
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
const profile=vi.hoisted(()=>({role:'Staff'}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({canDeleteRecords:false,userProfile:{uid:'test-staff',role:profile.role,shopId:'SHOP_A'}})}));
vi.mock('../hooks/useIsMobile',()=>({useIsMobile:()=>true}));
vi.mock('../services/firestoreService',async()=>{const {calculateDynamicDueDate,DEFAULT_SETTINGS}=await import('../utils/settings');return ({
 calculateDueDate:calculateDynamicDueDate,createPayment:vi.fn(),createInvoice:vi.fn(),deleteInvoiceRecord:vi.fn(),updateInvoiceRecord:vi.fn(),updatePaymentRecord:vi.fn(),
 getCustomers:async()=>[...['medical','customer'].map(type=>({id:type,name:type+' test',customerType:type,tier:'Tier 4',mobile:'0000000000',area:'Test',branchId:'MASKI',previousOutstandingAmount:0,status:'Active'})),{id:'untyped',name:'Akshata Medical',tier:'Tier 4',mobile:'0000000000',area:'Test',previousOutstandingAmount:0,status:'Active'}],getInvoices:async()=>[{id:'i1',invoiceNumber:'A-1',customerId:'c1',customerName:'Test customer',shopId:'SHOP_A',date:'2026-10-25',dueDate:'2026-10-25',totalSales:10000,totalProfit:2000,pcPercentageAtInvoice:2,costAmount:8000,transportAmount:0,totalCost:8000,salesAmount:10000,createdAt:'2026-10-25'},...['medical','customer'].map(type=>({id:type+'-invoice',invoiceNumber:type==='medical'?'M-ONLY':'C-ONLY',customerId:type,customerName:type+' test',shopId:'SHOP_A',date:'2026-10-25',dueDate:'2026-11-10',totalSales:1000,totalProfit:200,pcPercentageAtInvoice:2,costAmount:800,transportAmount:0,totalCost:800,salesAmount:1000,createdAt:'2026-10-25'}))],getInvoicesByCustomerId:async()=>[],getNextInvoiceNumber:async()=>'A-2',getAppSettings:async()=>DEFAULT_SETTINGS,getPaymentsByInvoiceId:async()=>[],getPaymentsByCustomerId:async()=>[],getPaymentsByInvoiceIds:async()=>[]
});});
vi.mock('../services/salesappDirectory',()=>({getSalesappBranchStaff:async()=>[]}));
vi.mock('../services/creditService',()=>({getCustomerCreditSummary:vi.fn()}));
vi.mock('../services/derivedDataService',()=>({recalculateCustomerDerivedData:vi.fn()}));
vi.mock('../services/dispatchService',()=>({dispatchRequest:async()=>({routes:[]})}));
vi.mock('../services/medicalRewardService',()=>({quoteMedicalReward:async()=>({maximumAllowedCoins:160,levelRewardCoins:40,finalCombinedRewardCoins:100,valid:true,message:'',locked:false})}));
import Invoices from '../pages/Invoices';
import {SharedCustomerModeContext} from '../contexts/SharedCustomerModeContext';
afterEach(cleanup);

it('Medical selection and date changes prefill 15 days while normal Tier 4 stays same-day',async()=>{
 render(<MemoryRouter><Invoices/></MemoryRouter>);await within(screen.getByLabelText('Customer',{exact:true})).findByRole('option',{name:/medical test/});fireEvent.change(screen.getByLabelText('Invoice Date'),{target:{value:'2026-11-01'}});fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'medical'}});expect(screen.getByLabelText('Due Date')).toHaveValue('2026-11-16');fireEvent.change(screen.getByLabelText('Invoice Date'),{target:{value:'2026-11-03'}});expect(screen.getByLabelText('Due Date')).toHaveValue('2026-11-18');fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'customer'}});expect(screen.getByLabelText('Due Date')).toHaveValue('2026-11-03');
});

it('clears an unsaved proposal when the selected customer changes to another type',async()=>{
 render(<MemoryRouter><Invoices/></MemoryRouter>);await within(screen.getByLabelText('Customer',{exact:true})).findByRole('option',{name:/medical test/});fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'medical'}});fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));fireEvent.change(screen.getByLabelText('Manual TROIKAA coins'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'customer'}});expect(screen.queryByRole('button',{name:'TROIKAA Coins'})).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'medical'}});fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));expect(screen.getByLabelText('Manual TROIKAA coins')).toHaveValue('0');
});

it('explains missing Medical classification and never infers eligibility from a customer name',async()=>{
 render(<MemoryRouter><Invoices/></MemoryRouter>);await within(screen.getByLabelText('Customer',{exact:true})).findByRole('option',{name:/Akshata Medical/});fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'untyped'}});expect(screen.queryByRole('button',{name:'TROIKAA Coins'})).not.toBeInTheDocument();expect(screen.getByText('Customer type: Customer. TROIKAA Coins require Medical customer type.')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'medical'}});expect(screen.getByText('Customer type: MEDICAL')).toBeInTheDocument();expect(screen.getByRole('button',{name:'TROIKAA Coins'})).toBeInTheDocument();
});

it('shows expected invoice PC in place of the historical Cost column',async()=>{
 render(<MemoryRouter><Invoices/></MemoryRouter>);await screen.findByRole('columnheader',{name:'PC'});await screen.findByText('A-1');expect(screen.queryByRole('columnheader',{name:'Cost'})).not.toBeInTheDocument();const row=screen.getByText('A-1').closest('tr')!;expect(within(row).getByText('40',{exact:true})).toBeInTheDocument();
});
it('does not change TROIKAA coins when the mouse wheel scrolls',async()=>{
 render(<MemoryRouter><Invoices/></MemoryRouter>);await within(screen.getByLabelText('Customer',{exact:true})).findByRole('option',{name:/medical test/});fireEvent.change(screen.getByLabelText('Customer',{exact:true}),{target:{value:'medical'}});fireEvent.click(screen.getByRole('button',{name:'TROIKAA Coins'}));const input=screen.getByLabelText('Manual TROIKAA coins');expect(input).toHaveAttribute('type','text');expect(input).toHaveAttribute('inputmode','numeric');fireEvent.change(input,{target:{value:'100'}});fireEvent.wheel(input,{deltaY:100});expect(input).toHaveValue('100');
});

it.each(['medical','customer'] as const)('limits invoice history and customer selectors to %s mode',async mode=>{
 render(<MemoryRouter><SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>{},leaveMedical:()=>false}}><Invoices/></SharedCustomerModeContext.Provider></MemoryRouter>);
 await screen.findByText(mode==='medical'?'M-ONLY':'C-ONLY');expect(screen.queryByText(mode==='medical'?'C-ONLY':'M-ONLY')).not.toBeInTheDocument();const selector=screen.getByLabelText('Customer',{exact:true});expect(within(selector).getByRole('option',{name:new RegExp(mode+' test')})).toBeInTheDocument();expect(within(selector).queryByRole('option',{name:new RegExp((mode==='medical'?'customer':'medical')+' test')})).not.toBeInTheDocument();
});
