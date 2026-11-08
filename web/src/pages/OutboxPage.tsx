import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { OutboxMessage } from '../types.js';

export const OutboxPage: React.FC = () => {
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOutbox = () => {
    setLoading(true);
    api
      .getOutbox()
      .then(setMessages)
      .catch(err => setError(err.message || 'Failed to load outbox'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOutbox();
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Email Outbox &amp; Dispatches</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Captured outbound vendor confirmation emails and delivery records.
          </p>
        </div>
        <button type="button" className="btn btn-outline" onClick={fetchOutbox} disabled={loading}>
          {loading ? 'Refreshing...' : '🔄 Refresh Outbox'}
        </button>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            📬 Outbox is currently empty
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            When an out-of-band confirmation request is initiated on a HOLD or CHECK proposal, the message will appear here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {messages.map(msg => {
            const isDemo = msg.mode === 'demo_outbox';
            return (
              <div key={msg.id} className="card" style={{ borderColor: isDemo ? 'var(--warning)' : 'var(--border)' }}>
                <div className="card-header">
                  <div>
                    <h3 className="card-title" style={{ fontSize: '1rem' }}>
                      {msg.subject}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      To: <strong>{msg.to}</strong> &bull; From: {msg.from} &bull; {new Date(msg.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    {isDemo ? (
                      <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                        Demo Outbox (No email sent)
                      </span>
                    ) : (
                      <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>
                        SMTP Sent
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ background: 'var(--bg-muted, #f8fafc)', padding: '0.75rem', borderRadius: '4px', margin: '0.75rem 0', fontSize: '0.85rem' }}>
                  <strong>Verification Link: </strong>
                  <a href={msg.confirmationUrl} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all', color: 'var(--primary)' }}>
                    {msg.confirmationUrl}
                  </a>
                </div>

                <details style={{ marginTop: '0.5rem' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    View Raw Email Body
                  </summary>
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      background: 'var(--bg-muted, #f8fafc)',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'var(--font-mono)'
                    }}
                  >
                    {msg.text}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
