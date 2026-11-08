import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { PaymentProposal, AppConfig } from '../types.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { FlagList } from '../components/FlagList.js';

interface ProposalDetailPageProps {
  config: AppConfig | null;
}

export const ProposalDetailPage: React.FC<ProposalDetailPageProps> = ({ config }) => {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<PaymentProposal | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Approval Form State
  const [callbackChecked, setCallbackChecked] = useState(false);
  const [callbackNote, setCallbackNote] = useState('');
  const [typedAmount, setTypedAmount] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [submittingSimulation, setSubmittingSimulation] = useState(false);
  const [countryRestrictedError, setCountryRestrictedError] = useState<{ message: string; debugId?: string } | null>(null);

  // Rejection Form State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);
  const [blockSenderDomain, setBlockSenderDomain] = useState(false);
  const [blockPayeeIdentifiers, setBlockPayeeIdentifiers] = useState(false);
  const [sendingConfirmation, setSendingConfirmation] = useState(false);

  const loadProposal = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await api.getProposal(id);
      setProposal(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load proposal');
    } finally {
      setLoading(false);
    }
  };

  const handleSendConfirmation = async () => {
    if (!proposal) return;
    setError(null);
    setSendingConfirmation(true);
    try {
      const res = await api.sendConfirmation(proposal.id);
      setSuccessMsg(
        `Confirmation dispatched to ${res.sentTo} (${res.mode === 'demo_outbox' ? 'Demo Outbox mode' : 'SMTP'}).`
      );
      await loadProposal();
    } catch (err: any) {
      setError(err.message || 'Failed to send confirmation');
    } finally {
      setSendingConfirmation(false);
    }
  };

  const handlePollStatus = async () => {
    if (!id) return;
    try {
      const polled = await api.pollProposal(id);
      setProposal(polled);
      if (polled.status === 'PAID') {
        setSuccessMsg('PayPal confirmed payout status: PAID!');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadProposal();
    api.checkAuth().then(res => {
      if (res.authenticated && res.user) {
        setCurrentUser(res.user);
      }
    }).catch(() => {});
  }, [id]);

  const handleBypassCoolingOff = async () => {
    if (!proposal) return;
    setError(null);
    try {
      const updated = await api.bypassCoolingOff(proposal.id);
      setProposal(updated);
      setSuccessMsg('Cooling-off period bypassed (Demo fast-forward).');
    } catch (err: any) {
      setError(err.message || 'Failed to bypass cooling-off');
    }
  };

  // Auto-poll if in PAYING status
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (proposal && proposal.status === 'PAYING') {
      timer = setInterval(() => {
        handlePollStatus();
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [proposal?.status]);

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center' }}>Loading payment proposal details...</div>;
  }

  if (error || !proposal) {
    return (
      <div className="card">
        <div className="badge badge-danger" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
          {error || 'Proposal not found'}
        </div>
        <Link to="/" className="btn btn-outline">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const isHold = proposal.verdict === 'HOLD';
  const isVendorConfirmed = proposal.confirmation?.status === 'CONFIRMED';
  const approvalLimit = config?.approvalLimit || 500;
  const hardLimit = config?.hardLimit || 5000;
  const exceedsApprovalLimit = proposal.amount > approvalLimit;
  const exceedsHardLimit = proposal.amount > hardLimit || proposal.isHardBlocked;

  const isSameApprover = Boolean(
    proposal.requiresDualApproval &&
    proposal.firstApprover &&
    !proposal.secondApprover &&
    currentUser &&
    currentUser.toLowerCase() === proposal.firstApprover.toLowerCase()
  );

  const isCoolingOffActive = Boolean(
    proposal.coolingOffUntil &&
    !proposal.coolingOffBypassed &&
    new Date(proposal.coolingOffUntil).getTime() > Date.now()
  );

  // Validate if approver can click Approve button
  const canApprove =
    proposal.status === 'PENDING_REVIEW' &&
    !exceedsHardLimit &&
    !isSameApprover &&
    !isCoolingOffActive &&
    (!isHold || isVendorConfirmed || (callbackChecked && callbackNote.trim().length >= 5)) &&
    (!exceedsApprovalLimit || parseFloat(typedAmount) === proposal.amount);

  const handleApprove = async () => {
    if (!canApprove) return;
    setError(null);
    setCountryRestrictedError(null);
    setSubmittingApproval(true);

    try {
      const updated = await api.approveProposal(proposal.id, {
        callbackConfirmed: callbackChecked,
        callbackNote: callbackNote.trim(),
        typedAmountConfirmation:
          exceedsApprovalLimit && typedAmount.trim() ? parseFloat(typedAmount) : undefined,
        approvalNote: approvalNote.trim()
      });

      setProposal(updated);
      if (updated.status === 'PENDING_REVIEW' && updated.firstApprover) {
        setSuccessMsg(`First approval recorded by ${updated.firstApprover} (1/2). Awaiting second approver.`);
      } else {
        setSuccessMsg(`Payout batch ${updated.paypalBatchId || ''} submitted to PayPal.`);
      }
    } catch (err: any) {
      if (
        err.status === 403 ||
        err.countryRestricted ||
        err.name === 'PAYOUT_NOT_AVAILABLE' ||
        err.message?.includes('PAYOUT_NOT_AVAILABLE')
      ) {
        const debugId =
          err.debug_id ||
          err.data?.debug_id ||
          err.message?.match(/debug_id["':\s]+([a-zA-Z0-9]+)/i)?.[1];
        setCountryRestrictedError({
          message:
            'PayPal rejected this payout: The sandbox sender account is registered in a country not permitted to send payouts (403 PAYOUT_NOT_AVAILABLE).',
          debugId
        });
        await loadProposal();
      } else {
        setError(err.message || 'Approval failed');
      }
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleSimulatePayout = async () => {
    if (!proposal) return;
    setError(null);
    setSubmittingSimulation(true);
    try {
      const updated = await api.simulatePayout(proposal.id);
      setProposal(updated);
      setCountryRestrictedError(null);
      setSuccessMsg('Simulated payout executed successfully in Mock mode (Simulated).');
    } catch (err: any) {
      setError(err.message || 'Failed to simulate payout');
    } finally {
      setSubmittingSimulation(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setError(null);
    setSubmittingReject(true);

    try {
      const updated = await api.rejectProposal(proposal.id, rejectReason.trim(), {
        blockSenderDomain,
        blockPayeeIdentifiers
      });
      setProposal(updated);
      setShowRejectModal(false);
      setSuccessMsg('Proposal marked REJECTED and security policies updated.');
    } catch (err: any) {
      setError(err.message || 'Rejection failed');
    } finally {
      setSubmittingReject(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <Link to="/" style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          ← Back to Dashboard
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Payment Proposal #{proposal.id}</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              className={`badge ${
                proposal.verdict === 'HOLD'
                  ? 'badge-hold'
                  : proposal.verdict === 'CHECK'
                  ? 'badge-check'
                  : 'badge-clear'
              }`}
            >
              {proposal.verdict}
            </span>
            <StatusBadge status={proposal.status} batchId={proposal.paypalBatchId} />
            {proposal.requiresDualApproval && (
              <span
                className="badge"
                style={{
                  backgroundColor: proposal.secondApprover ? '#dcfce7' : '#fef3c7',
                  color: proposal.secondApprover ? '#16a34a' : '#92400e',
                  fontWeight: 700,
                  border: '1px solid currentColor'
                }}
              >
                Dual Approval: {proposal.secondApprover ? '2/2' : proposal.firstApprover ? '1/2' : '0/2'}
              </span>
            )}
          </div>
        </div>
      </div>

      {proposal.status === 'PAID' && (proposal.paypalBatchId?.startsWith('SIMULATED-') || proposal.paypalBatchId?.startsWith('MOCK-BATCH-')) && (
        <div style={{ padding: '1rem 1.25rem', backgroundColor: '#eff6ff', border: '2px solid #3b82f6', borderRadius: 'var(--radius)', marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
          <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e40af', letterSpacing: '0.025em' }}>
              SIMULATED PAYOUT (DEMO MODE)
            </div>
            <div style={{ fontSize: '0.875rem', color: '#1e3a8a', marginTop: '0.35rem', lineHeight: 1.5 }}>
              This payment was executed in safe simulated mode using <strong>MockPayPalClient</strong>. No live PayPal funds were transferred because the real PayPal Sandbox account is country-restricted (403 PAYOUT_NOT_AVAILABLE).
            </div>
            <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
              <div>
                <span style={{ color: '#4b5563' }}>Transaction Reference:</span>{' '}
                <code style={{ backgroundColor: '#dbeafe', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 700, color: '#1d4ed8' }}>
                  {proposal.paypalBatchId}
                </code>
              </div>
              {proposal.paypalPayoutItemId && (
                <div>
                  <span style={{ color: '#4b5563' }}>Item Reference:</span>{' '}
                  <code style={{ backgroundColor: '#dbeafe', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: 600, color: '#1d4ed8' }}>
                    {proposal.paypalPayoutItemId}
                  </code>
                </div>
              )}
              <div>
                <span style={{ color: '#4b5563' }}>Audit Action:</span>{' '}
                <span style={{ fontWeight: 700, color: '#16a34a' }}>PAYMENT_SIMULATED</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {(countryRestrictedError || (proposal.status === 'FAILED' && proposal.rejectionReason?.includes('PAYOUT_NOT_AVAILABLE'))) && (
        <div style={{ padding: '1.25rem', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: 'var(--radius)', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>🚫</span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#991b1b' }}>
                PayPal Payout Rejected: Sender Account Country Restricted (403 PAYOUT_NOT_AVAILABLE)
              </h3>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#7f1d1d' }}>
                PayPal has rejected this payout because the sender account associated with your REST API credentials is not eligible to send payouts in its registered country.
              </p>
              {(countryRestrictedError?.debugId || proposal.rejectionReason?.match(/debug_id:\s*([a-zA-Z0-9]+)/i)?.[1]) && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#991b1b' }}>
                  <strong>PayPal Debug ID:</strong>{' '}
                  <code style={{ backgroundColor: '#fee2e2', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {countryRestrictedError?.debugId || proposal.rejectionReason?.match(/debug_id:\s*([a-zA-Z0-9]+)/i)?.[1]}
                  </code>
                </div>
              )}
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#fff', border: '1px solid #fecaca', borderRadius: '4px', fontSize: '0.8rem', color: '#374151' }}>
                ✓ <strong>Human Approval Preserved:</strong> All approver signatures ({proposal.firstApprover}{proposal.secondApprover ? `, ${proposal.secondApprover}` : ''}) and validation checks remain intact. The proposal is marked <code>FAILED</code> to prevent accidental duplicates.
              </div>
              {proposal.status !== 'PAID' && (
                <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                    onClick={handleSimulatePayout}
                    disabled={submittingSimulation}
                  >
                    {submittingSimulation ? 'Simulating...' : '⚡ Demonstrate via Mock Payout (Simulated)'}
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                    Allows live hackathon evaluation without PayPal outbound payout permissions.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="badge badge-success" style={{ width: '100%', padding: '0.75rem', marginBottom: '1.25rem' }}>
          {successMsg}
        </div>
      )}

      {error && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1.25rem' }}>
          {error}
        </div>
      )}

      {/* Status Timeline */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          Lifecycle Status Pipeline
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <span style={{ fontWeight: proposal.status === 'PENDING_REVIEW' ? 700 : 400 }}>
            1. PENDING REVIEW
          </span>
          <span>→</span>
          <span style={{ fontWeight: proposal.status === 'PAYING' ? 700 : 400 }}>
            2. PAYING (PayPal)
          </span>
          <span>→</span>
          <span style={{ fontWeight: proposal.status === 'PAID' ? 700 : 400, color: proposal.status === 'PAID' ? 'var(--success)' : 'inherit' }}>
            3. {proposal.paypalBatchId?.startsWith('SIMULATED-MOCK-') ? 'PAID (Simulated)' : 'PAID'}
          </span>
          {proposal.paypalBatchId && (
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>
              PayPal Batch: {proposal.paypalBatchId}
            </span>
          )}
          {proposal.status === 'PAYING' && (
            <button type="button" className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={handlePollStatus}>
              ↻ Poll PayPal Status
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Proposal Information & Safety Verification */}
        <div>
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: '1rem' }}>Transaction Details</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.9rem' }}>
              <div>
                <strong>Vendor Name:</strong> {proposal.vendorName}
              </div>
              <div>
                <strong>Ingestion Source:</strong>{' '}
                <span
                  className="badge"
                  style={{
                    fontSize: '0.75rem',
                    marginLeft: '0.4rem',
                    backgroundColor:
                      proposal.source === 'zapier_intake'
                        ? '#e0e7ff'
                        : proposal.source === 'mcp'
                        ? '#ede9fe'
                        : 'var(--bg-subtle, #f1f5f9)',
                    color:
                      proposal.source === 'zapier_intake'
                        ? '#4338ca'
                        : proposal.source === 'mcp'
                        ? '#6d28d9'
                        : 'var(--text-muted, #475569)',
                    fontWeight: 600,
                    border: '1px solid currentColor'
                  }}
                >
                  {proposal.source === 'zapier_intake'
                    ? '⚡ Zapier/Intake'
                    : proposal.source === 'mcp'
                    ? '🤖 MCP'
                    : '👤 Manual'}
                </span>
              </div>
              <div>
                <strong>Authorized Amount:</strong>{' '}
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>
                  ${proposal.amount.toFixed(2)} {proposal.currency}
                </span>
              </div>
              <div>
                <strong>Payee Destination (LOCKED TO VENDOR RECORD):</strong>{' '}
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)', marginTop: '0.2rem' }}>
                  {proposal.payee}
                </div>
              </div>

              {proposal.paypalBatchId && (
                <div>
                  <strong>
                    {proposal.paypalBatchId.startsWith('SIMULATED-') || proposal.paypalBatchId.startsWith('MOCK-')
                      ? '⚡ Simulated Batch Reference:'
                      : 'PayPal Batch ID:'}
                  </strong>{' '}
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)', fontWeight: 600 }}>
                    {proposal.paypalBatchId}
                  </span>
                </div>
              )}

              {proposal.paypalPayoutItemId && (
                <div>
                  <strong>
                    {proposal.paypalBatchId?.startsWith('SIMULATED-') || proposal.paypalBatchId?.startsWith('MOCK-')
                      ? '⚡ Simulated Item Reference:'
                      : 'PayPal Item ID:'}
                  </strong>{' '}
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    {proposal.paypalPayoutItemId}
                  </span>
                </div>
              )}

              {proposal.requestedPayeeInEmail && (
                <div style={{ padding: '0.6rem', backgroundColor: 'var(--danger-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--danger-border)' }}>
                  <strong style={{ color: 'var(--danger)' }}>🚨 Email Attacker Requested:</strong>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--danger)', wordBreak: 'break-all' }}>
                    {proposal.requestedPayeeInEmail}
                  </div>
                  <p style={{ fontSize: '0.75rem', marginTop: '0.35rem', color: 'var(--text-muted)' }}>
                    Protection active: The agent refuses to pay this address. Payout will go strictly to the payee on file.
                  </p>
                </div>
              )}

              {proposal.requiresDualApproval && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.85rem' }}>Dual Approval Progress:</strong>
                    <span style={{ fontWeight: 700, color: proposal.secondApprover ? 'var(--success)' : 'var(--warning-text, #92400e)' }}>
                      {proposal.secondApprover ? '2/2 Completed' : proposal.firstApprover ? '1/2 (Awaiting 2nd)' : '0/2 (Awaiting 1st)'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem', marginBottom: '0.4rem' }}>
                    {proposal.amount >= (config?.dualApprovalThreshold || 1000)
                      ? `Amount ($${proposal.amount.toFixed(2)}) meets or exceeds dual approval threshold ($${config?.dualApprovalThreshold || 1000}).`
                      : 'Payee has no prior successful payment history (new payee policy).'}
                  </p>
                  <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div>
                      <strong>1st Approval: </strong>
                      {proposal.firstApprover ? (
                        <span style={{ color: 'var(--success)' }}>
                          {proposal.firstApprover} ({new Date(proposal.firstApprovedAt!).toLocaleTimeString()})
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Pending</span>
                      )}
                    </div>
                    <div>
                      <strong>2nd Approval: </strong>
                      {proposal.secondApprover ? (
                        <span style={{ color: 'var(--success)' }}>
                          {proposal.secondApprover} ({new Date(proposal.secondApprovedAt!).toLocaleTimeString()})
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Pending (must differ from 1st approver)</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {proposal.coolingOffUntil && (
                <div
                  style={{
                    padding: '0.75rem',
                    backgroundColor: proposal.coolingOffBypassed ? 'var(--bg-subtle)' : isCoolingOffActive ? '#fef3c7' : '#dcfce7',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    fontSize: '0.8rem',
                    marginTop: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <strong>Cooling-off Period (New Payee): </strong>
                      {proposal.coolingOffBypassed ? (
                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>⚡ Bypassed via Demo Fast-Forward</span>
                      ) : isCoolingOffActive ? (
                        <span style={{ color: '#92400e', fontWeight: 600 }}>
                          Active until {new Date(proposal.coolingOffUntil).toLocaleTimeString()} ({new Date(proposal.coolingOffUntil).toLocaleDateString()})
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>
                          Completed
                        </span>
                      )}
                    </div>
                    {isCoolingOffActive && config?.demoFastForward && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                        onClick={handleBypassCoolingOff}
                      >
                        ⚡ Demo: skip waiting
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Flags */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '0.75rem' }}>
              Security Flags ({proposal.flags.length})
            </h3>
            <FlagList flags={proposal.flags} />
          </div>
        </div>

        {/* Approval Form */}
        <div>
          <div className="card" style={{ borderColor: isHold ? 'var(--danger)' : 'var(--border)' }}>
            <h2 className="card-title" style={{ marginBottom: '0.75rem' }}>
              Human-in-the-Loop Gate
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Strict Invariant: The AI never moves money by itself. Every PayPal payout requires human verification.
            </p>

            {/* Out-of-Band Vendor Confirmation Section (Milestone 3) */}
            {(proposal.verdict === 'HOLD' || proposal.verdict === 'CHECK') && (
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-muted, #f8fafc)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginBottom: '1rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
                    📧 Out-of-Band Vendor Confirmation
                  </h3>
                  {proposal.confirmation && (
                    <span
                      className={`badge ${
                        proposal.confirmation.status === 'CONFIRMED'
                          ? 'badge-success'
                          : proposal.confirmation.status === 'DENIED'
                          ? 'badge-danger'
                          : proposal.confirmation.status === 'PENDING'
                          ? 'badge-warning'
                          : 'badge-muted'
                      }`}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {proposal.confirmation.status}
                    </span>
                  )}
                </div>

                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Dispatches a single-use crypto link to the vendor's verified contact email on file. If confirmed by the vendor, satisfies the HOLD verification requirement.
                </p>

                <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  <strong>Verified Contact on File: </strong>
                  {proposal.vendorContactEmail ? (
                    <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                      {proposal.vendorContactEmail}
                    </code>
                  ) : (
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                      None registered (Cannot send confirmation link)
                    </span>
                  )}
                </div>

                {proposal.confirmation ? (
                  <div style={{ fontSize: '0.85rem', padding: '0.65rem 0.75rem', background: '#ffffff', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div>Sent to: <strong>{proposal.confirmation.sentTo}</strong></div>
                    <div>Status: <strong>{proposal.confirmation.status}</strong></div>
                    {proposal.confirmation.status === 'PENDING' && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          💡 Demo Outbox mode: test vendor confirmation link in Outbox:
                        </span>
                        <div style={{ marginTop: '0.25rem' }}>
                          <Link
                            to="/outbox"
                            className="btn btn-outline"
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                          >
                            Open Outbox to View / Test Confirmation Link →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  proposal.status === 'PENDING_REVIEW' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.85rem', width: '100%' }}
                      onClick={handleSendConfirmation}
                      disabled={!proposal.vendorContactEmail || sendingConfirmation}
                    >
                      {sendingConfirmation
                        ? 'Dispatching Confirmation...'
                        : proposal.vendorContactEmail
                        ? `📨 Send Confirmation to ${proposal.vendorContactEmail}`
                        : 'No Verified Contact Email on File'}
                    </button>
                  )
                )}
              </div>
            )}

            {exceedsHardLimit ? (
              <div style={{ padding: '1rem', backgroundColor: 'var(--danger-subtle)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
                <strong style={{ color: 'var(--danger)' }}>⛔ HARD BLOCKED BY POLICY</strong>
                <p style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                  This amount (${proposal.amount.toFixed(2)}) exceeds the hard threshold limit (${hardLimit.toFixed(2)}). Automated in-app payout is blocked. Authorize via executive wire.
                </p>
              </div>
            ) : proposal.status === 'PENDING_REVIEW' ? (
              <div>
                {isSameApprover && (
                  <div style={{ padding: '0.75rem', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 'var(--radius)', marginBottom: '1rem', color: '#92400e', fontSize: '0.85rem' }}>
                    <strong>Dual Approval Required:</strong> You provided the first approval as <em>{proposal.firstApprover}</em>. To satisfy the two-person control rule, a different approver must provide the second approval.
                  </div>
                )}

                {isCoolingOffActive && (
                  <div style={{ padding: '0.75rem', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 'var(--radius)', marginBottom: '1rem', color: '#92400e', fontSize: '0.85rem' }}>
                    <strong>Cooling-off Period Active:</strong> Disbursements to new payees require a waiting period until {new Date(proposal.coolingOffUntil!).toLocaleTimeString()} ({new Date(proposal.coolingOffUntil!).toLocaleDateString()}).
                    {config?.demoFastForward && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn-outline"
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                          onClick={handleBypassCoolingOff}
                        >
                          ⚡ Demo: skip waiting
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Rule: HOLD proposals require out-of-band confirmation OR callback checkbox + note */}
                {isHold && (
                  <div style={{ padding: '1rem', backgroundColor: isVendorConfirmed ? 'rgba(34, 197, 94, 0.1)' : 'var(--warning-subtle)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: `1px solid ${isVendorConfirmed ? '#22c55e' : 'var(--warning-border)'}` }}>
                    {isVendorConfirmed ? (
                      <div>
                        <div style={{ fontWeight: 700, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>✅</span>
                          <span>Verified Out-of-Band by Vendor Contact</span>
                        </div>
                        <p style={{ fontSize: '0.8rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                          Confirmation was approved by {proposal.confirmation?.sentTo}. Phone callback is optional.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--warning-text, #92400e)', marginBottom: '0.5rem' }}>
                          ⚠️ HOLD Gate: Requires confirmed vendor email OR manual phone callback:
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                          <input
                            type="checkbox"
                            id="callback-checkbox"
                            checked={callbackChecked}
                            onChange={e => setCallbackChecked(e.target.checked)}
                            style={{ marginTop: '0.2rem', width: '18px', height: '18px' }}
                          />
                          <label htmlFor="callback-checkbox" style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                            I called the verified number on file (out-of-band) and verified this invoice with the vendor.
                          </label>
                        </div>

                        <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                          <label className="form-label" htmlFor="callback-note-input" style={{ fontSize: '0.8rem' }}>
                            Callback Verification Note (Mandatory if unconfirmed, min 5 chars):
                          </label>
                          <input
                            id="callback-note-input"
                            type="text"
                            className="form-input"
                            placeholder="e.g. Spoke with CFO Alice at verified phone number..."
                            value={callbackNote}
                            onChange={e => setCallbackNote(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Rule: Amount above APPROVAL_LIMIT requires typing amount */}
                {exceedsApprovalLimit && (
                  <div style={{ padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" htmlFor="typed-amount-input">
                        High Value Verification (&gt;${approvalLimit}): Type exact amount (${proposal.amount.toFixed(2)}) to confirm:
                      </label>
                      <input
                        id="typed-amount-input"
                        type="number"
                        step="0.01"
                        className="form-input"
                        placeholder={proposal.amount.toFixed(2)}
                        value={typedAmount}
                        onChange={e => setTypedAmount(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="approval-note-input">
                    Approval Ledger Note (Optional):
                  </label>
                  <input
                    id="approval-note-input"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Regular monthly IT infrastructure disbursement"
                    value={approvalNote}
                    onChange={e => setApprovalNote(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button
                    type="button"
                    className="btn btn-success"
                    style={{ flex: 2, padding: '0.75rem' }}
                    onClick={handleApprove}
                    disabled={!canApprove || submittingApproval}
                  >
                    {submittingApproval
                      ? 'Submitting...'
                      : isSameApprover
                      ? 'Awaiting Second Approver'
                      : isCoolingOffActive
                      ? 'Holding in Cooling-off'
                      : proposal.requiresDualApproval && !proposal.firstApprover
                      ? '✓ Provide 1st Approval (1/2)'
                      : proposal.requiresDualApproval
                      ? '✓ Provide 2nd Approval & Send Payout (2/2)'
                      : '✓ Approve & Send Payout'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const isHold = proposal.verdict === 'HOLD';
                      setBlockSenderDomain(isHold);
                      setBlockPayeeIdentifiers(isHold);
                      setShowRejectModal(true);
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)' }}>
                <p>
                  <strong>Proposal Status: </strong>
                  <StatusBadge status={proposal.status} batchId={proposal.paypalBatchId} />
                </p>
                {proposal.approvalNote && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    <strong>Approval Note: </strong> {proposal.approvalNote}
                  </p>
                )}
                {proposal.rejectionReason && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
                    <strong>Rejection/Block Reason: </strong> {proposal.rejectionReason}
                  </p>
                )}
                {proposal.status === 'FAILED' && proposal.firstApprover && (
                  <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                      Human approval was verified and recorded. You can complete this transaction using simulated mock payout:
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSimulatePayout}
                      disabled={submittingSimulation}
                    >
                      {submittingSimulation ? 'Simulating...' : '⚡ Demonstrate via Mock Payout (Simulated)'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="card-title">Reject Payment Proposal</h3>
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '0.2rem 0.5rem' }}
                onClick={() => setShowRejectModal(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Please specify the security or administrative reason for rejecting this proposal. This will be recorded permanently in the append-only audit trail.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="reject-reason-input">
                Rejection Reason:
              </label>
              <textarea
                id="reject-reason-input"
                className="form-textarea"
                style={{ height: '90px' }}
                placeholder="e.g. Vendor verified this is a BEC fraud attempt; no payment owed."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>

            {(proposal.verdict === 'HOLD' || proposal.verdict === 'CHECK') && (
              <div
                style={{
                  marginTop: '1rem',
                  marginBottom: '1.25rem',
                  padding: '0.75rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 'var(--radius)'
                }}
              >
                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: '#991b1b', marginBottom: '0.5rem' }}>
                  🛡️ Security Blocklist Learning:
                </p>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.85rem',
                    marginBottom: '0.5rem',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={blockSenderDomain}
                    onChange={e => setBlockSenderDomain(e.target.checked)}
                  />
                  <span>Block this sender domain (auto-HOLD future emails from this domain)</span>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={blockPayeeIdentifiers}
                    onChange={e => setBlockPayeeIdentifiers(e.target.checked)}
                  />
                  <span>Block these payee identifiers (prevent future payments to these attacker accounts)</span>
                </label>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowRejectModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleReject}
                disabled={submittingReject || rejectReason.trim().length < 3}
              >
                {submittingReject ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
