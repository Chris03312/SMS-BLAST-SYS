import React, { useState, useEffect, useCallback } from 'react';

import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

const NAV_ITEMS = [
  { section: 'Overview', items: [
    { label: 'Dashboard', path: '/admin', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    )},
  ]},
  { section: 'Operations', items: [
    { label: 'Campaigns', path: '/admin/campaigns', badge: null, icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3h18v4H3z"/><path d="M3 10h18v4H3z"/><path d="M3 17h18v4H3z"/>
      </svg>
    )},
    { label: 'Templates', path: '/admin/templates', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    )},
    { label: 'Inbound', path: '/admin/inbound', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
      </svg>
    )},
    { label: 'Analytics', path: '/admin/analytics', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
      </svg>
    )},
  ]},
  { section: 'People & Devices', items: [
    { label: 'Agents', path: '/admin/agents', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    )},
    { label: 'Admins', path: '/admin/admins', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ), adminOnly: true },
    { label: 'Numbers', path: '/admin/numbers', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
        <line x1="12" y1="18" x2="12.01" y2="18"/>
      </svg>
    )},
  ]},
  { section: 'System', items: [
    { label: 'Webhooks', path: '/admin/webhooks', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    )},
    { label: 'Activity', path: '/admin/activity', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    )},
    { label: 'Settings', path: '/admin/settings', icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    )},
  ]},
];

export default function AdminShell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [connectivity, setConnectivity] = useState(null);
  const [showNetInfo, setShowNetInfo] = useState(false);

  const fetchConnectivity = useCallback(() => {
    api.get('/server/connectivity')
      .then(d => setConnectivity(d))
      .catch(() => setConnectivity({ online: true, lan: { primary_url: '' }, ngrok: { running: false } }));
  }, []);

  useEffect(() => {
    fetchConnectivity();
    const interval = setInterval(fetchConnectivity, 60_000);
    return () => clearInterval(interval);
  }, [fetchConnectivity]);

  function handleLogout() { logout(); }

  function initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        {/* ── Sidebar header (brand) ── */}
        <div className="sb-header">
          <div className="brand-mark">
            <img src="/assets/LOGO.png" alt="SRMC" />
          </div>
          <div>
            <div className="brand-title">SRMC Admin</div>
            <div className="brand-sub">Management Portal</div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <div className="sb-nav">
          {NAV_ITEMS.map((group) => (
            <React.Fragment key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items
                .filter(item => !item.adminOnly || user?.role === 'super_admin')
                .map((item) => {
                  // Exact match for /admin, otherwise check path + search params
                  let isActive;
                  if (item.path === '/admin') {
                    isActive = location.pathname === '/admin';
                  } else {
                    // Regular items — exact path match to avoid conflicts
                    const basePath = item.path.endsWith('/') ? item.path : item.path + '/';
                    isActive = location.pathname === item.path || location.pathname.startsWith(basePath);
                  }
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`nav-item${isActive ? ' active' : ''}`}
                    >
                      {item.icon}
                      {item.label}
                      {item.badge != null && (
                        <span className="badge">{item.badge}</span>
                      )}
                    </Link>
                  );
                })}
            </React.Fragment>
          ))}
        </div>

        {/* ── Sidebar footer (user + system info) ── */}
        <div className="sb-footer">
          {/* User chip */}
          <div className="sb-user" onClick={handleLogout} title="Sign out">
            <div className="user-avatar">{initials(user?.display_name)}</div>
            <div className="sb-user-info">
              <div className="user-name">{user?.display_name || user?.username}</div>
              <div className="user-role">{user?.role === 'super_admin' ? 'Super admin' : user?.role}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', color: 'var(--ink-4)', flexShrink: 0 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>

          {/* System info card */}
          <div className="sys-card">
            <div className="sys-title">
              <span className="ok-dot" />
              System
            </div>
            <div className="sys-row"><span>v1.0.0</span></div>
          </div>
        </div>
      </aside>

      <main className="main">
        {children}
      </main>
    </div>
  );
}

function InfoRow({ label, value, good }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 500,
        color: good ? 'var(--ok)' : 'var(--warn)',
      }}>
        {value}
      </span>
    </div>
  );
}
