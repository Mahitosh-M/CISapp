import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, BrainCircuit, Coins, CreditCard, FileText, Gift, Landmark, Settings, ShieldCheck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

interface NavItem {
  to: string;
  mobileTo?: string;
  label: string;
  icon: LucideIcon;
  mobileColor: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/customers', label: 'Customers', icon: Users, mobileColor: '#67E8F9' },
  { to: '/invoices', label: 'Invoices', icon: FileText, mobileColor: '#86EFAC' },
  { to: '/payments', label: 'Payments', icon: CreditCard, mobileColor: '#FDE047' },
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit, mobileColor: '#C4B5FD', adminOnly: true },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, mobileColor: '#93C5FD', adminOnly: true },
  { to: '/loyalty', label: 'Loyalty', icon: Gift, mobileColor: '#FDA4AF', adminOnly: true },
  { to: '/overdue-pc-requests', label: 'PC', icon: Coins, mobileColor: '#FCD34D', adminOnly: true },
  { to: '/credit', label: 'Credit', icon: Landmark, mobileColor: '#5EEAD4', adminOnly: true },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, mobileColor: '#FDBA74', adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, mobileColor: '#CBD5E1', adminOnly: true }
];

const Layout = () => {
  const { userProfile, logout } = useAuth();
  const isMobile = useIsMobile();
  const isStaffMobile = isMobile && userProfile?.role === 'Staff';
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly) return userProfile?.role === 'Admin';
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
    gap: isStaffMobile ? 6 : 8,
    overflowX: 'auto' as const,
    padding: isStaffMobile ? '8px 8px 10px' : '9px 10px 12px',
    background: isStaffMobile
      ? 'linear-gradient(135deg, #071A33 0%, #020B18 58%, #000000 100%)'
      : '#FFFFFF',
    borderTop: isStaffMobile ? '1px solid #163A63' : '1px solid #D8DEE9',
    boxShadow: isStaffMobile
      ? '0 -12px 28px rgba(0,0,0,0.48)'
      : '0 -12px 24px rgba(11,31,58,0.14)'
  };

  const mobileLinkStyle = {
    flex: isStaffMobile ? '1 1 0' : '0 0 auto',
    minWidth: isStaffMobile ? 68 : undefined,
    minHeight: isStaffMobile ? 54 : undefined,
    padding: isStaffMobile ? '7px 5px' : '9px 11px',
    borderRadius: isStaffMobile ? 8 : 10,
    border: isStaffMobile ? '1px solid #153555' : 'none',
    color: isStaffMobile ? '#FFFFFF' : '#11185A',
    background: isStaffMobile
      ? 'linear-gradient(145deg, #02060D 0%, #071A33 100%)'
      : '#F8F9FB',
    textDecoration: 'none',
    fontSize: isStaffMobile ? 10 : 12,
    fontWeight: 900,
    whiteSpace: 'nowrap' as const,
    display: isStaffMobile ? 'flex' : undefined,
    flexDirection: isStaffMobile ? 'column' as const : undefined,
    alignItems: isStaffMobile ? 'center' : undefined,
    justifyContent: isStaffMobile ? 'center' : undefined,
    gap: isStaffMobile ? 3 : undefined,
    boxSizing: 'border-box' as const
  };

  const activeMobileLinkStyle = {
    background: isStaffMobile
      ? 'linear-gradient(145deg, #050A12 0%, #0B2B50 100%)'
      : 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)',
    color: '#FFFFFF',
    borderColor: isStaffMobile ? '#3B82F6' : undefined,
    boxShadow: isStaffMobile ? 'inset 0 0 0 1px rgba(96,165,250,0.28)' : undefined
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
            <div style={headerStyle} title="ERP">
              <ShieldCheck size={24} style={{ flex: '0 0 auto' }} />
              <span style={{ opacity: isSidebarExpanded ? 1 : 0, transition: 'opacity 120ms ease', fontSize: 20, fontWeight: 900 }}>ERP</span>
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
            <div style={titleStyle}>COINS</div>
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
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={getNavPath(item)}
                to={getNavPath(item)}
                end={getNavPath(item) === '/'}
                style={({ isActive }) => ({
                  ...mobileLinkStyle,
                  ...(isActive ? activeMobileLinkStyle : {})
                })}
              >
                {isStaffMobile ? (
                  <>
                    <Icon size={22} color={item.mobileColor} strokeWidth={2.4} />
                    <span style={{ color: item.mobileColor }}>{item.label}</span>
                  </>
                ) : item.label}
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
};

export default Layout;
