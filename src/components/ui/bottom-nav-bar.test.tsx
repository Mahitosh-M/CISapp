import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Home, Wallet, FileText, Gift, Tags } from 'lucide-react';
import BottomNavBar, { type BottomNavItem } from './bottom-nav-bar';

const items: BottomNavItem[] = [
  { to: '/customer', label: 'Home', icon: Home, end: true },
  { to: '/customer/dashboard', label: 'Dashboard', icon: Wallet },
  { to: '/customer/invoices', label: 'Invoices', icon: FileText },
  { to: '/customer/partner-points', label: 'Rewards', icon: Gift },
  { to: '/customer/offers', label: 'Offers', icon: Tags }
];
const render = (location: string, visibleItems = items) => renderToStaticMarkup(
  <StaticRouter location={location}><BottomNavBar items={visibleItems} stickyBottom ariaLabel="Customer navigation" /></StaticRouter>
);

describe('customer pill navigation', () => {
  it.each(items)('uses the URL for the active $label destination', (item) => {
    const html = render(item.to!);
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors).toHaveLength(5);
    const current = anchors.filter((anchor) => anchor.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="${item.to}"`);
    expect(current[0]).toContain(`aria-label="${item.label}"`);
    expect(current[0]).toContain('is-active');
  });

  it('keeps Invoices active on nested invoice pages and Home inactive', () => {
    const anchors = render('/customer/invoices/example').match(/<a\b[^>]*>/g) ?? [];
    const current = anchors.filter((anchor) => anchor.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/customer/invoices"');
  });

  it('renders only supplied routes when order Home is unavailable', () => {
    const html = render('/customer/offers', items.slice(1));
    expect(html.match(/<a\b/g)).toHaveLength(4);
    expect(html).not.toContain('href="/customer"');
    expect(html).toContain('aria-label="Customer navigation"');
    expect(html).toContain('cis-bottom-nav-sticky');
  });
});
