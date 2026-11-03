// @vitest-environment jsdom
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
const profile=vi.hoisted(()=>({role:'Staff',uid:'staff-1'}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({userProfile:profile,logout:vi.fn()})}));
vi.mock('../hooks/useIsMobile',()=>({useIsMobile:()=>false}));
import Layout from './Layout';
import {useEnterKeyNavigation} from '../hooks/useEnterKeyNavigation';
const KeyboardLayout=()=>{useEnterKeyNavigation();return <Layout/>;};
import {useSharedCustomerMode} from '../contexts/SharedCustomerModeContext';
import {clearSharedCustomerModes} from '../utils/sharedCustomerMode';
const Probe=()=>{const context=useSharedCustomerMode();return <div><p data-testid="mode">{context?.mode}</p><input aria-label="Draft customer" defaultValue=""/></div>;};
const view=(initial='/invoices')=>render(<MemoryRouter initialEntries={[initial]}><Routes><Route element={<KeyboardLayout/>}><Route path="invoices" element={<Probe/>}/><Route path="payments" element={<Probe/>}/><Route path="customers" element={<Probe/>}/><Route path="dispatch" element={<Probe/>}/><Route path="analytics" element={<Probe/>}/><Route path="collections" element={<Probe/>}/></Route></Routes></MemoryRouter>);
beforeEach(()=>{sessionStorage.clear();profile.role='Staff';profile.uid='staff-1';});afterEach(cleanup);
it.each(['Staff','Admin'])('%s enters Medical directly and returns only with the correct password',(role)=>{
 profile.role=role;view();const button=screen.getByRole('button',{name:'Medical'});expect(button).toHaveAttribute('aria-pressed','false');fireEvent.change(screen.getByLabelText('Draft customer'),{target:{value:'regular draft'}});fireEvent.click(button);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(button).toHaveAttribute('aria-pressed','true');expect(screen.getByLabelText('Draft customer')).toHaveValue('');fireEvent.click(screen.getByRole('link',{name:'Payments'}));expect(screen.getByTestId('mode')).toHaveTextContent('medical');fireEvent.click(button);let dialog=screen.getByRole('dialog',{name:'Switch to Customers'});fireEvent.change(within(dialog).getByLabelText('Password'),{target:{value:'wrong'}});fireEvent.submit(dialog);expect(screen.getByRole('alert')).toHaveTextContent('Incorrect password.');expect(screen.getByTestId('mode')).toHaveTextContent('medical');fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(button);dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Password'),{target:{value:'1122'}});fireEvent.submit(dialog);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByTestId('mode')).toHaveTextContent('customer');
});
it('remembers Medical across refreshes and clears mode storage at logout',()=>{
 const first=view();fireEvent.click(screen.getByRole('button',{name:'Medical'}));first.unmount();view();expect(screen.getByTestId('mode')).toHaveTextContent('medical');clearSharedCustomerModes();cleanup();view();expect(screen.getByTestId('mode')).toHaveTextContent('customer');
});
it.each(['/analytics','/collections'])('does not show the switch on non-shared page %s',(route)=>{view(route);expect(screen.queryByRole('button',{name:'Medical'})).not.toBeInTheDocument();});

it('keeps native Enter submission in the password dialog',()=>{view();fireEvent.click(screen.getByRole('button',{name:'Medical'}));fireEvent.click(screen.getByRole('button',{name:'Medical'}));const input=screen.getByLabelText('Password'),cancel=screen.getByRole('button',{name:'Cancel'});Object.defineProperty(input,'offsetParent',{configurable:true,value:document.body});Object.defineProperty(cancel,'offsetParent',{configurable:true,value:document.body});input.focus();expect(fireEvent.keyDown(input,{key:'Enter',code:'Enter'})).toBe(true);expect(input).toHaveFocus();});
