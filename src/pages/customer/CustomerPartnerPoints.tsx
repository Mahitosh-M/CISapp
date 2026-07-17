import { useState } from 'react';
import { Award, Wallet } from 'lucide-react';
import ExternalImage from '../../components/ExternalImage';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { createRedemptionRequest } from '../../services/firestoreService';
import { formatApc } from '../../utils/loyalty';
import { sortNewestFirst } from '../../utils/listDisplay';

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
  marginBottom: 12,
  background: '#F8F9FB'
};

const CustomerPartnerPoints = () => {
  const { customer, apcSummary, availableRewards, redemptionRequests, refreshData } = useCustomerPortalContext();
  const [redemptionMessage, setRedemptionMessage] = useState('');
  const [redemptionError, setRedemptionError] = useState('');
  const [requestingRewardId, setRequestingRewardId] = useState('');
  const latestRequestByRewardId = sortNewestFirst(redemptionRequests, ['reviewedAt', 'requestedAt']).reduce((requestMap, request) => {
    if (!requestMap.has(request.rewardId)) {
      requestMap.set(request.rewardId, request);
    }
    return requestMap;
  }, new Map<string, (typeof redemptionRequests)[number]>());

  const handleRewardRequest = async (rewardId: string) => {
    if (!customer) return;
    const reward = availableRewards.find((item) => item.id === rewardId);
    if (!reward) return;

    try {
      setRequestingRewardId(rewardId);
      setRedemptionError('');
      setRedemptionMessage('');
      await createRedemptionRequest(customer, reward);
      setRedemptionMessage('Reward request sent for approval.');
      await refreshData();
    } catch (err) {
      setRedemptionError(err instanceof Error ? err.message : 'Unable to request reward.');
    } finally {
      setRequestingRewardId('');
    }
  };

  return (
    <div>
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>Available Rewards</div>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 3 }}>
              {apcSummary?.rewardAvailable ? 'Some rewards are ready to request' : `You can view level rewards now; need ${formatApc(apcSummary?.pointsNeededForNextReward ?? 0)} more PC for the next request`}
            </div>
          </div>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: '#FFF7D6', color: '#0B1F3A', display: 'grid', placeItems: 'center' }}>
            <Wallet size={21} />
          </div>
        </div>
        {redemptionError ? <div style={{ color: '#B42318', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionError}</div> : null}
        {redemptionMessage ? <div style={{ color: '#166534', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionMessage}</div> : null}
        {availableRewards.length === 0 ? (
          <div style={{ color: '#67738E', fontSize: 13 }}>No rewards are available for your current partner level yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {availableRewards.map((reward) => {
              const rewardRequest = latestRequestByRewardId.get(reward.id);
              const hasEnoughApc = (apcSummary?.apcBalance ?? 0) >= reward.requiredPoints;
              const isRequested = rewardRequest?.status === 'Pending' || rewardRequest?.status === 'Approved';
              const isGifted = rewardRequest?.status === 'Gifted';
              const buttonText = isGifted ? 'Gifted' : isRequested ? 'Requested' : requestingRewardId === reward.id ? 'Sending' : 'Request';
              const isButtonDisabled = !hasEnoughApc || isRequested || isGifted || requestingRewardId === reward.id;

              return (
                <div key={reward.id} style={customerPromoCardStyle}>
                  {reward.imageUrl ? (
                    <ExternalImage
                      src={reward.imageUrl}
                      alt={reward.name}
                      style={customerPromoImageStyle}
                    />
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div style={{ color: '#FFFFFF', fontSize: 19, fontWeight: 900, lineHeight: 1.15 }}>{reward.name}</div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', background: '#FFF7D6', color: '#0B1F3A', borderRadius: 999, padding: '5px 9px', fontSize: 11, fontWeight: 900, marginTop: 7 }}>
                        {formatApc(reward.requiredPoints)} PC | {reward.levelRequired}
                      </div>
                      {reward.description ? <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 7, lineHeight: 1.45 }}>{reward.description}</div> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRewardRequest(reward.id)}
                      disabled={isButtonDisabled}
                      style={{
                        border: 0,
                        borderRadius: 999,
                        background: isGifted ? '#EAF7EE' : isRequested || !hasEnoughApc ? '#E8EDF4' : 'linear-gradient(135deg, #FFF7D6 0%, #D4AF37 70%, #B88912 100%)',
                        color: isGifted ? '#166534' : isRequested || !hasEnoughApc ? '#67738E' : '#0B1F3A',
                        padding: '10px 12px',
                        fontWeight: 900,
                        boxShadow: isRequested || !hasEnoughApc ? 'none' : '0 8px 18px rgba(212,175,55,0.28)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Award size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {buttonText}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default CustomerPartnerPoints;
