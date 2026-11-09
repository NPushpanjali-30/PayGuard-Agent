import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { PaymentProposal, AppConfig } from '../types.js';
import { ModeBanner } from '../components/ModeBanner.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface DashboardPageProps {
  config: AppConfig | null;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ config }) => {
  const [proposals, setProposals] = useState<PaymentProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProposals = async () => {
    try {
      setLoading(true);
      const data = await api.getProposals();
      setProposals(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProposals();
  }, []);

  const pendingCount = proposals.filter(p => p.status === 'PENDING_REVIEW').length;
  const paidCount = proposals.filter(p => p.status === 'PAID').length;
  const heldCount = proposals.filter(p => p.verdict === 'HOLD').length;
  const totalAmountPaid = proposals
    .filter(p => p.status === 'PAID')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Payment Security Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Monitor payment proposals, verify BEC signals, and release approved PayPal payouts.
          </p>
        </div>
        <Link to="/check" className="btn btn-primary">
          🔍 Check New Email →
        </Link>
      </div>

      <ModeBanner config={config} />

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Pending Review</div>
          <div className="stat-value" style={{ color: pendingCount > 0 ? 'var(--warning)' : 'inherit' }}>
            {pendingCount}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Suspicious Emails Held</div>
          <div className="stat-value" style={{ color: heldCount > 0 ? 'var(--danger)' : 'inherit' }}>
            {heldCount}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Paid Payouts</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>
            {paidCount}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Total Volume Paid</div>
          <div className="stat-value">${totalAmountPaid.toFixed(2)}</div>
        </div>
      </div>

      {/* Proposals List */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Recent Payment Proposals</h2>
          <button type="button" className="btn btn-outline" onClick={loadProposals} disabled={loading}>
            ↻ Refresh
          </button>
        </div>

        {error && (
          <div className="badge badge-danger" style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading proposals...
          </div>
        ) : proposals.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No payment proposals created yet.</p>
            <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
              Paste an incoming vendor invoice or payment request email to analyze it.
            </p>
            <Link to="/check" className="btn btn-primary">
              Check an Email
            </Link>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Payee (On File)</th>
                  <th>Source</th>
                  <th>Verdict</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.vendorName}</strong>
                    </td>
                    <td>
                      ${p.amount.toFixed(2)} {p.currency}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {p.payee || <span style={{ color: 'var(--danger)', fontStyle: 'italic', fontFamily: 'inherit' }}>No verified payee on file</span>}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.75rem',
                          backgroundColor:
                            p.source === 'zapier_intake'
                              ? '#e0e7ff'
                              : p.source === 'mcp'
                              ? '#ede9fe'
                              : 'var(--bg-subtle, #f1f5f9)',
                          color:
                            p.source === 'zapier_intake'
                              ? '#4338ca'
                              : p.source === 'mcp'
                              ? '#6d28d9'
                              : 'var(--text-muted, #475569)',
                          fontWeight: 600,
                          border: '1px solid currentColor'
                        }}
                      >
                        {p.source === 'zapier_intake'
                          ? '⚡ Zapier/Intake'
                          : p.source === 'mcp'
                          ? '🤖 MCP'
                          : '👤 Manual'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          p.verdict === 'HOLD'
                            ? 'badge-hold'
                            : p.verdict === 'CHECK'
                            ? 'badge-check'
                            : 'badge-clear'
                        }`}
                      >
                        {p.verdict}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={p.status} batchId={p.paypalBatchId} />
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {new Date(p.createdAt).toLocaleDateString()} {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>
                      <Link to={`/proposals/${p.id}`} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                        View / Approve →
                      </Link>
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
