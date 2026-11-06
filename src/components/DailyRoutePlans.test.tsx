// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/dispatchService', () => ({ dispatchRequest: api.request }));
import DailyRoutePlans, { type DailyRoutePlan } from './DailyRoutePlans';
const stop = (id: string, customerId: string) => ({ id,customerId,customerName:customerId+' business',invoiceId:id,invoiceNumber:id,packages:2,shopId:'SHOP_A',routeStopName:'Fixture stop',locked:false });
const plan: DailyRoutePlan = {id:'daily',name:'Monday route',date:'2026-11-09',revision:3,routeId:'weekly',stops:[stop('first','medical'),stop('hidden','customer'),stop('last','medical')]};
beforeEach(() => { api.request.mockReset().mockResolvedValue({ saved:true }); });
afterEach(cleanup);
it('keeps Customer/Medical mode filtering in the editor and saves only the reordered visible deliveries', async () => {
 const saved=vi.fn(async()=>{});
 render(<DailyRoutePlans plans={[plan]} customerIds={new Set(['medical'])} isAdmin={false} onSaved={saved} />);
 expect(screen.getByText('2 deliveries | 4 packages')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Edit route'}));
 const dialog=screen.getByRole('dialog',{name:'Edit daily route'});
 expect(within(dialog).queryByText('customer business')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Move delivery 2 up'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Save route order'}));
 await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
 expect(api.request).toHaveBeenCalledWith('saveDailyRouteOrder',{id:'daily',revision:3,stopIds:['last','first']});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('allows Admin to edit all groups and open full planning in Dispatch',()=>{
 render(<DailyRoutePlans plans={[plan]} isAdmin onSaved={async()=>{}} />);
 expect(screen.getByRole('link',{name:'Assign vehicle and driver in Dispatch'})).toHaveAttribute('href','https://delivery-28165.web.app/routes');
 fireEvent.click(screen.getByRole('button',{name:'Edit route'}));
 expect(within(screen.getByRole('dialog')).getByText('customer business')).toBeInTheDocument();
});
it('keeps a stale route open with the error, restores focus on Escape, and never changes invoice fields',async()=>{
 api.request.mockRejectedValueOnce(new Error('Route changed. Refresh and reopen it before saving.'));
 render(<DailyRoutePlans plans={[plan]} isAdmin={false} onSaved={async()=>{}} />);
 const opener=screen.getByRole('button',{name:'Edit route'});opener.focus();fireEvent.click(opener);
 fireEvent.click(screen.getByRole('button',{name:'Save route order'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Route changed');
 expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.keyDown(screen.getByRole('dialog').querySelector('[tabindex]')!,{key:'Escape'});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(opener).toHaveFocus();
 expect(api.request).toHaveBeenCalledTimes(1);
});
it('does not allow locked deliveries to move and shows no drafts for an empty selected mode',()=>{
 const view=render(<DailyRoutePlans plans={[{...plan,stops:[{...plan.stops[0],locked:true},plan.stops[2]]}]} isAdmin={false} onSaved={async()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Edit route'}));
 expect(screen.getByRole('button',{name:'Move delivery 1 down'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Move delivery 2 up'})).toBeDisabled();
 view.unmount();
 render(<DailyRoutePlans plans={[plan]} customerIds={new Set()} isAdmin={false} onSaved={async()=>{}} />);
 expect(screen.queryByRole('button',{name:'Edit route'})).not.toBeInTheDocument();
});
