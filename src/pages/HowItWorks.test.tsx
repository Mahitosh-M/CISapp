// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
const identity = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: identity.role, userProfile: { role: identity.role }, firebaseUser: { uid: 'test' }, loading: false }) }));
vi.mock('../components/Layout', () => ({ default: () => <Outlet /> }));
vi.mock('../components/CustomerMobileLayout', () => ({ default: () => <Outlet /> }));
vi.mock('../components/SplashScreen', () => ({ default: () => null }));
vi.mock('./Login', () => ({ default: () => <h1>Sign in</h1> }));
vi.mock('./customer/CustomerDashboard', () => ({ default: () => <h1>Your dashboard</h1> }));
import App from '../App';
import HowItWorks from './HowItWorks';

beforeEach(() => { identity.role = 'Admin'; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const showGuide = () => render(<MemoryRouter><HowItWorks /></MemoryRouter>);
it('lets an Admin select workflow stages and keeps examples independent of business records', () => {
  showGuide();
  fireEvent.click(screen.getByRole('button', { name: /Build the daily route/ }));
  expect(screen.getByRole('heading', { name: 'Build the daily route' })).toBeInTheDocument();
  expect(screen.getByText(/Monday 9 November/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Complete next stop' }));
  expect(screen.getByRole('img', { name: 'Delivered: 1, Failed: 0, Remaining: 3' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('img', { name: 'Delivered: 0, Failed: 1, Remaining: 3' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(screen.getByRole('img', { name: 'Delivered: 0, Failed: 0, Remaining: 4' })).toBeInTheDocument();
});
it('plays, pauses and stops the walkthrough at the final step', () => {
  vi.useFakeTimers(); showGuide();
  fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
  act(() => { vi.advanceTimersByTime(6500); });
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  fireEvent.click(screen.getByRole('button', { name: 'Pause walkthrough' }));
  act(() => { vi.advanceTimersByTime(13000); });
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  fireEvent.click(screen.getByRole('button', { name: /Review collections/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
  act(() => { vi.advanceTimersByTime(6500); });
  expect(screen.getByRole('button', { name: 'Play walkthrough' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
it.each(['Admin','Staff','customer','Medical'])('protects the actual guide route for role %s', async role => {
  identity.role = role;
  render(<MemoryRouter initialEntries={['/how-it-works']}><App /></MemoryRouter>);
  if (role === 'Admin') expect(await screen.findByRole('heading', { name: 'How it works' }, { timeout: 3000 })).toBeInTheDocument();
  else {
    expect(await screen.findByRole('heading', { name: role === 'Staff' ? 'Sign in' : 'Your dashboard' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'How it works' })).not.toBeInTheDocument();
  }
});
