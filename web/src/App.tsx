import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './api.js';
import { AppConfig } from './types.js';
import { Navbar } from './components/Navbar.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { CheckEmailPage } from './pages/CheckEmailPage.js';
import { ProposalDetailPage } from './pages/ProposalDetailPage.js';
import { VendorsPage } from './pages/VendorsPage.js';
import { AuditPage } from './pages/AuditPage.js';

export const App: React.FC = () => {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('payguard_theme') as 'light' | 'dark') || 'light';
  });

  const checkAuth = async () => {
    try {
      const res = await api.checkAuth();
      setAuthenticated(res.authenticated);
      if (res.authenticated) {
        const cfg = await api.getConfig();
        setConfig(cfg);
      }
    } catch {
      setAuthenticated(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('payguard_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore
    }
    setAuthenticated(false);
  };

  if (authenticated === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading PayGuard Agent...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginPage onLoginSuccess={checkAuth} />;
  }

  return (
    <BrowserRouter>
      <div className="app-container">
        <Navbar
          config={config}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage config={config} />} />
            <Route path="/check" element={<CheckEmailPage />} />
            <Route path="/proposals/:id" element={<ProposalDetailPage config={config} />} />
            <Route path="/vendors" element={<VendorsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
};
