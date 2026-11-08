import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockedSender, BlockedPayee } from '../types.js';

export const BlocklistPage: React.FC = () => {
  const [senders, setSenders] = useState<BlockedSender[]>([]);
  const [payees, setPayees] = useState<BlockedPayee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states for manual additions
  const [showAddSender, setShowAddSender] = useState(false);
  const [senderDomain, setSenderDomain] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [senderReason, setSenderReason] = useState('');
  const [submittingSender, setSubmittingSender] = useState(false);

  const [showAddPayee, setShowAddPayee] = useState(false);
  const [payeeIdentifier, setPayeeIdentifier] = useState('');
  const [payeeReason, setPayeeReason] = useState('');
  const [submittingPayee, setSubmittingPayee] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getBlocklist();
      setSenders(res.senders);
      setPayees(res.payees);
    } catch (err: any) {
      setError(err.message || 'Failed to load blocklists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddSender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderDomain.trim() && !senderAddress.trim()) {
      setError('Please provide a domain or email address to block.');
      return;
    }
    if (!senderReason.trim()) {
      setError('Please provide a reason for blocking.');
      return;
    }

    try {
      setSubmittingSender(true);
      setError(null);
      await api.addBlockedSender({
        domain: senderDomain.trim() || null,
        address: senderAddress.trim() || null,
        reason: senderReason.trim()
      });
      setSuccessMsg(`Blocked sender ${senderDomain || senderAddress} successfully.`);
      setSenderDomain('');
      setSenderAddress('');
      setSenderReason('');
      setShowAddSender(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to block sender');
    } finally {
      setSubmittingSender(false);
    }
  };

  const handleRemoveSender = async (id: string, label: string) => {
    if (!confirm(`Are you sure you want to unblock ${label}?`)) return;
    try {
      setError(null);
      await api.removeBlockedSender(id);
      setSuccessMsg(`Unblocked ${label}. Action recorded in audit trail.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove sender from blocklist');
    }
  };

  const handleAddPayee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payeeIdentifier.trim()) {
      setError('Please provide a payee identifier to block.');
      return;
    }
    if (!payeeReason.trim()) {
      setError('Please provide a reason for blocking.');
      return;
    }

    try {
      setSubmittingPayee(true);
      setError(null);
      await api.addBlockedPayee({
        identifier: payeeIdentifier.trim(),
        reason: payeeReason.trim()
      });
      setSuccessMsg(`Blocked payee ${payeeIdentifier} successfully.`);
      setPayeeIdentifier('');
      setPayeeReason('');
      setShowAddPayee(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to block payee');
    } finally {
      setSubmittingPayee(false);
    }
  };

  const handleRemovePayee = async (id: string, identifier: string) => {
    if (!confirm(`Are you sure you want to unblock payee ${identifier}?`)) return;
    try {
      setError(null);
      await api.removeBlockedPayee(id);
      setSuccessMsg(`Unblocked payee ${identifier}. Action recorded in audit trail.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove payee from blocklist');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>🛡️ Security Blocklist Learning</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Dynamic threat intelligence gathered from rejected proposals and security alerts. Future emails or invoices matching these entries automatically trigger HIGH severity flags and force a HOLD verdict.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-outline" onClick={loadData} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div className="badge badge-success" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
          {successMsg}
        </div>
      )}

      {/* Senders Section */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className="card-title" style={{ margin: 0 }}>Blocked Sender Domains & Addresses</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Domains and addresses recognized from impersonation and phishing attempts.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.85rem' }}
            onClick={() => setShowAddSender(!showAddSender)}
          >
            {showAddSender ? '✕ Cancel' : '+ Add Blocked Sender'}
          </button>
        </div>

        {showAddSender && (
          <form onSubmit={handleAddSender} style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Block a Sender Domain or Address</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Domain (e.g. spoofed-acme.com):</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="malicious-domain.com"
                  value={senderDomain}
                  onChange={e => setSenderDomain(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Address (e.g. attacker@gmail.com):</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="attacker@domain.com"
                  value={senderAddress}
                  onChange={e => setSenderAddress(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Reason:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Confirmed BEC impersonation domain targeting executive staff"
                  value={senderReason}
                  onChange={e => setSenderReason(e.target.value)}
                  required
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowAddSender(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={submittingSender}>
                {submittingSender ? 'Saving...' : 'Add to Blocklist'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading blocked senders...</p>
        ) : senders.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No blocked senders yet. Blocked senders will appear here when proposals are rejected with the block option or manually added.
          </p>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Source Proposal</th>
                  <th>Added At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {senders.map(s => (
                  <tr key={s.id}>
                    <td>
                      <code style={{ fontWeight: 700, color: 'var(--danger)' }}>
                        {s.domain || s.address}
                      </code>
                    </td>
                    <td>{s.domain ? 'Domain' : 'Address'}</td>
                    <td>{s.reason}</td>
                    <td>
                      {s.sourceProposalId ? (
                        <Link to={`/proposals/${s.sourceProposalId}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          #{s.sourceProposalId}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Manual</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: 'var(--danger)' }}
                        onClick={() => handleRemoveSender(s.id, s.domain || s.address || s.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payees Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className="card-title" style={{ margin: 0 }}>Blocked Payee Accounts & Identifiers</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              PayPal emails, IBANs, and bank accounts extracted from fraudulent payment requests.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.85rem' }}
            onClick={() => setShowAddPayee(!showAddPayee)}
          >
            {showAddPayee ? '✕ Cancel' : '+ Add Blocked Payee'}
          </button>
        </div>

        {showAddPayee && (
          <form onSubmit={handleAddPayee} style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius)' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Block a Payee Account / Identifier</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Payee Identifier (Email, IBAN, Account #):</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="fraud-receiver@gmail.com or GB82WEST123456"
                  value={payeeIdentifier}
                  onChange={e => setPayeeIdentifier(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Reason:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Attacker PayPal handle extracted from fake invoice PDF"
                  value={payeeReason}
                  onChange={e => setPayeeReason(e.target.value)}
                  required
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowAddPayee(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={submittingPayee}>
                {submittingPayee ? 'Saving...' : 'Add to Blocklist'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading blocked payees...</p>
        ) : payees.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No blocked payees yet. Fraudulent payee identifiers will appear here when proposals are rejected with the block option or manually added.
          </p>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Payee Identifier</th>
                  <th>Reason</th>
                  <th>Source Proposal</th>
                  <th>Added At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payees.map(p => (
                  <tr key={p.id}>
                    <td>
                      <code style={{ fontWeight: 700, color: 'var(--danger)' }}>
                        {p.identifier}
                      </code>
                    </td>
                    <td>{p.reason}</td>
                    <td>
                      {p.sourceProposalId ? (
                        <Link to={`/proposals/${p.sourceProposalId}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          #{p.sourceProposalId}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Manual</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{new Date(p.createdAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: 'var(--danger)' }}
                        onClick={() => handleRemovePayee(p.id, p.identifier)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
