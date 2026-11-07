import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppConfig } from '../types.js';

interface NavbarProps {
  config: AppConfig | null;
  onLogout: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ config, onLogout, theme, onToggleTheme }) => {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="navbar">
      <Link to="/" className="navbar-brand">
        <span>🛡️</span>
        <span>PayGuard Agent</span>
      </Link>

      <nav className="navbar-links" aria-label="Main Navigation">
        <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
          Dashboard
        </Link>
        <Link to="/check" className={`nav-link ${isActive('/check') ? 'active' : ''}`}>
          Check Email
        </Link>
        <Link to="/vendors" className={`nav-link ${isActive('/vendors') ? 'active' : ''}`}>
          Vendors
        </Link>
        <Link to="/audit" className={`nav-link ${isActive('/audit') ? 'active' : ''}`}>
          Audit Trail
        </Link>
      </nav>

      <div className="nav-actions">
        {config && (
          <>
            <span
              className={`badge ${config.paypalMode === 'mock' ? 'badge-primary' : 'badge-success'}`}
              title={config.paypalMode === 'mock' ? 'Simulating PayPal API' : 'Connected to PayPal Sandbox'}
            >
              PayPal: {config.paypalMode}
            </span>
            <span
              className={`badge ${config.aiMode === 'gemini' ? 'badge-info' : 'badge-warning'}`}
              title={config.aiMode === 'gemini' ? `Model: ${config.model}` : 'Fallback keyword reader'}
            >
              AI: {config.aiMode}
            </span>
          </>
        )}

        <button
          className="btn btn-outline"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          style={{ padding: '0.4rem 0.6rem' }}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        <button
          className="btn btn-outline"
          onClick={onLogout}
          aria-label="Log out"
          style={{ padding: '0.4rem 0.6rem' }}
        >
          Logout
        </button>
      </div>
    </header>
  );
};
