import React, { useState, useEffect } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

export default function History() {
  const [broadcasts, setBroadcasts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [page, setPage] = useState(0);
  const limit = 20;

  const STATUSES = ['all', 'done', 'sending', 'failed', 'cancelled'];

  // Load campaigns list on mount
  useEffect(() => {
    api.get('/campaigns').then(d => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit,
        offset: page * limit,
        ...(search ? { search } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(campaignFilter ? { campaign_id: campaignFilter } : {}),
      });
      const data = await api.get(`/broadcasts?${params}`);
      setBroadcasts(data.broadcasts || []);
      setTotal(data.total || 0);
    } catch (e) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [search, statusFilter, campaignFilter, page]);

  function formatTime(iso) {
    return formatDate(iso);
  }

  const pages = Math.ceil(total / limit);

  return (
    <AgentShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Broadcast History</h1>
          <div className="page-sub">All SMS broadcasts sent from your account.</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          <input
            placeholder="Search broadcasts..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <div className="seg">
          {STATUSES.map(s => (
            <button key={s} className={statusFilter === s ? 'on' : ''} onClick={() => { setStatusFilter(s); setPage(0); }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select
          className="input"
          value={campaignFilter}
          onChange={e => { setCampaignFilter(e.target.value); setPage(0); }}
          style={{ fontSize: 12, padding: '6px 10px', maxWidth: 180, marginLeft: 'auto' }}
        >
          <option value="">All campaigns</option>
          {campaigns.filter(c => c.status === 'active').map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Broadcasts</h3>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{total} total</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Campaign</th>
              <th>Message</th>
              <th>Status</th>
              <th>Gateways</th>
              <th>Recipients</th>
              <th>Delivered</th>
              <th>Failed</th>
              <th>Number</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>
            )}
            {!loading && broadcasts.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No broadcasts found.</td></tr>
            )}
            {broadcasts.map(b => (
              <tr key={b.id}>
                <td>
                  <div style={{ fontSize: 12, color: 'var(--ink-1)' }}>{formatTime(b.created_at)}</div>
                  <div className="cell-id">{b.template_name || '—'}</div>
                </td>
                <td>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{b.campaign_name || '—'}</div>
                </td>
                <td style={{ maxWidth: 220 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.message}
                  </div>
                </td>
                <td><Pill status={b.status} label={b.status} /></td>
                <td className="num" style={{ fontSize: 12 }}>{(JSON.parse(b.gateway_ids || '[]').length) || 1}</td>
                <td className="num">{b.total}</td>
                <td className="num" style={{ color: 'var(--ok)' }}>{b.sent}</td>
                <td className="num" style={{ color: b.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{b.failed}</td>
                <td className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{b.gateway_number || '—'}</td>
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
    </AgentShell>
  );
}
