import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { AuditLogEntry } from '../types.js';

export const AuditPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState('');

  const loadLogs = async () => {
    try {
      setLoading(true);
      const data = await api.getAuditLogs(200);
      setLogs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = filterAction
    ? logs.filter(l => l.action.toLowerCase().includes(filterAction.toLowerCase()) || JSON.stringify(l.details).toLowerCase().includes(filterAction.toLowerCase()))
    : logs;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Append-Only Audit Trail</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Tamper-evident record of all email checks, flags, human approvals, payee updates, and PayPal payouts.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-outline" onClick={loadLogs} disabled={loading}>
            ↻ Refresh
          </button>
          <a href="/api/audit/export.csv" download className="btn btn-primary">
            📥 Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="card">
        <div style={{ marginBottom: '1rem' }}>
          <input
            type="text"
            className="form-input"
            style={{ maxWidth: '350px' }}
            placeholder="Filter by action or details (e.g. APPROVED, PAYEE)..."
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
          />
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading audit records...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No audit logs found matching criteria.
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target ID</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                      {new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-muted" style={{ fontSize: '0.75rem' }}>
                        {l.actor}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          l.action.includes('APPROVED') || l.action.includes('EXECUTED')
                            ? 'badge-success'
                            : l.action.includes('REJECTED') || l.action.includes('FAILED')
                            ? 'badge-danger'
                            : l.action.includes('CHECKED')
                            ? 'badge-primary'
                            : 'badge-warning'
                        }`}
                        style={{ fontSize: '0.7rem' }}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {l.targetId || '-'}
                    </td>
                    <td style={{ fontSize: '0.8rem', maxWidth: '400px', wordBreak: 'break-word' }}>
                      {JSON.stringify(l.details)}
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
