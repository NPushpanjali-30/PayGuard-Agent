import React from 'react';
import { ProposalStatus } from '../types.js';

interface StatusBadgeProps {
  status: ProposalStatus;
  batchId?: string | null;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, batchId }) => {
  const isSimulated = Boolean(
    batchId && (batchId.startsWith('SIMULATED-MOCK-') || batchId.startsWith('MOCK-BATCH-'))
  );

  switch (status) {
    case 'PENDING_REVIEW':
      return <span className="badge badge-warning">⏳ Pending Review</span>;
    case 'APPROVED':
      return <span className="badge badge-info">✓ Approved</span>;
    case 'PAYING':
      return isSimulated ? (
        <span className="badge badge-info" style={{ backgroundColor: '#f3e8ff', color: '#7e22ce', border: '1px solid #c084fc' }}>
          ⚡ Paying (Simulated)
        </span>
      ) : (
        <span className="badge badge-info">⚡ Paying (PayPal)</span>
      );
    case 'PAID':
      return isSimulated ? (
        <span className="badge badge-success" style={{ backgroundColor: '#f3e8ff', color: '#7e22ce', border: '1px solid #c084fc' }}>
          ✓ Paid (Simulated)
        </span>
      ) : (
        <span className="badge badge-success">✓ Paid (PayPal)</span>
      );
    case 'BLOCKED':
      return <span className="badge badge-danger">⛔ Blocked (&gt;$5k)</span>;
    case 'REJECTED':
      return <span className="badge badge-danger">✕ Rejected</span>;
    case 'FAILED':
      return <span className="badge badge-danger">⚠ Payout Failed</span>;
    default:
      return <span className="badge badge-muted">{status}</span>;
  }
};
