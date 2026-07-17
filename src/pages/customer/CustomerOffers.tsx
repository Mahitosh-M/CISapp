import { CalendarDays, Tags } from 'lucide-react';
import { useMemo } from 'react';
import ExternalImage from '../../components/ExternalImage';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { getOfferDateRangeLabel, isOfferCurrentlyActive, sortOffersByLatest } from '../../utils/offers';

const customerPromoCardStyle = {
  background: 'linear-gradient(145deg, #0B1F3A 0%, #12345A 100%)',
  border: '1px solid rgba(212,175,55,0.32)',
  borderRadius: 18,
  padding: 14,
  boxShadow: '0 14px 30px rgba(11,31,58,0.24)',
  overflow: 'hidden'
};

const customerPromoImageStyle = {
  width: '100%',
  height: 'auto',
  maxHeight: 260,
  objectFit: 'contain' as const,
  borderRadius: 14,
  display: 'block',
  background: '#F8F9FB'
};

const CustomerOffers = () => {
  const { offers } = useCustomerPortalContext();
  const activeOffers = useMemo(() => {
    // Inactive offer filtering: customer carousel only shows currently active offers.
    return sortOffersByLatest(offers.filter((offer) => isOfferCurrentlyActive(offer)));
  }, [offers]);

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Offers</div>
      <div style={{ color: '#67738E', fontSize: 13, marginBottom: 14 }}>Latest active schemes from the business.</div>

      {activeOffers.length === 0 ? (
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
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: 12 }}>
          {activeOffers.map((offer) => (
            <div key={offer.id} style={{ ...customerPromoCardStyle, minWidth: '85%', scrollSnapAlign: 'start' }}>
              {offer.imageUrl ? (
                <ExternalImage src={offer.imageUrl} alt={offer.title} style={customerPromoImageStyle} />
              ) : (
                <div style={{ background: '#FFF7D6', borderRadius: 14, minHeight: 170, display: 'grid', placeItems: 'center', color: '#0B1F3A', fontWeight: 900 }}>
                  Offer poster will appear here
                </div>
              )}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#FFF7D6', color: '#0B1F3A', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 900, marginTop: 12 }}>
                <Tags size={14} color="#D4AF37" />
                Active Offer
              </div>
              <div style={{ color: '#FFFFFF', fontWeight: 900, fontSize: 20, marginTop: 10 }}>{offer.title}</div>
              {offer.description ? <div style={{ color: '#D7DEEA', marginTop: 8, lineHeight: 1.5 }}>{offer.description}</div> : null}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'linear-gradient(135deg, #FFF7D6, #D4AF37)', color: '#0B1F3A', borderRadius: 999, padding: '7px 11px', fontSize: 12, fontWeight: 900, marginTop: 12, boxShadow: '0 8px 18px rgba(212,175,55,0.22)' }}>
                <CalendarDays size={14} color="#0B1F3A" />
                Valid: {getOfferDateRangeLabel(offer)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerOffers;
