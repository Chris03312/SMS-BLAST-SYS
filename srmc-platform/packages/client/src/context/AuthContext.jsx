import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('srmc_token');
    if (token) {
      let serverSetUser = false; // Guard: don't overwrite server data with stale JWT

      // ── Decode JWT client-side + preload target chunk ───────────────
      // 1. Set user immediately from local JWT (instant, no server round trip)
      // 2. Preload the correct dashboard chunk BEFORE setting loading=false
      //    The splash stays visible during chunk download.
      // 3. setLoading(false) → splash fades → content renders instantly
      (async () => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          // Set user immediately so route guards have what they need
          setUser({
            id: payload.id,
            username: payload.username,
            role: payload.role,
            display_name: payload.display_name,
            active: 1,
          });
          // Preload the dashboard chunk BEFORE hiding the splash
          if (payload.role === 'admin' || payload.role === 'super_admin') {
            await import('../pages/admin/Dashboard.jsx');
          } else {
            await import('../pages/agent/Dashboard.jsx');
          }
          // Only set loading=false if the server hasn't already done so
          if (!serverSetUser) setLoading(false);
        } catch (_) {
          // Local decode failed — server check will handle it
        }
      })();

      // ── Verify with server in background ─────────────────────────
      // If the server says the token is invalid, log the user out.
      // This catches revoked tokens and role changes.
      api.get('/auth/me').then((u) => {
        serverSetUser = true;
        setUser(u.user);
      }).catch(() => {
        localStorage.removeItem('srmc_token');
        setUser(null);
      }).finally(() => {
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  async function login(username, password) {
    const data = await api.post('/auth/login', { username, password });
    localStorage.setItem('srmc_token', data.token);
    // Preload the target dashboard chunk BEFORE setting the user.
    // This ensures React.lazy() resolves instantly when route guards render.
    // Without this, the user sees a blank screen while the chunk downloads.
    const role = data.user.role;
    if (role === 'admin' || role === 'super_admin') {
      await import('../pages/admin/Dashboard.jsx');
    } else {
      await import('../pages/agent/Dashboard.jsx');
    }
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem('srmc_token');
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
