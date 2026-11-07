import React from 'react';
import { ProposalStatus } from '../types.js';

interface StatusBadgeProps {
  status: ProposalStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'PENDING_REVIEW':
      return <span className="badge badge-warning">⏳ Pending Review</span>;
    case 'APPROVED':
      return <span className="badge badge-info">✓ Approved</span>;
    case 'PAYING':
      return <span className="badge badge-info">⚡ Paying (PayPal)</span>;
    case 'PAID':
      return <span className="badge badge-success">✓ Paid</span>;
    case 'BLOCKED':
      return <span className="badge badge-danger">⛔ Blocked (&gt;$5k)</span>;
    case 'REJECTED':
      return <span className="badge badge-danger">✕ Rejected</span>;
    case 'FAILED':
      return <span className="badge badge-danger">⚠ Failed</span>;
    default:
      return <span className="badge badge-muted">{status}</span>;
  }
};
