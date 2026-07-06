import { useState } from 'react';
import { Award } from 'lucide-react';
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
  const latestRedemption = sortNewestFirst(redemptionRequests, ['reviewedAt', 'requestedAt'])[0];
  const latestRequestByRewardId = sortNewestFirst(redemptionRequests, ['reviewedAt', 'requestedAt']).reduce((requestMap, request) => {
    if (!requestMap.has(request.rewardId)) {
      requestMap.set(request.rewardId, request);
    }
    return requestMap;
  }, new Map<string, (typeof redemptionRequests)[number]>());
  const progressPercent = apcSummary?.progressPercent ?? 0;
  const progressDegrees = Math.round((progressPercent / 100) * 360);

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
      <section style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18 }}>Partner Points</div>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Rewards and partner level</div>
          </div>
          <Award size={26} color="#0B1F3A" />
        </div>

        {apcSummary ? (
          <>
            <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 16px' }}>
              <div
                style={{
                  width: 168,
                  height: 168,
                  borderRadius: '50%',
                  background: `conic-gradient(#166534 0deg ${progressDegrees}deg, #DC2626 ${progressDegrees}deg 360deg)`,
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: '0 14px 30px rgba(11,31,58,0.12)'
                }}
              >
                <div style={{ width: 118, height: 118, borderRadius: '50%', background: '#FFFFFF', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 10, boxSizing: 'border-box' }}>
                  <div>
                    <div style={{ color: '#166534', fontSize: 30, fontWeight: 900, lineHeight: 1 }}>{progressPercent}%</div>
                    <div style={{ color: '#67738E', fontSize: 11, fontWeight: 900, marginTop: 5 }}>to next level</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 12, fontWeight: 900 }}>
                <span style={{ color: '#166534' }}>Green achieved</span>
                <span style={{ color: '#DC2626' }}>Red remaining</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Current Level</div>
                <div style={{ fontWeight: 900 }}>{apcSummary.currentLevel}</div>
              </div>
              <div>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>PC Balance</div>
                <div style={{ color: '#166534', fontWeight: 900 }}>{formatApc(apcSummary.apcBalance)}</div>
              </div>
              <div>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>This Month Earned PC</div>
                <div style={{ fontWeight: 900 }}>You earned {formatApc(apcSummary.monthlyApcEarned)} PC</div>
              </div>
              <div>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Reward Status</div>
                <div style={{ fontWeight: 900 }}>{latestRedemption ? latestRedemption.status : 'No request'}</div>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#67738E', fontWeight: 800, marginBottom: 5 }}>
                <span>Next Level</span>
                <span>{apcSummary.nextLevel || 'Top level'}</span>
              </div>
              <div style={{ height: 9, borderRadius: 999, background: '#E8EDF4', overflow: 'hidden' }}>
                <div style={{ width: `${progressPercent}%`, height: '100%', background: '#166534' }} />
              </div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 6 }}>
                {apcSummary.nextLevel ? `${formatApc(apcSummary.pointsNeededForNextLevel)} more score points needed for ${apcSummary.nextLevel}` : 'You are already at the highest partner level.'}
              </div>
            </div>

            <div style={{ color: apcSummary.rewardAvailable ? '#166534' : '#B42318', fontSize: 12, fontWeight: 900 }}>
              {apcSummary.rewardAvailable ? 'Reward available' : `You need ${formatApc(apcSummary.pointsNeededForNextReward)} more PC to unlock your next reward.`}
            </div>
          </>
        ) : (
          <div style={{ color: '#67738E', fontSize: 13, lineHeight: 1.5 }}>Your Partner Points will appear after your account refreshes.</div>
        )}
      </section>

      <section style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Available Rewards</div>
        {redemptionError ? <div style={{ color: '#B42318', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionError}</div> : null}
        {redemptionMessage ? <div style={{ color: '#166534', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionMessage}</div> : null}
        {availableRewards.length === 0 ? (
          <div style={{ color: '#67738E', fontSize: 13 }}>No rewards available for your current points yet.</div>
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
