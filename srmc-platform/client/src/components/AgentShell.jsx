import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useWS } from '../lib/ws.js';

const TABS = [
  { label: 'Compose',  path: '/compose'  },
  { label: 'History',  path: '/history'  },
  { label: 'Templates', path: '/templates' },
  { label: 'Inbound',  path: '/inbound'  },
  { label: 'Gateway',  path: '/gateway'  },
];

export default function AgentShell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    api.get('/inbound?unread=1&limit=1')
      .then((d) => setUnreadCount(d.total || 0))
      .catch(() => {});
  }, []);

  useWS((event) => {
    if (event.type === 'inbound:new') {
      setUnreadCount((c) => c + 1);
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
      <div className="nav">
        <div className="nav-left">
          <div className="brand-mark">
            <img src="/assets/LOGO.png" alt="SRMC" />
          </div>
          <div>
            <div className="brand-title">SRMC</div>
            <div className="brand-sub">Broadcast Console</div>
          </div>
        </div>
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
          <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {children}
      </div>
    </>
  );
}
