import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useWS, useConnectionStatus } from '../lib/ws.js';

const TABS = [
  { label: 'Broadcast Task', path: '/dashboard' },
  { label: 'Compose',   path: '/compose'   },
  { label: 'History',   path: '/history'   },
  { label: 'Templates', path: '/templates' },
  { label: 'Inbound',   path: '/inbound'   },
  { label: 'Gateway',   path: '/gateway'   },
];

export default function AgentShell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectivity, setConnectivity] = useState(null); // null = loading, object = status
  const [showNetInfo, setShowNetInfo] = useState(false);
  const [broadcastsPaused, setBroadcastsPaused] = useState(false);
  const wsStatus = useConnectionStatus();

  const fetchConnectivity = useCallback(() => {
    api.get('/server/connectivity')
      .then(d => setConnectivity(d))
      .catch(() => setConnectivity({ online: true, lan: { primary_url: '' }, ngrok: { running: false } }));
  }, []);

  useEffect(() => {
    api.get('/inbound?unread=1&limit=1')
      .then((d) => setUnreadCount(d.total || 0))
      .catch(() => {});
    api.get('/settings')
      .then(s => setBroadcastsPaused(s.broadcasts_globally_paused === 'true'))
      .catch(() => {});
    fetchConnectivity();
    const interval = setInterval(fetchConnectivity, 60_000);
    return () => clearInterval(interval);
  }, [fetchConnectivity]);

  useWS((event) => {
    if (event.type === 'inbound:new') {
      setUnreadCount((c) => c + 1);
    }
    if (event.type === 'ngrok:status' || event.type === 'connectivity:change') {
      fetchConnectivity();
    }
    if (event.type === 'broadcasts:global-pause') {
      setBroadcastsPaused(event.paused);
    }
  });

  function initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function handleLogout() {
    logout();
  }

  return (
    <>
      {/* ── Global Pause Banner ── */}
      {broadcastsPaused && (
        <div style={{
          background: '#EF4444', color: '#fff',
          textAlign: 'center', fontSize: 13, fontWeight: 600,
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
          Broadcasting paused by admin — no new broadcasts can be sent until resumed
        </div>
      )}
      <div className="nav">
        <Link to="/dashboard" className="nav-left" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <div className="brand-mark">
            <img src="/assets/SRMC_LOGO.jpg" alt="SMS Platform" style={{ width: 32, height: 32 }} />
          </div>
          <div>
            <div className="brand-title">SMS Platform</div>
            <div className="brand-sub">Broadcast Console</div>
          </div>
        </Link>
        <div className="nav-tabs">
          {TABS.map((tab) => {
            const isActive = location.pathname === tab.path;
            const isInbound = tab.path === '/inbound';
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`nav-tab${isActive ? ' active' : ''}`}
              >
                {tab.label}
                {isInbound && unreadCount > 0 && (
                  <span className="nav-badge">{unreadCount}</span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="nav-right">
          <div className="user-chip">
            <div className="user-avatar">{initials(user?.display_name)}</div>
            <div>
              <div className="user-name">{user?.display_name || user?.username}</div>
              <div className="user-role">agent</div>
            </div>
          </div>
          {/* WebSocket status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={`WebSocket: ${wsStatus}`}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: wsStatus === 'open' ? 'var(--ok)'
                : wsStatus === 'connecting' ? 'var(--warn)'
                : 'var(--err)',
              transition: 'background 0.3s',
              flexShrink: 0,
            }} />
          </div>

          {/* Network status indicator */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn-ghost"
              onClick={() => setShowNetInfo(s => !s)}
              title="Network status"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, padding: '4px 8px',
              }}
            >
              {/* Dot indicator */}
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: connectivity === null ? 'var(--ink-4)'
                  : connectivity.online ? 'var(--ok)'
                  : 'var(--warn)',
                transition: 'background 0.3s',
                flexShrink: 0,
              }} />
              {connectivity?.online !== false ? 'Online' : 'Offline'}
            </button>

            {/* Network info popover */}
            {showNetInfo && connectivity && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowNetInfo(false)} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 100,
                  background: '#fff', border: '1px solid var(--line)',
                  borderRadius: 10, padding: 14, width: 260,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  fontSize: 12, lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8, fontSize: 13 }}>
                    Connection status
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <InfoRow label="Internet" value={connectivity.online ? 'Connected' : 'Offline'} good={connectivity.online} />
                    <InfoRow label="Tunnel" value={connectivity.ngrok?.running ? connectivity.ngrok.url : 'Not running'} good={connectivity.ngrok?.running} />
                    <InfoRow label="LAN" value={connectivity.lan?.primary_url ? 'Available' : 'Not detected'} good={!!connectivity.lan?.primary_url} />

                  </div>

                  {connectivity.lan?.primary_url && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
                      <div style={{ fontWeight: 500, color: 'var(--ink-2)', marginBottom: 4 }}>PC Address</div>
                      <code style={{
                        display: 'block', padding: '5px 8px',
                        background: 'var(--bg-soft)', borderRadius: 5,
                        fontSize: 11, color: 'var(--brand-1)',
                        userSelect: 'all', fontFamily: 'var(--mono)',
                        wordBreak: 'break-all',
                      }}>
                        {connectivity.lan.primary_url}
                      </code>
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 3 }}>
                        Use this on your Android gateway app (same Wi-Fi)
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {children}
      </div>
    </>
  );
}

function InfoRow({ label, value, good }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>{label}</span>
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: good ? 'var(--ok)' : 'var(--warn)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: 160,
      }}>
        {value}
      </span>
    </div>
  );
}
