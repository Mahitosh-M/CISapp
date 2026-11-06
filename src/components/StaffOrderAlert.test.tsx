// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const data=vi.hoisted(()=>({role:'Staff',orders:[{id:'one'}] as Array<{id:string}>,checked:true}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({userProfile:{uid:'staff-test',role:data.role}})}));
vi.mock('../contexts/StaffOrdersContext',()=>({useStaffOrders:()=>data}));
import StaffOrderAlert from './StaffOrderAlert';
function CurrentPath(){return <p data-testid="path">{useLocation().pathname}</p>}
function mount(path='/invoices'){return render(<MemoryRouter initialEntries={[path]}><StaffOrderAlert/><CurrentPath/></MemoryRouter>)}
afterEach(()=>{cleanup();data.role='Staff';data.orders=[{id:'one'}];data.checked=true});
describe('Staff login order alert',()=>{
 it('shows pending orders, focuses the action and opens the dedicated Orders page',()=>{
  mount();expect(screen.getByRole('dialog')).toBeTruthy();
  const action=screen.getByRole('button',{name:'Go to Orders'});expect(document.activeElement).toBe(action);
  fireEvent.click(action);expect(screen.getByTestId('path').textContent).toBe('/orders');expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('does not show for Admin, Customer, empty orders or an unfinished check',()=>{
  for(const role of ['Admin','customer','Medical']){data.role=role;const view=mount();expect(screen.queryByRole('dialog')).toBeNull();view.unmount()}
  data.role='Staff';data.orders=[];const empty=mount();expect(screen.queryByRole('dialog')).toBeNull();empty.unmount();
  data.orders=[{id:'one'}];data.checked=false;mount();expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('supports dismissal and does not interrupt the Orders page',()=>{
  const first=mount();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();first.unmount();
  mount('/orders');expect(screen.queryByRole('dialog')).toBeNull();
 });
});
