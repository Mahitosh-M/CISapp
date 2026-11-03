// @vitest-environment jsdom
import {beforeEach,it,expect,vi} from 'vitest';
import {renderHook,waitFor,act,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {ReactNode} from 'react';
const mocks=vi.hoisted(()=>({profile:{uid:'uid',customerId:'c',role:'customer'},invoices:vi.fn(async()=>[]),payments:vi.fn(async()=>[]),journey:vi.fn(()=>({levels:[],dueNow:0}))}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({userProfile:mocks.profile})}));
vi.mock('../services/firestoreService',async()=>{const {DEFAULT_SETTINGS}=await import('../utils/settings');return {getCustomerById:async()=>({id:'c',name:'Customer',tier:'Tier 4',customerType:'customer'}),getCustomersByName:async()=>[],getInvoicesForCustomerViewer:mocks.invoices,getPaymentsForCustomerViewer:mocks.payments,getAppSettings:async()=>DEFAULT_SETTINGS,getActiveOffers:async()=>[],getActiveRewardItems:async()=>[],getRedemptionRequestsForCustomer:async()=>[],getApprovedOverduePcRequestsForCustomer:async()=>[],getApprovedBonusPcRequestsForCustomer:async()=>[],getCustomerPcBalanceRecord:async()=>({availablePc:10,incomingPc:10,redeemedPc:0})};});
vi.mock('../services/creditService',()=>({getCustomerCreditSummary:async()=>undefined,calculateCustomerCreditSummaryLocally:()=>undefined}));
vi.mock('../utils/customerAnalytics',()=>({buildCustomerScores:()=>[{tier:'Tier 4'}]}));
vi.mock('../utils/partnerLevelJourney',()=>({buildPartnerLevelJourney:mocks.journey}));
import {useCustomerPortalData} from './useCustomerPortalData';
import {clearCustomerSessionCache} from '../services/customerSessionCache';
beforeEach(()=>{cleanup();clearCustomerSessionCache();vi.clearAllMocks();});
it('makes no partnership invoice/payment reads before a click and caches concurrent/repeated loads until logout',async()=>{
 const wrapper=({children}:{children:ReactNode})=><MemoryRouter initialEntries={['/customer/offers']}>{children}</MemoryRouter>;
 const first=renderHook(()=>useCustomerPortalData(),{wrapper});await waitFor(()=>expect(first.result.current.loading).toBe(false));expect(mocks.invoices).not.toHaveBeenCalled();expect(mocks.payments).not.toHaveBeenCalled();expect(mocks.journey).not.toHaveBeenCalled();
 await act(async()=>{await Promise.all([first.result.current.loadPartnerJourney(),first.result.current.loadPartnerJourney()]);});expect(mocks.invoices).toHaveBeenCalledTimes(1);expect(mocks.payments).toHaveBeenCalledTimes(1);expect(mocks.journey).toHaveBeenCalledTimes(1);
 await act(async()=>{await first.result.current.loadPartnerJourney();});expect(mocks.invoices).toHaveBeenCalledTimes(1);first.unmount();
 const second=renderHook(()=>useCustomerPortalData(),{wrapper});await waitFor(()=>expect(second.result.current.loading).toBe(false));await act(async()=>{await second.result.current.loadPartnerJourney();});expect(mocks.invoices).toHaveBeenCalledTimes(1);second.unmount();clearCustomerSessionCache();
 const third=renderHook(()=>useCustomerPortalData(),{wrapper});await waitFor(()=>expect(third.result.current.loading).toBe(false));await act(async()=>{await third.result.current.loadPartnerJourney();});expect(mocks.invoices).toHaveBeenCalledTimes(2);third.unmount();
});
