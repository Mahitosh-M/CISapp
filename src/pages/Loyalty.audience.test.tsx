// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const mocks = vi.hoisted(() => ({
  role: 'Admin',
  createReward: vi.fn(async () => undefined), updateReward: vi.fn(async () => undefined),
  createOffer: vi.fn(async () => undefined), updateOffer: vi.fn(async () => undefined)
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: { uid: 'admin', role: mocks.role } }) }));
vi.mock('../components/SectionTileNav', () => ({ default: ({ items, onSelect }: { items: Array<{id:string;label:string}>; onSelect:(id:string)=>void }) =>
  <nav>{items.map(item => <button key={item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav> }));
vi.mock('../services/firestoreService', () => ({
  createRewardItem: mocks.createReward, updateRewardItemRecord: mocks.updateReward,
  createOffer: mocks.createOffer, updateOfferRecord: mocks.updateOffer,
  getRewardItems: async () => [{ id: 'legacy', name: 'Legacy reward', requiredPoints: 20, levelRequired: 'Active Partner', isActive: true }],
  getOffers: async () => [{ id: 'med', title: 'Medical poster', description: '', imageUrl: '', levelRequired: 'Active Partner', startDate: '', endDate: '', isActive: true, customerAudience: 'medical' }],
  getAppSettings: vi.fn(), getGiftHistory: async()=>[], getRedemptionRequests: async()=>[],
  deleteGiftHistoryRecord: vi.fn(), deleteOfferRecord: vi.fn(), deleteRewardItemRecord: vi.fn(),
  markRedemptionRequestGifted: vi.fn(), removeRedemptionApproval: vi.fn(), reviewRedemptionRequest: vi.fn(), updateAppSettings: vi.fn()
}));
import Loyalty from './Loyalty';
beforeEach(() => { mocks.role='Admin'; vi.clearAllMocks(); });
afterEach(cleanup);
it('adds a Medical reward and restores the default Both selection after saving', async () => {
  render(<Loyalty/>);
  fireEvent.click(screen.getByRole('button', {name:'Reward Catalogue'}));
  await screen.findByText('Legacy reward');
  const select=screen.getByRole('combobox', {name:'Visible to'});
  expect(select).toHaveValue('both');
  fireEvent.change(select, {target:{value:'medical'}});
  fireEvent.change(screen.getByRole('textbox', {name:'Reward Name'}), {target:{value:'New reward'}});
  fireEvent.click(screen.getByRole('button', {name:'Add Reward'}));
  await waitFor(()=>expect(mocks.createReward).toHaveBeenCalledWith(expect.objectContaining({name:'New reward',customerAudience:'medical'}),expect.anything()));
  await waitFor(()=>expect(select).toHaveValue('both'));
});
it('loads a legacy reward as Both and saves an explicit Customer edit', async () => {
  render(<Loyalty/>); fireEvent.click(screen.getByRole('button',{name:'Reward Catalogue'}));
  const row=(await screen.findByText('Legacy reward')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button',{name:'Edit'}));
  const select=screen.getByRole('combobox',{name:'Visible to'});
  expect(select).toHaveValue('both'); fireEvent.change(select,{target:{value:'customer'}});
  fireEvent.click(screen.getByRole('button',{name:'Update Reward'}));
  await waitFor(()=>expect(mocks.updateReward).toHaveBeenCalledWith('legacy',expect.objectContaining({customerAudience:'customer'}),expect.anything()));
});
it('preserves offer audience on activation changes and allows editing the audience', async () => {
  render(<Loyalty/>); fireEvent.click(screen.getByRole('button',{name:'Offers'}));
  const row=(await screen.findByText('Medical poster')).closest('tr')!;
  fireEvent.click(within(row).getByRole('button',{name:'Deactivate'}));
  await waitFor(()=>expect(mocks.updateOffer).toHaveBeenCalledWith('med',expect.objectContaining({customerAudience:'medical',isActive:false}),expect.anything()));
  await waitFor(()=>expect(within(row).getByRole('button',{name:'Edit'})).toBeEnabled());
  fireEvent.click(within(row).getByRole('button',{name:'Edit'}));
  const select=screen.getByRole('combobox',{name:'Visible to'}); expect(select).toHaveValue('medical');
  fireEvent.change(select,{target:{value:'both'}});
  fireEvent.click(screen.getByRole('button',{name:'Update Offer'}));
  await waitFor(()=>expect(mocks.updateOffer).toHaveBeenLastCalledWith('med',expect.objectContaining({customerAudience:'both'}),expect.anything()));
});
it('saves the selected audience for a new offer', async () => {
  render(<Loyalty/>); fireEvent.click(screen.getByRole('button',{name:'Offers'}));await screen.findByText('Medical poster');
  fireEvent.change(screen.getByRole('combobox',{name:'Visible to'}),{target:{value:'customer'}});
  fireEvent.change(screen.getByRole('textbox',{name:'Title'}),{target:{value:'Customer offer'}});
  fireEvent.click(screen.getByRole('button',{name:'Add Offer'}));
  await waitFor(()=>expect(mocks.createOffer).toHaveBeenCalledWith(expect.objectContaining({title:'Customer offer',customerAudience:'customer'}),expect.anything()));
});
it('keeps audience editing Admin-only', async () => {
  mocks.role='Staff';render(<Loyalty/>);fireEvent.click(screen.getByRole('button',{name:'Reward Catalogue'}));await screen.findByText('Legacy reward');
  expect(screen.queryByRole('combobox',{name:'Visible to'})).not.toBeInTheDocument();
});
