import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';

import { api } from '../../lib/api.js';
import { PageCache } from '../../lib/page-cache.js';
import { useWS } from '../../lib/ws.js';
import { formatDate } from '../../lib/format.js';
import { exportActivityXlsx } from '../../lib/export.js';
import { SkeletonTable } from '../../components/Skeleton.jsx';

const LEVELS = ['all', 'info', 'warn', 'error'];

export default function Activity() {
  const CACHE_KEY = 'admin-activity';
  const cached = PageCache.get(CACHE_KEY);
  const [activities, setActivities] = useState(cached?.activities || []);
  const [total, setTotal] = useState(cached?.total || 0);
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(!cached);
  const [search, setSearch] = useState('');
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (level !== 'all') params.set('level', level);
      const data = await api.get(`/activity?${params}`);
      setActivities(data.activities || []);
      setTotal(data.total || 0);
      PageCache.set(CACHE_KEY, data);
    } catch (e) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [level, page]);

  const filtered = activities.filter(a =>
    !search ||
    (a.user_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.action || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.detail || '').toLowerCase().includes(search.toLowerCase()) ||
    (a.campaign_name || '').toLowerCase().includes(search.toLowerCase())
  );

  useWS((event) => {
    if (event.type === 'activity:new') {
      setActivities(prev => [{ ...event, id: Date.now() + Math.random() }, ...prev].slice(0, 50));
      setTotal(t => t + 1);
    }
  });

  function formatTime(iso) {
    if (!iso) return '—';
    return formatDate(iso);
  }

  const pages = Math.ceil(total / limit);

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">System</div>
            <h1>Activity Log</h1>
            <div className="page-sub">Audit trail of all platform actions across agents and broadcasts.</div>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => exportActivityXlsx({ level })}
          style={{ fontSize: 12, padding: '7px 14px' }}
          title="Export all activity as Excel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export Excel
        </button>
      </div>

      <div className="toolbar">
        <div className="seg">
          {LEVELS.map(l => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => { setLevel(l); setPage(0); }}>
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-soft)', borderRadius: 7, padding: '6px 10px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: 'var(--ink-1)', width: 180, fontFamily: 'inherit' }}
            placeholder="Search by user, action or detail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Campaign</th>
              <th>Action</th>
              <th>Detail</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {loading && activities.length === 0 && <SkeletonTable cols={6} rows={5} />}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>{search ? 'No activity matches your search.' : 'No activity found.'}</td></tr>}
            {filtered.map((a, i) => (
              <tr key={a.id || i}>
                <td className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatTime(a.created_at)}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-2)' }}>{a.user_name || '—'}</td>
                <td>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: a.campaign_name ? 'var(--brand-1)' : 'var(--ink-4)',
                  }}>
                    {a.campaign_name || '—'}
                  </span>
                </td>
                <td style={{ fontSize: 13, fontWeight: 500 }}>{a.action}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 320 }}>{a.detail || '—'}</td>
                <td>
                  <span className={`pill ${a.level === 'error' ? 'err' : a.level === 'warn' ? 'warn' : 'idle'}`}>
                    <span className="dot" />
                    {a.level || 'info'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="footer">
          <span>Showing {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="pager">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => (
              <button key={i} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>›</button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
