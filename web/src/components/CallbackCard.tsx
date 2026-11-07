import React, { useState } from 'react';
import { CallbackRecommendation } from '../types.js';

interface CallbackCardProps {
  callback: CallbackRecommendation;
}

export const CallbackCard: React.FC<CallbackCardProps> = ({ callback }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(callback.script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="card" style={{ borderColor: callback.hasPhoneOnFile ? 'var(--primary)' : 'var(--warning-border)' }}>
      <div className="card-header">
        <h3 className="card-title">
          {callback.hasPhoneOnFile ? '📞 Out-of-Band Callback Script' : '⚠️ No Phone on File for Vendor'}
        </h3>
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleCopy}
          aria-label="Copy phone verification script to clipboard"
        >
          {copied ? '✓ Copied!' : '📋 Copy Script'}
        </button>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        <strong>Strict Invariant:</strong> The phone number below comes{' '}
        <span style={{ textDecoration: 'underline' }}>ONLY</span> from internal verified vendor records.
        Never use phone numbers found in the email text or signature.
      </p>

      {callback.hasPhoneOnFile ? (
        <div style={{ marginBottom: '0.5rem' }}>
          <strong>Trusted Phone: </strong>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--primary)' }}>
            {callback.phoneNumber}
          </span>
        </div>
      ) : (
        <div className="badge badge-danger" style={{ marginBottom: '0.5rem' }}>
          Missing Internal Phone Record
        </div>
      )}

      <pre className="callback-script-box">{callback.script}</pre>
    </div>
  );
};
