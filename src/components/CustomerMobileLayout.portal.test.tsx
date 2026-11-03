// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,within,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import {DEFAULT_SETTINGS} from '../utils/settings';
const state=vi.hoisted(()=>({role:'customer',data:{customer:{id:'c',name:'Customer',customerType:'customer',tier:'Tier 4'},userProfile:{uid:'u',role:'customer'},settings:{},apcSummary:{apcBalance:50},bonusPcRequests:[],loading:false,error:''}}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({role:state.role,logout:vi.fn()})}));
vi.mock('../hooks/useCustomerPortalData',()=>({useCustomerPortalData:()=>state.data}));
vi.mock('../services/firestoreService',()=>({markBonusPcRequestSeen:vi.fn()}));
vi.mock('./InstallAppPrompt',()=>({default:()=>null}));
import CustomerMobileLayout from './CustomerMobileLayout';
beforeEach(()=>{localStorage.clear();state.data.settings=DEFAULT_SETTINGS;});
afterEach(cleanup);
it.each([['customer','customer'],['Medical','medical']])('shows the same Ledger navigation for %s accounts',(role,type)=>{
 state.role=role;state.data.userProfile.role=role;state.data.customer.customerType=type;
 render(<MemoryRouter initialEntries={['/customer/dashboard']}><CustomerMobileLayout/></MemoryRouter>);
 const nav=screen.getByRole('navigation',{name:'Customer navigation'});
 expect(within(nav).getAllByRole('link').map(link=>link.getAttribute('aria-label'))).toEqual(['Dashboard','Ledger','Invoices','Rewards','Offers']);
 expect(within(nav).getByRole('link',{name:'Ledger'})).toHaveAttribute('href','/customer/ledger');
});
