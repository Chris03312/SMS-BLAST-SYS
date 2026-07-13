import React, { useState, useEffect, useCallback } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

// ── Broadcast Detail Modal ────────────────────────────────────────────────
function BroadcastDetail({ broadcast, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filter !== 'all') params.set('status', filter);
      const data = await api.get(`/broadcasts/${broadcast.id}/messages?${params}`);
      setMessages(data.messages || []);
      setTotal(data.total || 0);
    } catch (_) {}
    setLoading(false);
  }, [broadcast.id, filter, page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.ceil(total / limit);

  function statusColor(s) {
    if (s === 'sent') return 'var(--ok)';
    if (s === 'failed') return 'var(--err)';
    return 'var(--ink-3)';
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 14,
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8,
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Broadcast Details</div>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                color: 'var(--ink-4)', background: 'var(--bg)',
                padding: '2px 7px', borderRadius: 4,
                letterSpacing: '0.02em',
              }}>
                {broadcast.id}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {broadcast.message?.slice(0, 60)}{broadcast.message?.length > 60 ? '…' : ''}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--ink-4)', alignItems: 'center' }}>
              {broadcast.started_at && (
                <span style={{ color: 'var(--ok)', whiteSpace: 'nowrap' }}>▶ Started {formatDate(broadcast.started_at)}</span>
              )}
              {broadcast.completed_at && (
                <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>✓ Ended {formatDate(broadcast.completed_at)}</span>
              )}
              {!broadcast.completed_at && broadcast.started_at && (
                <span style={{ color: 'var(--info)' }}>⟳ In progress</span>
              )}
              {broadcast.sim_mode && (
                <span style={{
                  padding: '1px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                  background: broadcast.sim_mode === 'sim2' ? 'rgba(219,39,119,0.12)'
                    : broadcast.sim_mode === 'round-robin' ? 'rgba(124,58,237,0.12)'
                    : broadcast.sim_mode === 'parallel' ? 'rgba(245,158,11,0.12)'
                    : 'rgba(5,150,105,0.12)',
                  color: broadcast.sim_mode === 'sim2' ? '#db2777'
                    : broadcast.sim_mode === 'round-robin' ? '#7c3aed'
                    : broadcast.sim_mode === 'parallel' ? '#f59e0b'
                    : '#059669',
                  fontWeight: 600,
                }}>
                  {broadcast.sim_mode === 'sim2' ? '📱2 SIM 2'
                    : broadcast.sim_mode === 'round-robin' ? '↻ Round-robin'
                    : broadcast.sim_mode === 'parallel' ? '⟗ Parallel'
                    : '📱1 SIM 1'}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="seg" style={{ fontSize: 11 }}>
              {['all', 'sent', 'failed'].map(s => (
                <button key={s} className={filter === s ? 'on' : ''} onClick={() => { setFilter(s); setPage(0); }}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={onClose} style={{
              width: 28, height: 28, padding: 0, border: 'none', borderRadius: 6,
              background: 'var(--bg-soft)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-3)', fontSize: 16, lineHeight: 1,
            }}>×</button>
          </div>
        </div>

        {/* Messages list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto 1fr',
            gap: 12, alignItems: 'center',
            padding: '8px 20px', borderBottom: '1px solid var(--line)',
            fontSize: 10, fontWeight: 600, color: 'var(--ink-4)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
            position: 'sticky', top: 0, background: '#fff', zIndex: 1,
          }}>
            <div>Recipient</div>
            <div>SIM</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div>Timestamp</div>
          </div>
          <div style={{ padding: '0 20px' }}>
          {loading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading...</div>
          )}
          {!loading && messages.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No messages found.</div>
          )}
          {!loading && messages.map((m, i) => (
            <div key={m.id || i} style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto 1fr',
              gap: 12, alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid var(--line-soft)',
              fontSize: 12,
            }}>
              {/* Recipient number */}
              <div className="num" style={{ color: 'var(--ink-1)', fontWeight: 500, fontFamily: 'var(--mono)' }}>
                {m.to_number}
              </div>
              {/* SIM / Sender */}
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {m.gateway_number && m.gateway_number2
                  ? <><span style={{ color: 'var(--brand-1)' }}>SIM1</span> / <span style={{ color: 'var(--info)' }}>SIM2</span></>
                  : (m.gateway_number || '—')
                }
              </div>
              {/* Status */}
              <div style={{
                fontSize: 11, fontWeight: 600, textAlign: 'center',
                color: statusColor(m.status),
                padding: '2px 8px', borderRadius: 4,
                background: m.status === 'sent' ? 'var(--ok-bg)' : m.status === 'failed' ? 'var(--err-bg)' : 'transparent',
              }}>
                {m.status}
              </div>
              {/* Timestamp */}
              <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)', textAlign: 'left' }}>
                {m.sent_at ? formatDate(m.sent_at) : '—'}
              </div>
            </div>
          ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px', borderTop: '1px solid var(--line)',
          fontSize: 12, color: 'var(--ink-3)',
        }}>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>{total} messages · {messages.filter(m => m.status === 'sent').length} sent · {messages.filter(m => m.status === 'failed').length} failed</span>
          </span>
          <div className="pager" style={{ margin: 0 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
            {pages > 1 && Array.from({ length: Math.min(pages, 5) }, (_, i) => (
              <button key={i} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

  const STATUSES = ['all', 'done', 'sending', 'failed', 'cancelled', 'deleted'];

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

  const [detailBroadcast, setDetailBroadcast] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);


  const pages = Math.ceil(total / limit);

  return (
    <AgentShell>

      {detailBroadcast && (
        <BroadcastDetail broadcast={detailBroadcast} onClose={() => setDetailBroadcast(null)} />
      )}

      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Broadcast History</h1>
            <div className="page-sub">All SMS broadcasts sent from your account.</div>
          </div>
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
              <th style={{ textAlign: 'left' }}>Gateways</th>
              <th style={{ textAlign: 'left' }}>To</th>
              <th style={{ textAlign: 'left' }}>Sent</th>
              <th style={{ textAlign: 'left' }}>Delivered</th>
              <th style={{ textAlign: 'left' }}>Failed</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>
            )}
            {!loading && broadcasts.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No broadcasts found.</td></tr>
            )}
            {broadcasts.map(b => (
              <tr key={b.id}>
                <td>
                  <div style={{ fontSize: 12, color: 'var(--ink-1)' }}>{formatTime(b.created_at)}</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 1, lineHeight: 1.4 }}>
                    {b.started_at && (
                      <span style={{ color: 'var(--ok)' }}>▶ {formatTime(b.started_at)}</span>
                    )}
                    {b.completed_at && (
                      <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>✓ {formatTime(b.completed_at)}</span>
                    )}
                  </div>
                  <div className="cell-id">{b.template_name || '—'}</div>
                </td>
                <td>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{b.campaign_name || '—'}</div>
                </td>
                <td style={{ maxWidth: 200 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.message}
                  </div>
                </td>
                <td><Pill status={b.status} label={b.status} /></td>
                <td className="num" style={{ fontSize: 12 }}>{(JSON.parse(b.gateway_ids || '[]').length) || 1}</td>
                <td className="num">{b.total}</td>
                <td className="num" style={{ color: 'var(--ok)' }}>{b.sent}</td>
                <td className="num" style={{ color: 'var(--info)' }}>{b.delivered || 0}</td>
                <td className="num" style={{ color: b.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{b.failed}</td>
                <td>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  {/* Cancel button — only for active broadcasts */}
                  {(b.status === 'sending' || b.status === 'paused') && (
                    <button
                      onClick={() => setConfirmCancel({
                        ...b,
                      })}
                      title="Cancel"
                      style={{
                        width: 28, height: 28, padding: 0,
                        border: '1px solid var(--err-line)',
                        borderRadius: 6, background: 'var(--err-bg)',
                        color: 'var(--err)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--err)'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setDetailBroadcast(b)}
                    title="View details"
                    style={{
                      width: 28, height: 28, padding: 0,
                      border: '1px solid var(--line)',
                      borderRadius: 6, background: 'transparent',
                      color: 'var(--ink-3)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.color = 'var(--ink-1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 16 12 12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                  </button>

                </div>
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

      {confirmCancel && (
        <ConfirmModal
          title="Cancel Broadcast"
          message={`Cancel this broadcast? ${confirmCancel.sent || 0}/${confirmCancel.total || 0} messages sent so far.`}
          confirmLabel="Cancel Broadcast"
          onConfirm={async () => {
            try {
              await api.post(`/broadcasts/${confirmCancel.id}/cancel`);
              // Update broadcast in local state immediately
              setBroadcasts(prev => prev.map(b =>
                b.id === confirmCancel.id ? { ...b, status: 'cancelled', completed_at: new Date().toISOString() } : b
              ));
            } catch (_) {}
            setConfirmCancel(null);
          }}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

    </AgentShell>
  );
}
