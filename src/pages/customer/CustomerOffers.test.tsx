// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
const state=vi.hoisted(()=>({customer:{customerType:'customer'},userProfile:{role:'customer'},offers:[],partnerJourney:undefined as unknown,loadPartnerJourney:vi.fn()}));
vi.mock('../../components/CustomerMobileLayout',()=>({useCustomerPortalContext:()=>state}));
vi.mock('../../components/CustomerLevelJourney',()=>({default:({section}:{section:string})=><div>{section} details loaded</div>}));
import CustomerOffers from './CustomerOffers';
beforeEach(()=>{state.customer={customerType:'customer'};state.userProfile={role:'customer'};state.partnerJourney=undefined;state.loadPartnerJourney.mockReset().mockImplementation(async()=>{state.partnerJourney={levels:[]};});});afterEach(cleanup);
describe('Offers partnership disclosures',()=>{
 it.each([['medical','customer'],['customer','Medical']])('removes both sections for customer type %s or role %s',(type,role)=>{state.customer.customerType=type;state.userProfile.role=role;render(<MemoryRouter><CustomerOffers/></MemoryRouter>);expect(screen.queryByRole('button',{name:'Grow your partnership'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Benefits at every level'})).not.toBeInTheDocument();expect(state.loadPartnerJourney).not.toHaveBeenCalled();});
 it('waits for a button press, then shares the loaded result across both sections and repeat visits',async()=>{
  const view=render(<MemoryRouter><CustomerOffers/></MemoryRouter>);expect(state.loadPartnerJourney).not.toHaveBeenCalled();expect(screen.queryByText('growth details loaded')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Grow your partnership'}));await screen.findByText('growth details loaded');expect(state.loadPartnerJourney).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Benefits at every level'}));await screen.findByText('benefits details loaded');expect(state.loadPartnerJourney).toHaveBeenCalledTimes(1);view.unmount();render(<MemoryRouter><CustomerOffers/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Grow your partnership'}));await screen.findByText('growth details loaded');expect(state.loadPartnerJourney).toHaveBeenCalledTimes(1);
 });
});
