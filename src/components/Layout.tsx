import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, BrainCircuit, Coins, CreditCard, FileText, Gift, Settings, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { useIsMobile } from '../hooks/useIsMobile';

interface NavItem {
  to: string;
  mobileTo?: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  staffPermission?: 'canViewReports';
}

const navItems: NavItem[] = [
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit, adminOnly: true },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, adminOnly: true },
  { to: '/loyalty', label: 'Loyalty', icon: Gift, adminOnly: true },
  { to: '/overdue-pc-requests', label: 'PC', icon: Coins, adminOnly: true },
  { to: '/reports', label: 'Reports', icon: SlidersHorizontal, staffPermission: 'canViewReports' },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true }
];

const Layout = () => {
  const { userProfile, logout } = useAuth();
  const { settings } = useAppSettings();
  const isMobile = useIsMobile();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly) return userProfile?.role === 'Admin';
    if (item.staffPermission === 'canViewReports') {
      return userProfile?.role === 'Admin' || settings.staffPermissions.canViewReports;
    }
    return true;
  });
  const mobilePriorityOrder = ['/invoices', '/payments', '/customers', '/'];
  const mobileNavItems = isMobile
    ? [
        ...mobilePriorityOrder.flatMap((path) => visibleNavItems.filter((item) => item.to === path)),
        ...visibleNavItems.filter((item) => !mobilePriorityOrder.includes(item.to))
      ]
    : visibleNavItems;
  const getNavPath = (item: NavItem) => (isMobile && item.mobileTo ? item.mobileTo : item.to);

  const sidebarStyle = {
    position: 'fixed' as const,
    inset: '0 auto 0 0',
    zIndex: 20,
    width: isSidebarExpanded ? 252 : 72,
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)',
    color: '#FFFFFF',
    padding: '20px 10px',
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
    boxShadow: isSidebarExpanded ? '18px 0 40px rgba(0,0,0,0.34)' : '8px 0 24px rgba(0,0,0,0.22)',
    transition: 'width 180ms ease, box-shadow 180ms ease'
  };

  const linkStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minHeight: 44,
    padding: '8px 14px',
    borderRadius: 12,
    color: '#D4AF37',
    textDecoration: 'none',
    marginBottom: 8,
    whiteSpace: 'nowrap' as const
  };

  const activeLinkStyle = {
    background: 'rgba(255,255,255,0.13)',
    color: '#FFFFFF',
    boxShadow: 'inset 3px 0 0 #D4AF37'
  };

  const headerStyle = {
    minHeight: 46,
    marginBottom: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 12px',
    color: '#D4AF37',
    whiteSpace: 'nowrap' as const
  };

  const layoutStyle = {
    display: 'flex',
    flexDirection: isMobile ? 'column' as const : 'row' as const,
    minHeight: '100vh',
    background: 'var(--app-page-background)'
  };

  const contentStyle = {
    flexGrow: 1,
    background: 'var(--app-page-background)',
    padding: isMobile ? '14px 12px 92px' : 24,
    minWidth: 0
  };

  const topBarStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: isMobile ? 'flex-start' as const : 'center' as const,
    gap: 12,
    marginBottom: isMobile ? 16 : 24,
    color: '#FFFFFF',
    flexWrap: 'wrap' as const
  };

  const titleStyle = {
    fontSize: isMobile ? 17 : 20,
    fontWeight: 700
  };

  const mobileNavStyle = {
    position: 'fixed' as const,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    display: 'flex',
    gap: 8,
    overflowX: 'auto' as const,
    padding: '9px 10px 12px',
    background: '#FFFFFF',
    borderTop: '1px solid #D8DEE9',
    boxShadow: '0 -12px 24px rgba(11,31,58,0.14)'
  };

  const mobileLinkStyle = {
    flex: '0 0 auto',
    padding: '9px 11px',
    borderRadius: 10,
    color: '#11185A',
    background: '#F8F9FB',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap' as const
  };

  const activeMobileLinkStyle = {
    background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)',
    color: '#FFFFFF'
  };

  return (
    <div style={layoutStyle}>
      {!isMobile ? (
        <div style={{ width: 72, flex: '0 0 72px' }}>
          <aside
            style={sidebarStyle}
            onMouseEnter={() => setIsSidebarExpanded(true)}
            onMouseLeave={() => setIsSidebarExpanded(false)}
          >
            <div style={headerStyle} title="Pharma ERP">
              <ShieldCheck size={24} style={{ flex: '0 0 auto' }} />
              <span style={{ opacity: isSidebarExpanded ? 1 : 0, transition: 'opacity 120ms ease', fontSize: 20, fontWeight: 900 }}>Pharma ERP</span>
            </div>
            {mobileNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={getNavPath(item)}
                  to={getNavPath(item)}
                  end={item.to === '/'}
                  title={!isSidebarExpanded ? item.label : undefined}
                  onClick={() => setIsSidebarExpanded(false)}
                  style={({ isActive }) => ({
                    ...linkStyle,
                    ...(isActive ? activeLinkStyle : {})
                  })}
                >
                  <Icon size={21} style={{ flex: '0 0 auto' }} />
                  <span style={{ opacity: isSidebarExpanded ? 1 : 0, transition: 'opacity 120ms ease' }}>{item.label}</span>
                </NavLink>
              );
            })}
          </aside>
        </div>
      ) : null}
      <main style={contentStyle}>
        <div style={topBarStyle}>
          <div>
            <div style={titleStyle}>Customer Intelligence ERP</div>
            <div style={{ color: '#BFC8D9', marginTop: 4, fontSize: isMobile ? 12 : 14 }}>Pharma wholesale + retail insights</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: isMobile ? 0 : 'auto' }}>
            <div style={{ color: '#D4AF37', fontWeight: 700 }}>{userProfile?.role ?? 'User'}</div>
            <button
              type="button"
              onClick={logout}
              style={{ border: 0, borderRadius: 10, padding: isMobile ? '8px 10px' : '9px 12px', background: '#D4AF37', color: '#11185A', fontWeight: 800, cursor: 'pointer' }}
            >
              Logout
            </button>
          </div>
        </div>
        <Outlet />
      </main>
      {isMobile ? (
        <nav style={mobileNavStyle}>
          {mobileNavItems.map((item) => (
            <NavLink
              key={getNavPath(item)}
              to={getNavPath(item)}
              end={getNavPath(item) === '/'}
              style={({ isActive }) => ({
                ...mobileLinkStyle,
                ...(isActive ? activeMobileLinkStyle : {})
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
};

export default Layout;
