// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({role:'Staff'})}));
vi.mock('../services/firestoreService',()=>({getCustomers:async()=>['medical','customer'].map(type=>({id:type,customerType:type})),getInvoices:vi.fn(),getPayments:vi.fn()}));
vi.mock('../services/dispatchService',()=>({dispatchRequest:async(type:string)=>type==='routeCatalog'?{routes:[]}:{customers:['medical','customer'].map(type=>({id:type,name:type+' test',invoices:[]})),requests:['medical','customer'].map(type=>({id:type+'-request',invoiceNumber:type+' delivery',sourceCustomerId:type,customerName:type+' test',active:true,tripId:null})),claims:['medical','customer'].map(type=>({id:type+'-claim',customerId:type,amount:100,mode:'Cash',status:'Pending',reference:type+' receipt'}))}}));
import Dispatch from './Dispatch';
import {SharedCustomerModeContext} from '../contexts/SharedCustomerModeContext';
afterEach(cleanup);
it.each(['medical','customer'] as const)('limits delivery requests and collection review to %s mode',async mode=>{
 render(<SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>{},leaveMedical:()=>false}}><Dispatch/></SharedCustomerModeContext.Provider>);fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByText(mode+' delivery');expect(screen.queryByText((mode==='medical'?'customer':'medical')+' delivery')).not.toBeInTheDocument();expect(screen.queryByText((mode==='medical'?'customer':'medical')+' receipt')).not.toBeInTheDocument();expect(screen.getByText(mode+' receipt')).toBeInTheDocument();
});
