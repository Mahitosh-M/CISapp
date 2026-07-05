import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import { useAuth } from '../contexts/AuthContext';
import { BONUS_PC_LABELS, generateBonusPcRequests, generateOverduePcRequests, getBonusPcRequests, getOverduePcRequests, reviewBonusPcRequest, reviewOverduePcRequest } from '../services/firestoreService';
import type { BonusPcRequest, OverduePcRequest } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import { formatPc } from '../utils/loyalty';
import { latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';

const OverduePcRequests = () => {
  const { userProfile } = useAuth();
  const [requests, setRequests] = useState<OverduePcRequest[]>([]);
  const [bonusRequests, setBonusRequests] = useState<BonusPcRequest[]>([]);
  const [coinEdits, setCoinEdits] = useState<Record<string, number>>({});
  const [bonusCoinEdits, setBonusCoinEdits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingBonus, setGeneratingBonus] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError('');
      const [rows, bonusRows] = await Promise.all([getOverduePcRequests(100), getBonusPcRequests(100)]);
      setRequests(rows);
      setBonusRequests(bonusRows);
      setCoinEdits(Object.fromEntries(rows.map((request) => [request.id, request.approvedCoins || request.suggestedCoins])));
      setBonusCoinEdits(Object.fromEntries(bonusRows.map((request) => [request.id, request.approvedCoins || request.suggestedCoins])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load overdue PC requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const pendingRequests = requests.filter((request) => request.status === 'Pending');
  const sortedPendingRequests = useMemo(() => sortNewestFirst(pendingRequests, ['generatedAt', 'reviewedAt']), [pendingRequests]);
  const approvedRequests = requests.filter((request) => request.status === 'Approved');
  const approvedCoins = approvedRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const pendingBonusRequests = bonusRequests.filter((request) => request.status === 'Pending');
  const sortedPendingBonusRequests = useMemo(() => sortNewestFirst(pendingBonusRequests, ['generatedAt', 'reviewedAt']), [pendingBonusRequests]);
  const approvedBonusRequests = bonusRequests.filter((request) => request.status === 'Approved');
  const approvedBonusCoins = approvedBonusRequests.reduce((sum, request) => sum + request.approvedCoins, 0);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setMessage('');
      setError('');
      const result = await generateOverduePcRequests(auditUser);
      setMessage(result.createdCount > 0 ? `${result.createdCount} overdue PC request(s) created.` : 'No new overdue PC requests found.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate overdue PC requests.');
    } finally {
      setGenerating(false);
    }
  };

  const handleReview = async (request: OverduePcRequest, status: 'Approved' | 'Rejected') => {
    try {
      setSavingId(request.id);
      setMessage('');
      setError('');
      await reviewOverduePcRequest(
        request.id,
        status,
        coinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins,
        auditUser,
        status === 'Approved' ? 'Approved by Admin' : 'Rejected by Admin'
      );
      setMessage(status === 'Approved' ? 'PC approved and added to customer balance.' : 'Overdue PC request rejected.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review overdue PC request.');
    } finally {
      setSavingId('');
    }
  };

  const handleGenerateBonus = async () => {
    try {
      setGeneratingBonus(true);
      setMessage('');
      setError('');
      const result = await generateBonusPcRequests(auditUser);
      setMessage(result.createdCount > 0 ? `${result.createdCount} bonus request(s) created.` : 'No new bonus requests found.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate bonus requests.');
    } finally {
      setGeneratingBonus(false);
    }
  };

  const handleBonusReview = async (request: BonusPcRequest, status: 'Approved' | 'Rejected') => {
    try {
      setSavingId(request.id);
      setMessage('');
      setError('');
      await reviewBonusPcRequest(
        request.id,
        status,
        bonusCoinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins,
        auditUser,
        status === 'Approved' ? 'Approved by Admin' : 'Rejected by Admin'
      );
      setMessage(status === 'Approved' ? 'Bonus PC approved and added to customer balance.' : 'Bonus request rejected.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review bonus request.');
    } finally {
      setSavingId('');
    }
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 1040,
    borderCollapse: 'collapse'
  };

  const thStyle: CSSProperties = {
    textAlign: 'left',
    padding: 12,
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4'
  };

  const tdStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid #E8EDF4',
    verticalAlign: 'top'
  };

  if (loading) {
    return <SectionHeader title="Overdue PC Requests" description="Loading overdue Partner Coin requests..." />;
  }

  return (
    <div>
      <SectionHeader title="Overdue PC Requests" description="Approve Partner Coins for invoices paid after the tier due date plus buffer days." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Pending Requests" value={`${pendingRequests.length}`} subtitle="Waiting for Admin review" color="#B7791F" />
        <StatCard title="Approved Requests" value={`${approvedRequests.length}`} subtitle="Already added to customer PC" />
        <StatCard title="Approved PC" value={formatPc(approvedCoins)} subtitle="Total approved Partner Coins" />
        <StatCard title="Bonus Requests" value={`${pendingBonusRequests.length}`} subtitle="Pending bonus approvals" color="#B7791F" />
        <StatCard title="Bonus PC" value={formatPc(approvedBonusCoins)} subtitle="Approved bonus Partner Coins" />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Request Queue</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              The generator checks recent paid invoices and skips requests already created for an invoice.
            </div>
          </div>
          <button type="button" disabled={generating} onClick={handleGenerate} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            {generating ? 'Generating...' : 'Generate Requests'}
          </button>
        </div>

        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Invoice', 'Due Date', 'Paid Date', 'Overdue', 'Invoice Amount', 'Suggested PC', 'Approved PC', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingRequests.length === 0 ? (
                <tr><td style={tdStyle} colSpan={10}>No pending overdue PC requests.</td></tr>
              ) : sortedPendingRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.invoiceNumber}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{request.invoiceDate ? formatDate(request.invoiceDate) : '-'}</div>
                  </td>
                  <td style={tdStyle}>{request.dueDate ? formatDate(request.dueDate) : '-'}</td>
                  <td style={tdStyle}>{request.fullPaymentDate ? formatDate(request.fullPaymentDate) : '-'}</td>
                  <td style={tdStyle}>{request.overdueDays} day(s)</td>
                  <td style={tdStyle}>{formatMoney(request.invoiceAmount)}</td>
                  <td style={tdStyle}>{formatPc(request.suggestedCoins)}</td>
                  <td style={tdStyle}>
                    {request.status === 'Pending' ? (
                      <input
                        type="number"
                        min="0"
                        value={coinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins}
                        onChange={(event) => setCoinEdits((current) => ({ ...current, [request.id]: Number(event.target.value) || 0 }))}
                        style={{ width: 96, padding: '8px 10px', borderRadius: 8, border: '1px solid #D8DEE9', boxSizing: 'border-box' }}
                      />
                    ) : formatPc(request.approvedCoins)}
                  </td>
                  <td style={{ ...tdStyle, color: request.status === 'Approved' ? '#166534' : request.status === 'Rejected' ? '#B42318' : '#B7791F', fontWeight: 900 }}>
                    {request.status}
                    {request.reviewedBy ? <div style={{ color: '#67738E', fontSize: 12 }}>{request.reviewedBy}</div> : null}
                  </td>
                  <td style={tdStyle}>
                    {request.status === 'Pending' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }} onClick={() => handleReview(request, 'Approved')}>
                          {savingId === request.id ? 'Saving...' : 'Approve'}
                        </button>
                        <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleReview(request, 'Rejected')}>
                          Reject
                        </button>
                      </div>
                    ) : 'Reviewed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Bonus Request Queue</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              Four bonus types are supported. Current automatic trigger creates New customer bonus requests after the first invoice, once per customer.
            </div>
          </div>
          <button type="button" disabled={generatingBonus} onClick={handleGenerateBonus} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            {generatingBonus ? 'Generating...' : 'Generate Bonus Requests'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {Object.values(BONUS_PC_LABELS).map((label) => (
            <span key={label} style={{ background: '#FFF7D6', color: '#0B1F3A', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900 }}>
              {label}
            </span>
          ))}
        </div>

        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Bonus', 'Trigger', 'Suggested PC', 'Approved PC', 'Generated', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingBonusRequests.length === 0 ? (
                <tr><td style={tdStyle} colSpan={8}>No pending bonus requests.</td></tr>
              ) : sortedPendingBonusRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.bonusLabel}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{request.notes || '-'}</div>
                  </td>
                  <td style={tdStyle}>{request.triggerType || '-'}</td>
                  <td style={tdStyle}>{formatPc(request.suggestedCoins)}</td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min="0"
                      value={bonusCoinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins}
                      onChange={(event) => setBonusCoinEdits((current) => ({ ...current, [request.id]: Number(event.target.value) || 0 }))}
                      style={{ width: 96, padding: '8px 10px', borderRadius: 8, border: '1px solid #D8DEE9', boxSizing: 'border-box' }}
                    />
                  </td>
                  <td style={tdStyle}>{request.generatedAt ? formatDate(request.generatedAt.slice(0, 10)) : '-'}</td>
                  <td style={{ ...tdStyle, color: '#B7791F', fontWeight: 900 }}>{request.status}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }} onClick={() => handleBonusReview(request, 'Approved')}>
                        {savingId === request.id ? 'Saving...' : 'Approve'}
                      </button>
                      <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleBonusReview(request, 'Rejected')}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OverduePcRequests;
