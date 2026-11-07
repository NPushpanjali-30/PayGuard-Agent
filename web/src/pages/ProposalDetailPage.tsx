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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Approval Form State
  const [callbackChecked, setCallbackChecked] = useState(false);
  const [callbackNote, setCallbackNote] = useState('');
  const [typedAmount, setTypedAmount] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // Rejection Form State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);

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
  }, [id]);

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
  const approvalLimit = config?.approvalLimit || 500;
  const hardLimit = config?.hardLimit || 5000;
  const exceedsApprovalLimit = proposal.amount > approvalLimit;
  const exceedsHardLimit = proposal.amount > hardLimit || proposal.isHardBlocked;

  // Validate if approver can click Approve button
  const canApprove =
    proposal.status === 'PENDING_REVIEW' &&
    !exceedsHardLimit &&
    (!isHold || (callbackChecked && callbackNote.trim().length >= 5)) &&
    (!exceedsApprovalLimit || parseFloat(typedAmount) === proposal.amount);

  const handleApprove = async () => {
    if (!canApprove) return;
    setError(null);
    setSubmittingApproval(true);

    try {
      const updated = await api.approveProposal(proposal.id, {
        callbackConfirmed: callbackChecked,
        callbackNote: callbackNote.trim(),
        typedAmountConfirmation: exceedsApprovalLimit ? parseFloat(typedAmount) : undefined,
        approvalNote: approvalNote.trim()
      });

      setProposal(updated);
      setSuccessMsg(`Payout batch ${updated.paypalBatchId || ''} submitted to PayPal.`);
    } catch (err: any) {
      setError(err.message || 'Approval failed');
    } finally {
      setSubmittingApproval(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setError(null);
    setSubmittingReject(true);

    try {
      const updated = await api.rejectProposal(proposal.id, rejectReason.trim());
      setProposal(updated);
      setShowRejectModal(false);
      setSuccessMsg('Proposal marked REJECTED and logged to audit trail.');
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
            <StatusBadge status={proposal.status} />
          </div>
        </div>
      </div>

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
            3. PAID
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

            {exceedsHardLimit ? (
              <div style={{ padding: '1rem', backgroundColor: 'var(--danger-subtle)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
                <strong style={{ color: 'var(--danger)' }}>⛔ HARD BLOCKED BY POLICY</strong>
                <p style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                  This amount (${proposal.amount.toFixed(2)}) exceeds the hard threshold limit (${hardLimit.toFixed(2)}). Automated in-app payout is blocked. Authorize via executive wire.
                </p>
              </div>
            ) : proposal.status === 'PENDING_REVIEW' ? (
              <div>
                {/* Rule: HOLD proposals require callback checkbox + note */}
                {isHold && (
                  <div style={{ padding: '1rem', backgroundColor: 'var(--warning-subtle)', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid var(--warning-border)' }}>
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
                        Callback Verification Note (Mandatory, min 5 chars):
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
                    {submittingApproval ? 'Sending via PayPal...' : '✓ Approve & Send Payout'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ flex: 1 }}
                    onClick={() => setShowRejectModal(true)}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)' }}>
                <p>
                  <strong>Proposal Status: </strong>
                  <StatusBadge status={proposal.status} />
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
