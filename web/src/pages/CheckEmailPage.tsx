import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CheckEmailResult, SampleEmailItem } from '../types.js';
import { FlagList } from '../components/FlagList.js';
import { CallbackCard } from '../components/CallbackCard.js';
import { StatusBadge } from '../components/StatusBadge.js';

export const CheckEmailPage: React.FC = () => {
  const [samples, setSamples] = useState<SampleEmailItem[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [rawEmail, setRawEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckEmailResult | null>(null);

  useEffect(() => {
    api.getSamples().then(setSamples).catch(console.error);
  }, []);

  const handleSelectSample = (sample: SampleEmailItem) => {
    setSelectedSampleId(sample.id);
    setRawEmail(sample.rawEmail);
    setResult(null);
    setError(null);
  };

  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawEmail.trim()) {
      setError('Please paste an email or select a sample email above.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const data = await api.checkEmail(rawEmail);
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Email analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const emailLengthKb = (new Blob([rawEmail]).size / 1024).toFixed(1);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Check Incoming Email</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Paste raw headers and message body, or select a pre-recorded demo scenario below.
        </p>
      </div>

      {/* Sample Chips */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
          Clickable Demo Scenarios (Pre-recorded &amp; Offline Ready):
        </div>
        <div className="chip-container">
          {samples.map(s => (
            <button
              key={s.id}
              type="button"
              className={`chip ${selectedSampleId === s.id ? 'active' : ''}`}
              onClick={() => handleSelectSample(s)}
            >
              {s.category === 'fraud' ? '🚨 ' : '✓ '}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleCheckEmail} className="card">
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="form-label" htmlFor="raw-email-input">
              Raw Email (Headers + Body)
            </label>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Size: {emailLengthKb} KB / 100 KB max
            </span>
          </div>

          <textarea
            id="raw-email-input"
            className="form-textarea"
            style={{ height: '220px' }}
            value={rawEmail}
            onChange={e => {
              setRawEmail(e.target.value);
              setSelectedSampleId(null);
            }}
            placeholder="From: vendor@example.com&#10;To: billing@yourcompany.com&#10;Subject: Invoice #1234&#10;&#10;Please remit payment of $450 to our account..."
            required
          />
        </div>

        {error && (
          <div className="badge badge-danger" style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Analyzing with Agent...' : '🔍 Check This Email'}
          </button>
          {rawEmail && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setRawEmail('');
                setResult(null);
                setSelectedSampleId(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Results Section */}
      {result && (
        <section aria-label="Analysis Results">
          {/* Big Verdict Display */}
          <div className={`verdict-banner ${result.verdict.toLowerCase()}`}>
            <div className="verdict-header">
              <span>{result.verdict === 'HOLD' ? '⛔' : result.verdict === 'CHECK' ? '⚠️' : '✅'}</span>
              <span>VERDICT: {result.verdict}</span>
              {result.isFallbackReader && (
                <span className="badge badge-warning" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                  Fallback Reader
                </span>
              )}
            </div>
            <p className="verdict-summary">{result.verdictSummary}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            {/* Left Column: Vendor & Proposal */}
            <div>
              {/* Matched Vendor Info */}
              <div className="card">
                <h3 className="card-title" style={{ marginBottom: '0.75rem' }}>
                  Matched Vendor Record
                </h3>
                {result.matchedVendor ? (
                  <div style={{ fontSize: '0.875rem' }}>
                    <p style={{ marginBottom: '0.35rem' }}>
                      <strong>Name: </strong> {result.matchedVendor.name}
                    </p>
                    <p style={{ marginBottom: '0.35rem' }}>
                      <strong>Registered PayPal: </strong>{' '}
                      <code style={{ fontFamily: 'var(--font-mono)' }}>
                        {result.matchedVendor.paypalEmails.join(', ')}
                      </code>
                    </p>
                    <p style={{ marginBottom: '0.35rem' }}>
                      <strong>Typical Amount: </strong> ${result.matchedVendor.typicalAmount.toFixed(2)} (
                      {result.matchedVendor.paymentCount} prior payments)
                    </p>
                    <p style={{ marginBottom: '0.35rem' }}>
                      <strong>Phone on File: </strong> {result.matchedVendor.phone || 'None registered'}
                    </p>
                  </div>
                ) : (
                  <div className="badge badge-warning" style={{ padding: '0.5rem' }}>
                    No vendor record matches '{result.parsedEmail.senderDomain}'. Treated as First-Time / Unknown Vendor.
                  </div>
                )}
              </div>

              {/* Payment Proposal Card */}
              {result.proposal ? (
                <div className="card" style={{ borderColor: 'var(--primary)' }}>
                  <div className="card-header">
                    <h3 className="card-title">Payment Proposal Created</h3>
                    <StatusBadge status={result.proposal.status} />
                  </div>
                  <div style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                    <p style={{ marginBottom: '0.4rem' }}>
                      <strong>Amount: </strong> ${result.proposal.amount.toFixed(2)} {result.proposal.currency}
                    </p>
                    <p style={{ marginBottom: '0.4rem' }}>
                      <strong>Payee (Locked to Record): </strong>{' '}
                      <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                        {result.proposal.payee}
                      </code>
                    </p>
                    {result.proposal.requestedPayeeInEmail && (
                      <p style={{ marginBottom: '0.4rem', color: 'var(--danger)' }}>
                        <strong>Attacker Requested in Email: </strong>{' '}
                        <code style={{ fontFamily: 'var(--font-mono)' }}>
                          {result.proposal.requestedPayeeInEmail}
                        </code>
                      </p>
                    )}
                  </div>

                  <Link to={`/proposals/${result.proposal.id}`} className="btn btn-primary" style={{ width: '100%' }}>
                    Proceed to Proposal Review &amp; Approval →
                  </Link>
                </div>
              ) : (
                <div className="card">
                  <p style={{ color: 'var(--text-muted)' }}>
                    ℹ️ No payment request detected in email. No proposal was generated.
                  </p>
                </div>
              )}
            </div>

            {/* Right Column: Callback & Flags */}
            <div>
              {/* Out of Band Callback Card */}
              <CallbackCard callback={result.callbackRecommendation} />

              {/* 16-Rule Flags */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Security Flags ({result.flags.length})</h3>
                  <span className="badge badge-muted">Deterministic Checklist</span>
                </div>
                <FlagList flags={result.flags} />
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
