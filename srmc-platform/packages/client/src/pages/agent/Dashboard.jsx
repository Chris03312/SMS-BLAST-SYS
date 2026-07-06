import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatTime } from '../../lib/format.js';

// ── Broadcast Detail Modal ────────────────────────────────────────────────
function BroadcastDetail({ broadcast, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 50;
  const isActive = broadcast.status === 'sending' || broadcast.status === 'paused';

  // Silent fetch — doesn't touch loading state (used by poll)
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (filter !== 'all') params.set('status', filter);
      const data = await api.get(`/broadcasts/${broadcast.id}/messages?${params}`);
      setMessages(data.messages || []);
      setTotal(data.total || 0);
    } catch (_) { }
  }, [broadcast.id, filter, page]);

  // Full load with loading spinner (first load + filter/page change)
  const loadWithLoading = useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

  useEffect(() => { loadWithLoading(); }, [loadWithLoading]);

  // ── Live auto-refresh: poll every 2s while broadcast is active ──
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => { load(); }, 2000);
    return () => clearInterval(interval);
  }, [isActive, load]);

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
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid var(--line)',
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Broadcast Details</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {broadcast.message?.slice(0, 60)}{broadcast.message?.length > 60 ? '…' : ''}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--ink-4)', alignItems: 'center' }}>
              {broadcast.started_at && (
                <span style={{ color: 'var(--ok)' }}>▶ Started {formatTime(broadcast.started_at)}</span>
              )}
              {broadcast.completed_at && (
                <span style={{ color: 'var(--ink-3)' }}>✓ Ended {formatTime(broadcast.completed_at)}</span>
              )}
              {!broadcast.completed_at && broadcast.started_at && (
                <span style={{ color: 'var(--info)' }}>⟳ In progress</span>
              )}
              {broadcast.sim_mode && (
                <span style={{
                  padding: '1px 7px', borderRadius: 4,
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

        {/* Messages table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient #</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', width: 120 }}>SIM</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', width: 80 }}>Status</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', width: '40%' }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>Loading...</td></tr>
              )}
              {!loading && messages.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>No messages found.</td></tr>
              )}
              {!loading && messages.map((m, i) => (
                <tr key={m.id || i} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  {/* Recipient number */}
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--ink-1)' }}>
                    {m.to_number}
                  </td>
                  {/* SIM */}
                  <td style={{ padding: '8px 16px', fontSize: 11, color: 'var(--ink-3)' }}>
                    {m.gateway_number && m.gateway_number2
                      ? <><span style={{ color: 'var(--brand-1)', fontWeight: 600 }}>SIM1</span> / <span style={{ color: 'var(--info)', fontWeight: 600 }}>SIM2</span></>
                      : (m.gateway_number || '—')
                    }
                  </td>
                  {/* Status */}
                  <td style={{ padding: '8px 16px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: statusColor(m.status),
                      padding: '2px 8px', borderRadius: 4,
                      background: m.status === 'sent' ? 'var(--ok-bg)' : m.status === 'failed' ? 'var(--err-bg)' : 'transparent',
                      cursor: m.error ? 'help' : 'default',
                    }} title={m.error || undefined}>
                      {m.status}
                    </span>
                  </td>
                  {/* Remarks */}
                  <td style={{
                    padding: '8px 16px', fontSize: 11, lineHeight: 1.4,
                    color: m.status === 'failed' ? 'var(--err)' : 'var(--ink-4)',
                    fontFamily: 'var(--mono)', wordBreak: 'break-word',
                  }}>
                    {m.status === 'failed' && m.error ? m.error
                     : m.sent_at ? formatTime(m.sent_at)
                     : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px', borderTop: '1px solid var(--line)',
          fontSize: 12, color: 'var(--ink-3)',
        }}>
          <span>{total} messages · {messages.filter(m => m.status === 'sent').length} sent · {messages.filter(m => m.status === 'failed').length} failed</span>
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

const STATUSES = ['all', 'sending', 'paused', 'done', 'failed', 'cancelled'];

export default function Dashboard() {
  const navigate = useNavigate();
  const [broadcasts, setBroadcasts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [stats, setStats] = useState({ sent: 0, failed: 0, delivered: 0, active: 0, paused: 0 });
  const limit = 20;

  async function loadBroadcasts() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit,
        offset: page * limit,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      const data = await api.get(`/broadcasts?${params}`);
      setBroadcasts(data.broadcasts || []);
      setTotal(data.total || 0);

      // Compute stats from all broadcasts
      const all = await api.get('/broadcasts?limit=1000');
      const list = all.broadcasts || [];
      setStats({
        sent: list.reduce((s, b) => s + (b.sent || 0), 0),
        failed: list.reduce((s, b) => s + (b.failed || 0), 0),
        delivered: list.reduce((s, b) => s + (b.delivered || 0), 0),
        active: list.filter(b => b.status === 'sending').length,
        paused: list.filter(b => b.status === 'paused').length,
      });
    } catch (e) { }
    setLoading(false);
  }

  useEffect(() => { loadBroadcasts(); }, [statusFilter, page]);

  // Real-time WebSocket updates
  useWS((event) => {
    if (event.type === 'broadcast:progress' || event.type === 'broadcast:complete') {
      setBroadcasts(prev => {
        const idx = prev.findIndex(b => b.id === event.broadcastId);
        if (idx >= 0) {
          // Update existing broadcast
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            sent: event.sent ?? updated[idx].sent,
            failed: event.failed ?? updated[idx].failed,
            total: event.total ?? updated[idx].total,
            status: event.status ?? updated[idx].status,
          };
          return updated;
        }
        // New broadcast — add it to the list (only for 'sending' status to avoid stale entries)
        if (event.status === 'sending' || event.status === 'paused') {
          return [{ id: event.broadcastId, sent: event.sent || 0, failed: event.failed || 0, total: event.total || 0, status: event.status, started_at: event.started_at }, ...prev];
        }
        return prev;
      });

      // Update stats
      if (event.type === 'broadcast:progress') {
        setStats(s => ({
          ...s,
          active: event.status === 'sending' ? s.active + (event.sent === 0 ? 1 : 0) : s.active,
        }));
      }
      if (event.type === 'broadcast:complete') {
        setStats(s => ({ ...s, active: Math.max(0, s.active - 1) }));
        // Re-run load to sync from server
        loadBroadcasts();
      }
    }
    if (event.type === 'broadcast:paused') {
      setBroadcasts(prev => {
        const idx = prev.findIndex(b => b.id === event.broadcastId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'paused' };
          return updated;
        }
        return prev;
      });
      setStats(s => ({ ...s, active: Math.max(0, s.active - 1), paused: s.paused + 1 }));
    }
    if (event.type === 'broadcast:resumed') {
      setBroadcasts(prev => {
        const idx = prev.findIndex(b => b.id === event.broadcastId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status: 'sending' };
          return updated;
        }
        return prev;
      });
      setStats(s => ({ ...s, active: s.active + 1, paused: Math.max(0, s.paused - 1) }));
    }
  });

  // ── Actions ──────────────────────────────────────────────────────

  async function handleCancel(broadcast) {
    try {
      await api.del(`/broadcasts/${broadcast.id}`);
      setBroadcasts(prev => prev.map(b =>
        b.id === broadcast.id ? { ...b, status: 'cancelled' } : b
      ));
      setStats(s => ({ ...s, active: Math.max(0, s.active - 1), paused: Math.max(0, s.paused - 1) }));
    } catch (e) {
      console.error('Cancel failed:', e);
    }
  }

  async function handlePause(broadcast) {
    try {
      await api.post(`/broadcasts/${broadcast.id}/pause`);
    } catch (e) {
      console.error('Pause failed:', e);
    }
  }

  async function handleResume(broadcast) {
    try {
      await api.post(`/broadcasts/${broadcast.id}/resume`);
    } catch (e) {
      console.error('Resume failed:', e);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function pct(sent, total) {
    if (!total || total === 0) return 0;
    return Math.round((sent / total) * 100);
  }

  function progressColor(p) {
    if (p >= 100) return 'var(--ok)';
    if (p >= 50) return 'var(--brand-1)';
    if (p >= 25) return 'var(--warn)';
    return 'var(--info)';
  }

  function statusLabel(status) {
    switch (status) {
      case 'sending': return 'Sending';
      case 'paused': return 'Paused';
      case 'done': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'failed': return 'Failed';
      case 'pending': return 'Queued';
      default: return status;
    }
  }

  const [detailBroadcastId, setDetailBroadcastId] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  // Derive live-updating detail broadcast from the broadcasts array
  const detailBroadcast = detailBroadcastId
    ? broadcasts.find(b => b.id === detailBroadcastId) || null
    : null;

  // Close detail modal if broadcast gets deleted
  useEffect(() => {
    if (detailBroadcastId && !detailBroadcast) {
      setDetailBroadcastId(null);
    }
  }, [detailBroadcastId, detailBroadcast]);

  const pages = Math.ceil(total / limit);

  return (
    <>
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel || 'Confirm'}
          danger={confirmAction.danger !== false}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <AgentShell>

      {detailBroadcast && (
        <BroadcastDetail broadcast={detailBroadcast} onClose={() => setDetailBroadcastId(null)} />
      )}
      <div className="page-head">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Dashboard</h1>
          <div className="page-sub">
            Real-time broadcast monitoring and control center.
            Broadcasts run in the background — navigate freely while they send.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LiveBadge label="Live" />
          <button className="btn-primary" onClick={() => navigate('/compose')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Compose Broadcast
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Active', value: stats.active, color: 'var(--info)' },
          { label: 'Paused', value: stats.paused, color: 'var(--warn)' },
          { label: 'Total Sent', value: stats.sent.toLocaleString('en-PH'), color: 'var(--ok)' },
          { label: 'Delivered', value: stats.delivered.toLocaleString('en-PH'), color: 'var(--info)' },
          { label: 'Total Failed', value: stats.failed.toLocaleString('en-PH'), color: stats.failed > 0 ? 'var(--err)' : 'var(--ink-3)' },
          { label: 'Broadcasts', value: total, color: 'var(--ink-1)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, color: s.color, lineHeight: 1.1 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Background broadcast info banner */}
      {(stats.active > 0 || stats.paused > 0) && (
        <div style={{
          padding: '10px 16px', marginBottom: 16,
          background: 'var(--info-bg)', border: '1px solid var(--info-line)',
          borderRadius: 10, fontSize: 12, color: 'var(--info)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <LiveBadge label={stats.active > 0 ? 'Running' : 'Paused'} />
          <span>
            {stats.active > 0
              ? `${stats.active} broadcast(s) currently sending in the background. You can navigate away — they'll keep running.`
              : `${stats.paused} broadcast(s) paused. Resume them to continue sending.`
            }
          </span>
        </div>
      )}

      {/* Status filter */}
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="seg">
          {STATUSES.map(s => (
            <button
              key={s}
              className={statusFilter === s ? 'on' : ''}
              onClick={() => { setStatusFilter(s); setPage(0); }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 'auto' }}>
          {total} total
        </span>
      </div>

      {/* Broadcasts table */}
      <div className="card">
        <div className="card-head">
          <h3>Broadcasts</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 180 }}>Broadcast</th>
              <th>Campaign</th>
              <th style={{ textAlign: 'left' }}>Sender</th>
              <th style={{ textAlign: 'left' }}>Recipients</th>
              <th style={{ minWidth: 180 }}>Progress</th>
              <th style={{ textAlign: 'left' }}>Sent</th>
              <th style={{ textAlign: 'left' }}>Delivered</th>
              <th style={{ textAlign: 'left' }}>Failed</th>
              <th>Status</th>
              <th style={{ textAlign: 'center', minWidth: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '32px 18px' }}>
                Loading broadcasts...
              </td></tr>
            )}
            {!loading && broadcasts.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '40px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
                  No broadcasts found
                </div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>
                  {statusFilter === 'all' ? 'Click "Compose Broadcast" to send your first message.' : 'No broadcasts match the selected filter.'}
                </div>
                {statusFilter === 'all' && (
                  <button className="btn-primary" onClick={() => navigate('/compose')}>
                    Compose Broadcast
                  </button>
                )}
              </td></tr>
            )}
            {broadcasts.map(b => {
              // Count both sent and delivered as progress (engine stores both in b.sent)
              const progress = pct(b.sent, b.total);
              const color = progressColor(progress);
              const isSending = b.status === 'sending';
              const isPaused = b.status === 'paused';
              const isActive = isSending || isPaused;
              const isTerminal = b.status === 'done' || b.status === 'cancelled' || b.status === 'failed';

              return (
                <tr key={b.id}>
                  {/* Broadcast name / message preview */}
                  <td>
                    <div style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--ink-1)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      maxWidth: 200,
                    }} title={b.message}>
                      {b.message?.slice(0, 40)}{b.message?.length > 40 ? '…' : ''}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                      {formatTime(b.created_at)}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', marginTop: 1, lineHeight: 1.4 }}>
                      {b.started_at && (
                        <span style={{ color: 'var(--ok)' }}>▶ {formatTime(b.started_at)}</span>
                      )}
                      {b.completed_at && (
                        <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>✓ {formatTime(b.completed_at)}</span>
                      )}
                      {b.status === 'sending' && b.started_at && (
                        <span style={{ color: 'var(--info)', marginLeft: 4 }}>⟳</span>
                      )}
                    </div>
                  </td>

                  {/* Campaign */}
                  <td>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
                      {b.campaign_name || '—'}
                    </span>
                  </td>

                  {/* Sender # — show correct number based on sim_mode */}
                  <td className="num" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                    {b.sim_mode === 'sim2' && b.gateway_number2
                      ? b.gateway_number2
                      : b.sim_mode === 'round-robin'
                        ? `${b.gateway_number || '—'} / ${b.gateway_number2 || '—'}`
                        : b.sim_mode === 'parallel'
                        ? `${b.gateway_number || '—'} + ${b.gateway_number2 || '—'}`
                        : (b.gateway_number || '—')
                    }
                    {b.sim_mode && (
                      <span style={{
                        marginLeft: 4, fontSize: 9, fontWeight: 600,
                        padding: '1px 4px', borderRadius: 3,
                        background: b.sim_mode === 'sim2' ? 'rgba(219,39,119,0.12)'
                          : b.sim_mode === 'round-robin' ? 'rgba(124,58,237,0.12)'
                          : b.sim_mode === 'parallel' ? 'rgba(245,158,11,0.12)'
                          : 'rgba(5,150,105,0.12)',
                        color: b.sim_mode === 'sim2' ? '#db2777'
                          : b.sim_mode === 'round-robin' ? '#7c3aed'
                          : b.sim_mode === 'parallel' ? '#f59e0b'
                          : '#059669',
                        verticalAlign: 'middle',
                      }}>{b.sim_mode === 'sim2' ? '📱2' : b.sim_mode === 'round-robin' ? '↻' : b.sim_mode === 'parallel' ? '⟗' : '📱1'}</span>
                    )}
                  </td>

                  {/* Recipients count */}
                  <td className="num" style={{ fontSize: 13 }}>
                    {b.total || 0}
                  </td>

                  {/* Progress bar */}
                  <td style={{ minWidth: 180 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        flex: 1, height: 8, background: 'var(--bg-soft)',
                        borderRadius: 4, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${Math.max(progress, isActive ? 2 : 0)}%`,
                          background: color,
                          borderRadius: 4,
                          transition: 'width 0.5s ease, background 0.3s',
                          minWidth: isActive ? 4 : 0,
                          boxShadow: isSending ? `0 0 6px ${color}40` : 'none',
                        }} />
                      </div>
                      <span className="num" style={{
                        fontSize: 11, fontWeight: 600, minWidth: 36, textAlign: 'left',
                        color: isTerminal ? 'var(--ink-3)' : color,
                      }}>
                        {progress}%
                      </span>
                    </div>
                  </td>

                  {/* Sent */}
                  <td className="num" style={{ fontSize: 13, color: 'var(--ok)' }}>
                    {b.sent || 0}
                  </td>

                  {/* Delivered */}
                  <td className="num" style={{ fontSize: 13, color: 'var(--info)' }}>
                    {b.delivered || 0}
                  </td>

                  {/* Failed */}
                  <td className="num" style={{
                    fontSize: 13,
                    color: (b.failed || 0) > 0 ? 'var(--err)' : 'var(--ink-3)',
                  }}>
                    {b.failed || 0}
                  </td>

                  {/* Status */}
                  <td>
                    <Pill status={b.status} label={statusLabel(b.status)} />
                  </td>

                  {/* Actions — icon buttons + detail */}
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                      {/* Detail icon — always visible */}
                      <button
                        onClick={() => setDetailBroadcastId(b.id)}
                        title="View details"
                        style={{
                          width: 28, height: 28, padding: 0,
                          border: '1px solid var(--line)',
                          borderRadius: 6, background: 'transparent',
                          color: 'var(--ink-3)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.color = 'var(--ink-1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" /><polyline points="12 16 12 12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                      </button>
                      {isSending && (
                        <>
                          <button
                            onClick={() => handlePause(b)}
                            title="Pause"
                            style={{
                              width: 28, height: 28, padding: 0,
                              border: '1px solid var(--warn-line)',
                              borderRadius: 6, background: 'var(--warn-bg)',
                              color: 'var(--warn)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--warn)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--warn-bg)'; e.currentTarget.style.color = 'var(--warn)'; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setConfirmAction({
                              title: 'Cancel Broadcast',
                              message: `Cancel this broadcast? ${b.sent || 0}/${b.total || 0} messages have been sent.`,
                              confirmLabel: 'Cancel Broadcast',
                              onConfirm: () => { handleCancel(b); setConfirmAction(null); },
                            })}
                            title="Cancel"
                            style={{
                              width: 28, height: 28, padding: 0,
                              border: '1px solid var(--err-line)',
                              borderRadius: 6, background: 'var(--err-bg)',
                              color: 'var(--err)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--err)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </>
                      )}
                      {isPaused && (
                        <>
                          <button
                            onClick={() => handleResume(b)}
                            title="Resume"
                            style={{
                              width: 28, height: 28, padding: 0,
                              border: '1px solid var(--ok-line)',
                              borderRadius: 6, background: 'var(--ok-bg)',
                              color: 'var(--ok)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--ok)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--ok-bg)'; e.currentTarget.style.color = 'var(--ok)'; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5,3 19,12 5,21" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setConfirmAction({
                              title: 'Cancel Broadcast',
                              message: `Cancel this paused broadcast? ${b.sent || 0}/${b.total || 0} messages have been sent.`,
                              confirmLabel: 'Cancel Broadcast',
                              onConfirm: () => { handleCancel(b); setConfirmAction(null); },
                            })}
                            title="Cancel"
                            style={{
                              width: 28, height: 28, padding: 0,
                              border: '1px solid var(--err-line)',
                              borderRadius: 6, background: 'var(--err-bg)',
                              color: 'var(--err)', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--err)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </>
                      )}
                      {isTerminal && (
                        <button
                          onClick={() => setConfirmAction({
                            title: 'Delete Broadcast',
                            message: `Delete this broadcast? This will remove it from your history. (${b.sent || 0}/${b.total || 0} messages)`,
                            confirmLabel: 'Delete',
                            onConfirm: () => { api.del(`/broadcasts/${b.id}`).then(() => loadBroadcasts()).catch(() => {}); setConfirmAction(null); },
                          })}
                          title="Delete"
                          style={{
                            width: 28, height: 28, padding: 0,
                            border: '1px solid var(--line)',
                            borderRadius: 6, background: 'transparent',
                            color: 'var(--ink-3)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err-line)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                      {b.status === 'pending' && (
                        <span style={{ fontSize: 10, color: 'var(--ink-4)', padding: '4px 4px' }}>
                          …
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination footer */}
        <div className="footer">
          <span>
            Showing {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
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
    </>
  );
}
