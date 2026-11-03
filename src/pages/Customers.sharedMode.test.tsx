// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const service=vi.hoisted(()=>({createCustomer:vi.fn()}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({canDeleteRecords:false,userProfile:{role:'Staff',uid:'staff'}})}));
vi.mock('../services/firestoreService',async()=>{const {DEFAULT_SETTINGS}=await import('../utils/settings');return {
 createCustomer:service.createCustomer,deleteCustomerRecord:vi.fn(),updateCustomerRecord:vi.fn(),updateCustomerBranch:vi.fn(),getAppSettings:async()=>DEFAULT_SETTINGS,getPaymentTermsForTier:()=>'',
 getCustomers:async()=>['medical','customer'].map(type=>({id:type,name:type+' test',customerType:type,tier:'Tier 4',mobile:'9999999999',area:'test',branchId:'MASKI',previousOutstandingAmount:0,advanceBalance:0,status:'Active',notes:'',createdAt:'2026-11-01'})),
 getInvoices:async()=>[],getPayments:async()=>[],getInvoicesByCustomerId:async()=>[],getPaymentsByCustomerId:async()=>[]
};});
import Customers from './Customers';
import {SharedCustomerModeContext} from '../contexts/SharedCustomerModeContext';
beforeEach(()=>service.createCustomer.mockReset().mockResolvedValue({id:'new'}));afterEach(cleanup);
it.each(['customer','medical'] as const)('scopes searches and new customer classification to %s mode',async mode=>{
 render(<SharedCustomerModeContext.Provider value={{mode,enterMedical:()=>{},leaveMedical:()=>false}}><Customers/></SharedCustomerModeContext.Provider>);
 const addName=mode==='medical'?/Add MEDICAL/:/Add Customer/;await waitFor(()=>expect(screen.getByRole('button',{name:addName})).toBeInTheDocument());expect(screen.queryByRole('button',{name:mode==='medical'?/Add Customer/:/Add MEDICAL/})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Search by Name or Area'),{target:{value:'test'}});await screen.findAllByText(mode+' test');expect(screen.queryByText((mode==='medical'?'customer':'medical')+' test')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:addName}));fireEvent.change(screen.getByLabelText('Customer Name'),{target:{value:'New account'}});fireEvent.change(screen.getByLabelText('Mobile Number'),{target:{value:'9876543210'}});fireEvent.submit(screen.getByLabelText('Customer Name').closest('form')!);await waitFor(()=>expect(service.createCustomer).toHaveBeenCalledTimes(1));expect(service.createCustomer.mock.calls[0][0]).toMatchObject({name:'New account',customerType:mode});
});
