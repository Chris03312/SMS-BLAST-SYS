import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatDate } from '../../lib/format.js';

const LEVELS = ['all', 'info', 'warn', 'error'];

export default function Activity() {
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (level !== 'all') params.set('level', level);
      const data = await api.get(`/activity?${params}`);
      setActivities(data.activities || []);
      setTotal(data.total || 0);
    } catch (e) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [level, page]);

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
    <AdminShell crumbs={['System', 'Activity']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">System</div>
          <h1>Activity Log</h1>
          <div className="page-sub">Audit trail of all platform actions across agents and broadcasts.</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {LEVELS.map(l => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => { setLevel(l); setPage(0); }}>
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </button>
          ))}
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
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && activities.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No activity found.</td></tr>}
            {activities.map((a, i) => (
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
