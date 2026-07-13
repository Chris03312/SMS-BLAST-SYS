import React, { useState, useEffect, useRef } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import Modal from '../../components/Modal.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useWS } from '../../lib/ws.js';
import { formatNumber, formatDate, formatTime } from '../../lib/format.js';

function Sparkline({ data, color = 'var(--brand-1)', width = 100, height = 28, fill = false }) {
  if (!data || data.length === 0) return <svg width={width} height={height} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - (v / max) * (height - 4);
    return `${x},${y}`;
  }).join(' ');
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg width={width} height={height}>
      {fill && <polygon points={areaPts} fill={color} fillOpacity={0.1} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MiniRing({ pct, size = 44, stroke = 4, color = 'var(--ok)' }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const bgColor = 'var(--line-soft)';
  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bgColor} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 0.6s' }}
      />
    </svg>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [runningBroadcasts, setRunningBroadcasts] = useState([]);
  const [confirmCancelAll, setConfirmCancelAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cancelledIds, setCancelledIds] = useState(new Set());
  const [viewBroadcast, setViewBroadcast] = useState(null);
  const [viewMessages, setViewMessages] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Debounced data refresh ───────────────────────────────────────────
  // Avoids hammering the server when WS events fire rapidly (e.g. every
  // broadcast:progress or gateway:heartbeat). Only re-fetches at most once
  // every 3 seconds, and the last call always wins.
  const refreshRef = useRef(null);

  async function handleCancel(broadcastId) {
    try {
      await api.post(`/broadcasts/${broadcastId}/cancel`);
      setCancelledIds(prev => new Set(prev).add(broadcastId));
      // Update the local status so the Pill shows "Cancelled"
      setRunningBroadcasts(prev => prev.map(b =>
        b.id === broadcastId ? { ...b, status: 'cancelled' } : b
      ));
      toast('Broadcast cancelled', 'info');
    } catch (e) {
      toast('Failed to cancel: ' + e.message, 'error');
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    try {
      await api.del(`/broadcasts/${confirmDelete}`);
      setRunningBroadcasts(prev => prev.filter(b => b.id !== confirmDelete));
      setCancelledIds(prev => {
        const next = new Set(prev);
        next.delete(confirmDelete);
        return next;
      });
      setConfirmDelete(null);
      toast('Broadcast deleted', 'success');
    } catch (e) {
      toast('Failed to delete: ' + e.message, 'error');
      setConfirmDelete(null);
    }
  }

  async function handleViewBroadcast(broadcastId) {
    setViewLoading(true);
    setViewBroadcast(null);
    setViewMessages([]);
    try {
      // Fetch broadcast details with all messages
      const data = await api.get(`/broadcasts/${broadcastId}`);
      setViewBroadcast(data);  // store the full broadcast object
      setViewMessages(data.messages || []);
    } catch (e) {
      toast('Failed to load broadcast details: ' + e.message, 'error');
      setViewBroadcast(null);
    }
    setViewLoading(false);
  }

  async function handleCancelAll() {
    try {
      const result = await api.post('/broadcasts/cancel-all');
      const count = result.cancelled || 0;
      toast(`Cancelled ${count} active broadcast${count !== 1 ? 's' : ''}`, 'info');
      setConfirmCancelAll(false);
      // Refresh immediately to clear the list
      await loadData();
    } catch (e) {
      toast('Failed to cancel all: ' + e.message, 'error');
      setConfirmCancelAll(false);
    }
  }

  async function loadData() {
    try {
      const [s, c, a, i, r] = await Promise.all([
        api.get('/stats'),
        api.get('/campaigns'),
        api.get('/agents'),
        api.get('/inbound?limit=5'),
        api.get('/broadcasts/running/list'),
      ]);
      setStats(s);
      setCampaigns((c.campaigns || []).slice(0, 5));
      setAgents((a.agents || []).slice(0, 5));
      setInbound(i.messages || []);
      setRunningBroadcasts(r.broadcasts || []);
    } catch (e) {}
    setLoading(false);
  }

  /** Debounced refresh: if called multiple times within 3s, only the last triggers */
  function debouncedRefresh() {
    if (refreshRef.current) clearTimeout(refreshRef.current);
    refreshRef.current = setTimeout(loadData, 3000);
  }

  useEffect(() => { loadData(); }, []);

  useWS((event) => {
    if (event.type === 'broadcast:progress' || event.type === 'gateway:status') {
      debouncedRefresh();
    }
    if (event.type === 'broadcast:complete') {
      const total = event.total || 0;
      const sent = event.sent || 0;
      const failed = event.failed || 0;
      if (failed > 0) {
        toast(`Broadcast complete — ${sent}/${total} sent, ${failed} failed`, 'warning');
      } else {
        toast(`Broadcast complete — ${sent}/${total} sent successfully`, 'success');
      }
      debouncedRefresh();
    }
    if (event.type === 'inbound:new') {
      setInbound(prev => [event.message, ...prev].slice(0, 5));
      // Also debounce refresh to update counts
      debouncedRefresh();
    }
  });

  const { toast } = useToast();

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (refreshRef.current) clearTimeout(refreshRef.current);
    };
  }, []);

  const dailyData = stats?.daily || [];
  const sentSeries = dailyData.map(d => d.sent);
  const failedSeries = dailyData.map(d => d.failed);

  // Compute week-over-week trend from daily data
  const totalSent = stats?.sent_7d || 0;
  const totalFailed = stats?.failed_7d || 0;
  const sentToday = stats?.sent_today || 0;
  const deliveryRate = stats?.delivery_rate || 0;
  const activeAgents = stats?.active_agents || 0;

  const kpis = stats ? [
    {
      label: 'Total Sent',
      value: formatNumber(totalSent),
      chart: <Sparkline data={sentSeries} color="var(--brand-1)" fill width={100} height={28} />,
    },
    {
      label: 'Sent Today',
      value: formatNumber(sentToday),
      chart: null,
      delta: '',
      up: true,
    },
    {
      label: 'Delivery Rate',
      value: `${deliveryRate}%`,
      chart: <MiniRing pct={deliveryRate} color={deliveryRate >= 80 ? 'var(--ok)' : deliveryRate >= 50 ? 'var(--warn)' : 'var(--err)'} size={40} stroke={4} />,
      delta: '',
      up: true,
    },
    {
      label: 'Active Agents',
      value: activeAgents,
      chart: null,
      delta: '',
      up: true,
    },
    {
      label: 'Failed (7d)',
      value: formatNumber(totalFailed),
      chart: <Sparkline data={failedSeries} color="var(--err)" fill width={100} height={28} />,
      delta: '',
      up: false,
    },
  ] : [];

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Overview</div>
            <h1>Dashboard</h1>
            <div className="page-sub">Real-time platform overview across all gateways and agents.</div>
          </div>
        </div>
        <LiveBadge />
      </div>

      {/* KPIs — mini analytic cards with sparklines and rings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
        {loading ? Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: '18px 20px', height: 120 }} />
        )) : kpis.map(k => (
          <div key={k.label} className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{k.label}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{k.value}</div>

              </div>
              {k.chart && (
                <div style={{ flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
                  {k.chart}
                </div>
              )}
            </div>

            {k.label === 'Active Agents' && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                {stats?.gateways_status?.filter(g => g.status === 'online').length || 0} gateways online
              </div>
            )}
            {k.label === 'Total Sent' && sentSeries.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                {dailyData[0]?.day?.slice(5)} – {dailyData[dailyData.length - 1]?.day?.slice(5)}
              </div>
            )}
            {k.label === 'Failed (7d)' && failedSeries.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                {dailyData[0]?.day?.slice(5)} – {dailyData[dailyData.length - 1]?.day?.slice(5)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Active Broadcasts */}
      {runningBroadcasts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h3>
              Active Broadcasts
              <span style={{ marginLeft: 10 }}><LiveBadge label={`${runningBroadcasts.length} running`} /></span>
            </h3>
            <button
              onClick={() => setConfirmCancelAll(true)}
              style={{
                padding: '6px 12px', fontSize: 11, fontWeight: 600,
                border: '1px solid var(--err-line)', borderRadius: 6,
                background: 'var(--err-bg)', color: 'var(--err)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--err)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Cancel All
            </button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th style={{ minWidth: 180 }}>Message</th>
                  <th style={{ textAlign: 'right' }}>Recipients</th>
                  <th style={{ minWidth: 140 }}>Progress</th>
                  <th style={{ textAlign: 'right' }}>Sent</th>
                  <th style={{ textAlign: 'right' }}>Failed</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center', width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runningBroadcasts.map(b => {
                  const done = (b.sent || 0) + (b.failed || 0);
                  const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 0;
                  const isPaused = b.status === 'paused';
                  return (
                    <tr key={b.id}>
                      <td>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{b.agent_name || b.campaign_name || '—'}</span>
                      </td>
                      <td>
                        <div style={{
                          fontSize: 13, color: 'var(--ink-1)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: 220,
                        }} title={b.message}>
                          {b.message?.slice(0, 50)}{b.message?.length > 50 ? '…' : ''}
                        </div>
                      </td>
                      <td className="num" style={{ fontSize: 13 }}>{b.total || 0}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            flex: 1, height: 7, background: 'var(--bg-soft)',
                            borderRadius: 4, overflow: 'hidden', display: 'flex',
                          }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.max(b.total > 0 ? Math.round((b.sent||0) / b.total * 100) : 0, 2)}%`,
                              background: isPaused ? 'var(--warn)' : 'var(--ok)',
                              transition: 'width 0.5s ease',
                              minWidth: 4,
                            }} />
                            {(b.failed||0) > 0 && (
                              <div style={{
                                height: '100%',
                                width: `${Math.max(b.total > 0 ? Math.round((b.failed||0) / b.total * 100) : 0, 2)}%`,
                                background: 'var(--err)',
                                transition: 'width 0.5s ease',
                                minWidth: 4,
                              }} />
                            )}
                          </div>
                          <span className="num" style={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>{pct}%</span>
                        </div>
                      </td>
                      <td className="num" style={{ fontSize: 13, color: 'var(--ok)' }}>{b.sent || 0}</td>
                      <td className="num" style={{ fontSize: 13, color: (b.failed || 0) > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{b.failed || 0}</td>
                      <td>
                        {cancelledIds.has(b.id) ? (
                          <Pill status="cancelled" label="Cancelled" />
                        ) : (
                          <Pill status={b.status} label={isPaused ? 'Paused' : 'Sending'} />
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button
                            onClick={() => handleViewBroadcast(b.id)}
                            title="View details"
                            style={{
                              padding: '4px 8px', fontSize: 11, fontWeight: 600,
                              border: '1px solid var(--line)', borderRadius: 6,
                              background: 'transparent', color: 'var(--ink-2)',
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.borderColor = 'var(--ink-4)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--line)'; }}
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><polyline points="12 16 12 12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                            View
                          </button>
                          {cancelledIds.has(b.id) ? (
                            <button
                              onClick={() => setConfirmDelete(b.id)}
                              title="Delete broadcast"
                              style={{
                                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                border: '1px solid var(--err-line)', borderRadius: 6,
                                background: 'var(--err-bg)', color: 'var(--err)',
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                                transition: 'all 0.12s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--err)'; e.currentTarget.style.color = '#fff'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'var(--err-bg)'; e.currentTarget.style.color = 'var(--err)'; }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                              Delete
                            </button>
                          ) : (
                            <button
                              onClick={() => handleCancel(b.id)}
                              title="Cancel broadcast"
                              style={{
                                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                                border: '1px solid var(--err-line)', borderRadius: 6,
                                background: 'transparent', color: 'var(--err)',
                                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                                transition: 'all 0.12s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--err-bg)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Throughput chart — full-width line graph */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Throughput (7 days)</h3>
        </div>
        <div style={{ padding: '18px 20px' }}>
          {stats?.daily && stats.daily.length > 0 ? (() => {
            const w = 800, h = 200, pad = 36;
            const data = stats.daily;
            const max = Math.max(...data.map(d => d.sent), 1);
            const stepX = (w - pad * 2) / (data.length - 1 || 1);
            const pts = data.map((d, i) => {
              const x = pad + i * stepX;
              const y = h - pad - (d.sent / max) * (h - pad * 2);
              return `${x},${y}`;
            });
            const area = `0,${h - pad} ${pts.join(' ')} ${pad + (data.length - 1) * stepX},${h - pad}`;
            return (
              <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', maxHeight: 220 }} preserveAspectRatio="xMidYMid meet">
                {/* Grid lines */}
                <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--line-soft)" strokeWidth="1" />
                <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="4 4" />
                <line x1={pad} y1={pad + (h - pad * 2) / 2} x2={w - pad} y2={pad + (h - pad * 2) / 2} stroke="var(--line-soft)" strokeWidth="1" strokeDasharray="4 4" />
                {/* Area fill */}
                <polygon points={area} fill="var(--brand-1)" fillOpacity={0.08} />
                {/* Line */}
                <polyline points={pts.join(' ')} fill="none" stroke="var(--brand-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* Dots */}
                {data.map((d, i) => {
                  const cx = pad + i * stepX;
                  const cy = h - pad - (d.sent / max) * (h - pad * 2);
                  return (
                    <g key={i}>
                      <circle cx={cx} cy={cy} r={3} fill="var(--brand-1)" />
                      <text x={cx} y={h - pad + 16} textAnchor="middle" fill="var(--ink-4)" fontSize={10} fontFamily="var(--mono)">
                        {d.day?.slice(5)}
                      </text>
                      <text x={cx} y={cy - 10} textAnchor="middle" fill="var(--ink-2)" fontSize={11} fontWeight={600}>
                        {d.sent}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })() : (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: 40 }}>No data for the last 7 days.</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>
        {/* Gateways status */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <h3>Gateways</h3>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {(stats?.gateways_status || []).map(g => (
              <div key={g.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)' }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)', marginTop: 1 }}>{g.sim_carrier}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Pill status={g.status} label={g.status} />
                  <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{g.sent_today} today</div>
                </div>
              </div>
            ))}
            {(!stats?.gateways_status || stats.gateways_status.length === 0) && (
              <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--ink-3)' }}>No gateways configured.</div>
            )}
          </div>
        </div>

        {/* Campaigns — now in the right column */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <h3>Active Campaigns</h3>
            <a href="/admin/campaigns" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No campaigns.</td></tr>}
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                      <div className="cell-id">{c.owner_name}</div>
                    </td>
                    <td><Pill status={c.status} label={c.status} /></td>
                    <td className="num">{c.total_sent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
        {/* Agents */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <h3>Agents</h3>
            <a href="/admin/agents" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th style={{ textAlign: 'right' }}>Today</th>
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 && <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No agents.</td></tr>}
                {agents.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div className="cell-name">
                        <div className="row-avatar">{a.display_name?.slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{a.display_name}</div>
                          <div className="cell-id">{a.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{a.sent_today || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent inbound */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ flexShrink: 0 }}>
            <h3>Recent Inbound</h3>
            <a href="/admin/inbound" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {inbound.length === 0 && <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--ink-3)' }}>No inbound messages.</div>}
            {inbound.map(m => (
              <div key={m.id} style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>{m.from_number}</span>
                  {m.flag && <Pill status={m.flag} label={m.flag} />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirmCancelAll && (
        <ConfirmModal
          title="Cancel All Broadcasts"
          message={`This will cancel all ${runningBroadcasts.length} active broadcast${runningBroadcasts.length !== 1 ? 's' : ''}. Already sent messages will be kept, and pending messages will be marked as cancelled. Continue?`}
          confirmLabel="Cancel All"
          onConfirm={handleCancelAll}
          onCancel={() => setConfirmCancelAll(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Broadcast"
          message="Permanently delete this broadcast? It will be moved to the Deleted filter in History. Already sent messages will be kept."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {viewBroadcast && (
        <Modal title="Broadcast Details" onClose={() => { setViewBroadcast(null); setViewMessages([]); }} width={600}>
          {viewLoading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Broadcast info — uses viewBroadcast data directly from API */}
              {(() => {
                const b = viewBroadcast;
                if (!b) return <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Broadcast not found.</div>;
                const sentCount = viewMessages.filter(m => m.status === 'sent' || m.status === 'delivered').length;
                const failedCount = viewMessages.filter(m => m.status === 'failed').length;
                const pendingCount = viewMessages.filter(m => m.status === 'queued' || m.status === 'pending' || m.status === 'sending').length;

                return (
                  <>
                    {/* Message preview */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                        Message
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-1)', padding: '8px 12px', background: 'var(--bg-soft)', borderRadius: 6, lineHeight: 1.5, maxHeight: 80, overflowY: 'auto' }}>
                        {b.message}
                      </div>
                    </div>

                    {/* Summary stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {[
                        { label: 'Total', val: b.total || 0, color: 'var(--ink-1)' },
                        { label: 'Sent', val: sentCount, color: 'var(--ok)' },
                        { label: 'Failed', val: failedCount, color: 'var(--err)' },
                        { label: 'Pending', val: pendingCount, color: 'var(--warn)' },
                      ].map(s => (
                        <div key={s.label} style={{ padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 6, textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
                          <div className="num" style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Per-recipient list */}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Recipients ({viewMessages.length})
                      </div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line-soft)', borderRadius: 6 }}>
                        {viewMessages.length === 0 ? (
                          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-3)' }}>No messages loaded.</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
                              <tr style={{ borderBottom: '1px solid var(--line-soft)' }}>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Number</th>
                                <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Status</th>
                                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Sent At</th>
                              </tr>
                            </thead>
                            <tbody>
                              {viewMessages.map(m => (
                                <tr key={m.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                                  <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}>{m.to_number}</td>
                                  <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                    <Pill status={m.status} label={m.status} />
                                  </td>
                                  <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                                    {m.sent_at ? formatTime(m.sent_at) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* Meta info */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                      <span>Agent: <strong style={{ color: 'var(--ink-1)' }}>{b.agent_name || '—'}</strong></span>
                      <span>Delay: <strong style={{ color: 'var(--ink-1)' }}>{b.delay_ms}ms</strong></span>
                      <span>Created: <strong style={{ color: 'var(--ink-1)' }}>{formatDate(b.created_at)}</strong></span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </Modal>
      )}
    </AdminShell>
  );
}
