import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ConfirmationStatus } from '../types.js';

export const ConfirmPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<{
    vendorName: string;
    amount: number;
    currency: string;
    status: ConfirmationStatus;
    isExpired: boolean;
    expiresAt: string;
  } | null>(null);
  const [resolution, setResolution] = useState<{
    status: 'CONFIRMED' | 'DENIED';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing confirmation token.');
      setLoading(false);
      return;
    }

    api
      .getConfirmationDetails(token)
      .then(data => {
        setDetails(data);
        if (data.status !== 'PENDING') {
          setResolution({
            status: data.status as 'CONFIRMED' | 'DENIED',
            message: `This verification request was previously resolved as ${data.status}.`
          });
        }
      })
      .catch(err => {
        setError(err.message || 'Invalid or expired confirmation link.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const handleDecision = async (decision: 'CONFIRMED' | 'DENIED') => {
    if (!token) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await api.resolveConfirmation(token, decision);
      setResolution({
        status: result.status,
        message: result.message
      });
      if (details) {
        setDetails({ ...details, status: result.status });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit verification response.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: '540px', margin: '4rem auto', padding: '2rem', textAlign: 'center' }} className="card">
        <p style={{ color: 'var(--text-muted)' }}>Loading payment verification details...</p>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div style={{ maxWidth: '540px', margin: '4rem auto', padding: '2rem' }} className="card">
        <div className="badge badge-danger" style={{ width: '100%', padding: '1rem', fontSize: '1rem', textAlign: 'center' }}>
          ⚠️ {error}
        </div>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center' }}>
          This link may have already been used, expired, or is invalid. If you suspect fraudulent activity, please contact your accounts payable department directly.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '580px', margin: '3rem auto', padding: '2rem' }} className="card">
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
          🛡️ PayGuard Security Verification
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Out-of-band invoice authorization check
        </p>
      </div>

      {details && (
        <div>
          <div style={{ background: 'var(--bg-muted, #f8fafc)', padding: '1.25rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
            <p style={{ margin: '0.4rem 0', fontSize: '0.95rem' }}>
              <strong>Vendor / Payee: </strong> {details.vendorName}
            </p>
            <p style={{ margin: '0.4rem 0', fontSize: '0.95rem' }}>
              <strong>Payment Amount: </strong>{' '}
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                ${details.amount.toFixed(2)} {details.currency}
              </span>
            </p>
            <p style={{ margin: '0.4rem 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <strong>Status: </strong> {details.status}
              {details.isExpired && ' (Expired)'}
            </p>
          </div>

          {resolution ? (
            <div
              className={`badge ${resolution.status === 'CONFIRMED' ? 'badge-success' : 'badge-danger'}`}
              style={{
                width: '100%',
                padding: '1.25rem',
                fontSize: '1rem',
                textAlign: 'center',
                lineHeight: 1.5,
                borderRadius: '8px'
              }}
            >
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                {resolution.status === 'CONFIRMED' ? '✅' : '🛑'}
              </div>
              <strong>{resolution.message}</strong>
              <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', opacity: 0.9 }}>
                {resolution.status === 'CONFIRMED'
                  ? 'Your verification has been recorded in the audit trail. The finance team may now proceed with approval.'
                  : 'The transaction has been immediately blocked to protect all parties. An incident was logged.'}
              </p>
            </div>
          ) : details.isExpired ? (
            <div className="badge badge-warning" style={{ width: '100%', padding: '1rem', textAlign: 'center' }}>
              ⚠️ This confirmation link has expired.
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Did your organization request this disbursement with these exact details?
              </p>

              {error && (
                <div className="badge badge-danger" style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    backgroundColor: '#16a34a',
                    borderColor: '#16a34a',
                    padding: '0.85rem 1.25rem',
                    fontSize: '0.95rem',
                    fontWeight: 700
                  }}
                  disabled={submitting}
                  onClick={() => handleDecision('CONFIRMED')}
                >
                  {submitting ? 'Submitting...' : '✓ Yes, I sent this request, payment details are correct'}
                </button>

                <button
                  type="button"
                  className="btn"
                  style={{
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    padding: '0.85rem 1.25rem',
                    fontSize: '0.95rem',
                    fontWeight: 700
                  }}
                  disabled={submitting}
                  onClick={() => handleDecision('DENIED')}
                >
                  {submitting ? 'Submitting...' : '✕ No, I did not send this (Fraud Alert)'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
