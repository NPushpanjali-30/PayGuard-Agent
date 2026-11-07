import React from 'react';
import { Flag } from '../types.js';

interface FlagListProps {
  flags: Flag[];
}

export const FlagList: React.FC<FlagListProps> = ({ flags }) => {
  if (flags.length === 0) {
    return (
      <div className="card" style={{ padding: '1rem', color: 'var(--success)', fontWeight: 600 }}>
        ✓ Zero security flags detected. Email passed all 16 deterministic checks.
      </div>
    );
  }

  return (
    <div className="flags-list" aria-label="Detected Security Flags">
      {flags.map((flag, idx) => (
        <div key={`${flag.id}-${idx}`} className={`flag-item ${flag.severity.toLowerCase()}`}>
          <div className="flag-title">
            <span>{flag.title}</span>
            <span
              className={`badge ${
                flag.severity === 'HIGH'
                  ? 'badge-danger'
                  : flag.severity === 'MEDIUM'
                  ? 'badge-warning'
                  : 'badge-info'
              }`}
            >
              {flag.severity}
            </span>
          </div>
          <p className="flag-evidence">{flag.evidence}</p>
        </div>
      ))}
    </div>
  );
};
