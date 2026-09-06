import { ShoppingCart, Wallet } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';

const tileStyle = {
  border: '1px solid rgba(212,175,55,0.34)',
  borderRadius: 22,
  padding: 22,
  minHeight: 156,
  background: 'rgba(255,255,255,0.08)',
  color: '#FFFFFF',
  boxShadow: '0 18px 36px rgba(11,31,58,0.24)',
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  gap: 12,
  cursor: 'pointer',
  textAlign: 'center' as const
};

const CustomerLanding = () => {
  const navigate = useNavigate();
  const { openOrderApp, canOrder } = useCustomerPortalContext();

  if (!canOrder) {
    return <Navigate to="/customer/dashboard" replace />;
  }

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 190px)',
        margin: '-6px -2px 0',
        borderRadius: 28,
        padding: 22,
        background: 'var(--app-page-background)',
        display: 'grid',
        alignContent: 'center',
        gap: 18
      }}
    >
      <button type="button" onClick={openOrderApp} style={tileStyle}>
        <ShoppingCart size={38} color="#D4AF37" />
        <span style={{ fontSize: 26, fontWeight: 900 }}>Order</span>
      </button>
      <button type="button" onClick={() => navigate('/customer/dashboard')} style={tileStyle}>
        <Wallet size={38} color="#D4AF37" />
        <span style={{ fontSize: 26, fontWeight: 900 }}>Dashboard</span>
      </button>
    </div>
  );
};

export default CustomerLanding;
