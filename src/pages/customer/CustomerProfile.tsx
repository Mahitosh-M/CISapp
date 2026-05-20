import { User } from 'lucide-react';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';

const CustomerProfile = () => {
  const { customer, userProfile, settings } = useCustomerPortalContext();

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 14 }}>My Profile</div>
      <div style={{ background: '#FFFFFF', borderRadius: 22, padding: 18, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
        <div style={{ width: 58, height: 58, borderRadius: 18, background: '#FFF7D6', color: '#0B1F3A', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
          <User size={28} />
        </div>
        <div style={{ fontSize: 21, fontWeight: 900 }}>{customer?.name || userProfile?.customerName || 'Customer'}</div>
        <div style={{ color: '#67738E', marginTop: 4 }}>{userProfile?.email}</div>

        {settings.showCustomerTierToCustomer && customer ? (
          <div style={{ background: '#0B1F3A', color: '#D4AF37', borderRadius: 16, padding: 12, fontWeight: 900, marginTop: 16 }}>
            Customer Category: {customer.tier}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <div>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 900 }}>Mobile</div>
            <div style={{ fontWeight: 900 }}>{customer?.mobile || '-'}</div>
          </div>
          <div>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 900 }}>Area</div>
            <div style={{ fontWeight: 900 }}>{customer?.area || '-'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerProfile;
