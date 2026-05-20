import { Tags } from 'lucide-react';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';

const CustomerOffers = () => {
  const { offers } = useCustomerPortalContext();

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Offers</div>
      <div style={{ color: '#67738E', fontSize: 13, marginBottom: 14 }}>Latest active schemes from the business.</div>

      {offers.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, color: '#67738E' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 900, color: '#0B1F3A' }}>
            <Tags size={18} color="#D4AF37" />
            No active offers
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            Future improvement: Admin can upload offer poster images to Firebase Storage and save the image URL in Firestore.
          </div>
        </div>
      ) : (
        offers.map((offer) => (
          <div key={offer.id} style={{ background: '#FFFFFF', borderRadius: 20, padding: 14, marginBottom: 12, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 900 }}>
              <Tags size={18} color="#D4AF37" />
              {offer.title}
            </div>
            {offer.imageUrl ? (
              <img src={offer.imageUrl} alt={offer.title} style={{ width: '100%', borderRadius: 16, marginTop: 12 }} />
            ) : (
              <div style={{ background: '#FFF7D6', borderRadius: 16, minHeight: 140, display: 'grid', placeItems: 'center', marginTop: 12, color: '#0B1F3A', fontWeight: 900 }}>
                Offer poster will appear here
              </div>
            )}
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 10 }}>{offer.startDate || 'Open'} to {offer.endDate || 'Open'}</div>
          </div>
        ))
      )}
    </div>
  );
};

export default CustomerOffers;
