import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import { useIsMobile } from '../hooks/useIsMobile';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
  staffPermission?: 'canViewReports';
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/payments', label: 'Payments' },
  { to: '/intelligence', label: 'Intelligence' },
  { to: '/analytics', label: 'Analytics', adminOnly: true },
  { to: '/gifts', label: 'Gifts', adminOnly: true },
  { to: '/suggested-gifts', label: 'Suggested Gifts' },
  { to: '/reports', label: 'Reports', staffPermission: 'canViewReports' },
  { to: '/admin', label: 'Admin', adminOnly: true },
  { to: '/settings', label: 'Settings', adminOnly: true }
];

const Layout = () => {
  const { userProfile, logout } = useAuth();
  const { settings } = useAppSettings();
  const isMobile = useIsMobile();
  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly) return userProfile?.role === 'Admin';
    if (item.staffPermission === 'canViewReports') {
      return userProfile?.role === 'Admin' || settings.staffPermissions.canViewReports;
    }
    return true;
  });

  const sidebarStyle = {
    width: 260,
    minHeight: '100vh',
    background: '#0B1F3A',
    color: '#FFFFFF',
    padding: '24px 18px',
    boxSizing: 'border-box' as const
  };

  const linkStyle = {
    display: 'block',
    padding: '12px 16px',
    borderRadius: 12,
    color: '#D4AF37',
    textDecoration: 'none',
    marginBottom: 10
  };

  const activeLinkStyle = {
    background: '#162B4D',
    color: '#FFFFFF'
  };

  const headerStyle = {
    fontSize: 24,
    marginBottom: 32,
    fontWeight: 700
  };

  const layoutStyle = {
    display: 'flex',
    flexDirection: isMobile ? 'column' as const : 'row' as const,
    minHeight: '100vh',
    background: '#0B1F3A'
  };

  const contentStyle = {
    flexGrow: 1,
    background: '#0B1F3A',
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
    color: '#0B1F3A',
    background: '#F8F9FB',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap' as const
  };

  const activeMobileLinkStyle = {
    background: '#0B1F3A',
    color: '#FFFFFF'
  };

  return (
    <div style={layoutStyle}>
      {!isMobile ? (
        <aside style={sidebarStyle}>
          <div style={headerStyle}>Pharma ERP</div>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                ...linkStyle,
                ...(isActive ? activeLinkStyle : {})
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </aside>
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
              style={{ border: 0, borderRadius: 10, padding: isMobile ? '8px 10px' : '9px 12px', background: '#D4AF37', color: '#0B1F3A', fontWeight: 800, cursor: 'pointer' }}
            >
              Logout
            </button>
          </div>
        </div>
        <Outlet />
      </main>
      {isMobile ? (
        <nav style={mobileNavStyle}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
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
