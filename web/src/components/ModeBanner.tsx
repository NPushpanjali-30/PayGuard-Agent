import React from 'react';
import { AppConfig } from '../types.js';

interface ModeBannerProps {
  config: AppConfig | null;
}

export const ModeBanner: React.FC<ModeBannerProps> = ({ config }) => {
  if (!config) return null;

  return (
    <div className="banner-container" role="region" aria-label="System status notifications">
      {config.paypalMode === 'mock' && (
        <div className="mode-banner mock">
          <div>
            <strong>💳 PayPal Mode: MOCK</strong> — Simulates OAuth tokens, Payouts creation, and status transitions after 3 seconds with zero external credentials.
          </div>
          <span className="badge badge-info">Zero-Cred Ready</span>
        </div>
      )}

      {config.aiMode === 'fallback' && (
        <div className="mode-banner fallback">
          <div>
            <strong>🤖 No AI key: cautious fallback reader</strong> — Running deterministic heuristic engine. Payment requests will never return a bare CLEAR (mandates CHECK verification).
          </div>
          <span className="badge badge-warning">Cautious Fallback</span>
        </div>
      )}
    </div>
  );
};
