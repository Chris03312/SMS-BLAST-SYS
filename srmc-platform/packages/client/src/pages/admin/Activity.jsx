import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';

import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatDate } from '../../lib/format.js';
import { exportActivityXlsx } from '../../lib/export.js';

const LEVELS = ['all', 'info', 'warn', 'error'];

export default function Activity() {
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailActivity, setDetailActivity] = useState(null);
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
    <AdminShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">System</div>
          <h1>Activity Log</h1>
          <div className="page-sub">Audit trail of all platform actions across agents and broadcasts.</div>
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
              <th style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && activities.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No activity found.</td></tr>}
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
                <td style={{ textAlign: 'center' }}>
                  <button
                    className="iconlink"
                    onClick={() => setDetailActivity(a)}
                    title="View details"
                    style={{ fontSize: 14 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 16 12 12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {detailActivity && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) setDetailActivity(null); }}
          >
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Activity Details</span>
                <button onClick={() => setDetailActivity(null)} style={{ width: 28, height: 28, padding: 0, border: 'none', borderRadius: 6, background: 'var(--bg-soft)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 12px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)' }}>Timestamp</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{formatDate(detailActivity.created_at)}</span>

                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)' }}>User</span>
                    <span>{detailActivity.user_name || '—'}</span>

                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)' }}>Campaign</span>
                    <span style={{ color: detailActivity.campaign_name ? 'var(--brand-1)' : 'var(--ink-4)', fontWeight: detailActivity.campaign_name ? 500 : 400 }}>
                      {detailActivity.campaign_name || '—'}
                    </span>

                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)' }}>Action</span>
                    <span style={{ fontWeight: 600 }}>{detailActivity.action}</span>

                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)' }}>Level</span>
                    <span>
                      <span className={`pill ${detailActivity.level === 'error' ? 'err' : detailActivity.level === 'warn' ? 'warn' : 'idle'}`} style={{ fontSize: 10, padding: '2px 7px' }}>
                        <span className="dot" />
                        {detailActivity.level || 'info'}
                      </span>
                    </span>
                  </div>

                  {detailActivity.detail && (
                    <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10, marginTop: 2 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', marginBottom: 4 }}>Detail</div>
                      <div style={{ color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg-soft)', borderRadius: 6, padding: '8px 10px' }}>
                        {detailActivity.detail}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

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
