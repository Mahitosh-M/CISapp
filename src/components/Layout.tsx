import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/payments', label: 'Payments' },
  { to: '/intelligence', label: 'Intelligence' },
  { to: '/analytics', label: 'Analytics', adminOnly: true },
  { to: '/gifts', label: 'Gifts', adminOnly: true },
  { to: '/reports', label: 'Reports', adminOnly: true },
  { to: '/settings', label: 'Settings', adminOnly: true }
];

const Layout = () => {
  const { userProfile, logout } = useAuth();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || userProfile?.role === 'Admin');

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
    minHeight: '100vh'
  };

  const contentStyle = {
    flexGrow: 1,
    background: '#0B1F3A',
    padding: 24
  };

  const topBarStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    color: '#FFFFFF'
  };

  const titleStyle = {
    fontSize: 20,
    fontWeight: 700
  };

  return (
    <div style={layoutStyle}>
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
      <main style={contentStyle}>
        <div style={topBarStyle}>
          <div>
            <div style={titleStyle}>Customer Intelligence ERP</div>
            <div style={{ color: '#BFC8D9', marginTop: 4 }}>Pharma wholesale + retail insights</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ color: '#D4AF37', fontWeight: 700 }}>{userProfile?.role ?? 'User'}</div>
            <button
              type="button"
              onClick={logout}
              style={{ border: 0, borderRadius: 10, padding: '9px 12px', background: '#D4AF37', color: '#0B1F3A', fontWeight: 800, cursor: 'pointer' }}
            >
              Logout
            </button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
