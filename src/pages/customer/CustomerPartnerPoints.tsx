import { useState } from 'react';
import { Award, Wallet } from 'lucide-react';
import ExternalImage from '../../components/ExternalImage';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { createRedemptionRequest } from '../../services/firestoreService';
import { formatApc } from '../../utils/loyalty';
import { sortNewestFirst } from '../../utils/listDisplay';

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
      <section style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 900 }}>Available Rewards</div>
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
                <div key={reward.id} style={{ border: '1px solid #E8EDF4', borderRadius: 12, padding: 10 }}>
                  {reward.imageUrl ? (
                    <ExternalImage
                      src={reward.imageUrl}
                      alt={reward.name}
                      style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 12, display: 'block', marginBottom: 10 }}
                    />
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{reward.name}</div>
                      <div style={{ color: '#67738E', fontSize: 12 }}>{formatApc(reward.requiredPoints)} PC | {reward.levelRequired}</div>
                      {reward.description ? <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>{reward.description}</div> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRewardRequest(reward.id)}
                      disabled={isButtonDisabled}
                      style={{
                        border: 0,
                        borderRadius: 10,
                        background: isGifted ? '#EAF7EE' : isRequested || !hasEnoughApc ? '#E8EDF4' : '#D4AF37',
                        color: isGifted ? '#166534' : isRequested || !hasEnoughApc ? '#67738E' : '#0B1F3A',
                        padding: '8px 10px',
                        fontWeight: 900
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
