import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CheckEmailResult, SampleEmailItem } from '../types.js';
import { FlagList } from '../components/FlagList.js';
import { CallbackCard } from '../components/CallbackCard.js';
import { StatusBadge } from '../components/StatusBadge.js';

function base64ToFile(base64: string, filename: string, mimeType: string): File {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
}

export const CheckEmailPage: React.FC = () => {
  const [samples, setSamples] = useState<SampleEmailItem[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [rawEmail, setRawEmail] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckEmailResult | null>(null);

  useEffect(() => {
    api.getSamples().then(setSamples).catch(console.error);
  }, []);

  const handleSelectSample = (sample: SampleEmailItem) => {
    setSelectedSampleId(sample.id);
    setRawEmail(sample.rawEmail);
    if (sample.attachments && sample.attachments.length > 0) {
      const files = sample.attachments.map(a =>
        base64ToFile(a.contentBase64, a.filename, a.mimeType)
      );
      setAttachments(files);
    } else {
      setAttachments([]);
    }
    setResult(null);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);

    if (attachments.length + selected.length > 3) {
      setError('Maximum 3 attachments allowed per check.');
      return;
    }

    for (const f of selected) {
      if (f.size > 5 * 1024 * 1024) {
        setError(`File "${f.name}" exceeds the 5 MB size limit.`);
        return;
      }
    }

    setError(null);
    setAttachments(prev => [...prev, ...selected].slice(0, 3));
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
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
      let data: CheckEmailResult;
      if (attachments.length > 0) {
        const formData = new FormData();
        formData.append('rawEmail', rawEmail);
        for (const file of attachments) {
          formData.append('attachments', file);
        }
        data = await api.checkEmailWithAttachments(formData);
      } else {
        data = await api.checkEmail(rawEmail);
      }
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
          Paste raw headers and message body, attach invoices (PDF/images), or select a pre-recorded demo scenario below.
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

        {/* Try Sample PDF Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Try Sample PDF:
          </span>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            onClick={() => {
              const honest = samples.find(s => s.id === 'sample-honest-invoice-pdf');
              if (honest) handleSelectSample(honest);
            }}
          >
            📄 Honest Invoice PDF (Matches Record)
          </button>
          <button
            type="button"
            className="btn btn-outline"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', borderColor: 'var(--danger)', color: 'var(--danger)' }}
            onClick={() => {
              const fraud = samples.find(s => s.id === 'sample-fraud-invoice-pdf');
              if (fraud) handleSelectSample(fraud);
            }}
          >
            🚨 Fraud Invoice PDF (Payee Mismatch &amp; Bank Change)
          </button>
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
            style={{ height: '200px' }}
            value={rawEmail}
            onChange={e => {
              setRawEmail(e.target.value);
              setSelectedSampleId(null);
            }}
            placeholder="From: vendor@example.com&#10;To: billing@yourcompany.com&#10;Subject: Invoice #1234&#10;&#10;Please remit payment of $450 to our account..."
            required
          />
        </div>

        {/* Attachments Section */}
        <div className="form-group" style={{ marginTop: '1rem' }}>
          <label className="form-label" htmlFor="attachment-input">
            Invoice Attachments (PDF, PNG, JPG &mdash; Max 3 files, 5 MB each)
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id="attachment-input"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              multiple
              onChange={handleFileChange}
              disabled={attachments.length >= 3}
              style={{ fontSize: '0.85rem' }}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {attachments.length}/3 attached
            </span>
          </div>

          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {attachments.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'var(--bg-muted, #f3f4f6)',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    border: '1px solid var(--border)'
                  }}
                >
                  <span>📎 {file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--danger)',
                      fontWeight: 'bold'
                    }}
                    title="Remove attachment"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
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
          {(rawEmail || attachments.length > 0) && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setRawEmail('');
                setAttachments([]);
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

          {/* Attachment Findings & Side-by-Side Comparison */}
          {result.attachments && result.attachments.length > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'var(--border)' }}>
              <div className="card-header">
                <h3 className="card-title">📎 Attachment Findings &amp; Document Extraction</h3>
                <span className="badge badge-muted">{result.attachments.length} attachment(s) analyzed</span>
              </div>

              {result.attachments.map((att, idx) => {
                const inv = att.invoiceData;
                const emailPayees = result.aiAnalysis.newPayeeIdentifiers;
                const vendorPayees = result.matchedVendor?.paypalEmails || [];
                const invPayees = inv?.payeeIdentifiers || [];

                // Detect mismatches
                const payeeMismatch =
                  invPayees.length > 0 &&
                  vendorPayees.length > 0 &&
                  !invPayees.some(p => vendorPayees.map(v => v.toLowerCase()).includes(p.toLowerCase()));

                const amountMismatch =
                  inv?.amount != null &&
                  result.aiAnalysis.amount != null &&
                  Math.abs(inv.amount - result.aiAnalysis.amount) > 0.01;

                return (
                  <div key={idx} style={{ marginBottom: idx < (result.attachments?.length || 1) - 1 ? '1.5rem' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <strong>📄 {att.attachment.filename}</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ({att.attachment.mimeType}, {(att.attachment.sizeBytes / 1024).toFixed(1)} KB)
                      </span>
                      {inv?.unreadable && (
                        <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                          Unreadable (Fallback)
                        </span>
                      )}
                      {inv?.hiddenInstructionsDetected && (
                        <span className="badge badge-danger" style={{ fontSize: '0.75rem' }}>
                          🚨 Hidden Instructions / Injection Detected
                        </span>
                      )}
                    </div>

                    {inv ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-muted, #f8fafc)', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>
                              <th style={{ padding: '0.5rem 0.75rem', width: '22%' }}>Field</th>
                              <th style={{ padding: '0.5rem 0.75rem', width: '26%' }}>Extracted From Attachment</th>
                              <th style={{ padding: '0.5rem 0.75rem', width: '26%' }}>Email Claims</th>
                              <th style={{ padding: '0.5rem 0.75rem', width: '26%' }}>Vendor Record On File</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Vendor Name</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>{inv.vendorName || <span style={{ color: 'var(--text-muted)' }}>Not found</span>}</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>{result.aiAnalysis.vendorName || <span style={{ color: 'var(--text-muted)' }}>Not found</span>}</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>{result.matchedVendor?.name || <span style={{ color: 'var(--text-muted)' }}>Unknown</span>}</td>
                            </tr>
                            <tr
                              style={{
                                borderBottom: '1px solid var(--border)',
                                background: payeeMismatch ? 'rgba(239, 68, 68, 0.1)' : 'inherit'
                              }}
                            >
                              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>
                                Payee / Remittance
                                {payeeMismatch && (
                                  <span style={{ color: 'var(--danger)', display: 'block', fontSize: '0.72rem' }}>
                                    ⚠️ Payee Mismatch
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {invPayees.length > 0 ? (
                                  <code style={{ fontFamily: 'var(--font-mono)', color: payeeMismatch ? 'var(--danger)' : 'inherit' }}>
                                    {invPayees.join(', ')}
                                  </code>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>None found</span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {emailPayees.length > 0 ? (
                                  <code style={{ fontFamily: 'var(--font-mono)' }}>{emailPayees.join(', ')}</code>
                                ) : (
                                  <code style={{ fontFamily: 'var(--font-mono)' }}>{result.parsedEmail.senderAddress}</code>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {vendorPayees.length > 0 ? (
                                  <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                                    {vendorPayees.join(', ')}
                                  </code>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>None on file</span>
                                )}
                              </td>
                            </tr>
                            <tr
                              style={{
                                borderBottom: '1px solid var(--border)',
                                background: amountMismatch ? 'rgba(245, 158, 11, 0.1)' : 'inherit'
                              }}
                            >
                              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>
                                Amount
                                {amountMismatch && (
                                  <span style={{ color: 'var(--warning)', display: 'block', fontSize: '0.72rem' }}>
                                    ⚠️ Amount Mismatch
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {inv.amount != null ? (
                                  <strong>${inv.amount.toFixed(2)} {inv.currency || ''}</strong>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Not found</span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {result.aiAnalysis.amount != null ? (
                                  <span>${result.aiAnalysis.amount.toFixed(2)} {result.aiAnalysis.currency || ''}</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Not found</span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {result.matchedVendor ? (
                                  <span>${result.matchedVendor.typicalAmount.toFixed(2)} (typical)</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>N/A</span>
                                )}
                              </td>
                            </tr>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Invoice # / Due Date</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {inv.invoiceNumber || 'N/A'}{inv.dueDate ? ` (Due: ${inv.dueDate})` : ''}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>—</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>—</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>Bank Change Mentioned</td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {inv.bankChangeMentioned ? (
                                  <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠️ Yes (Bank change in PDF)</span>
                                ) : (
                                  'No'
                                )}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>
                                {result.aiAnalysis.payeeChangeMentioned ? 'Yes' : 'No'}
                              </td>
                              <td style={{ padding: '0.5rem 0.75rem' }}>—</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                        Failed to extract data: {att.error || 'Unknown error'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

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
                      <strong>Contact Email: </strong> {result.matchedVendor.contactEmail || 'None registered'}
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
                        <strong>Attacker Requested in Email/PDF: </strong>{' '}
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

              {/* Security Flags */}
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
