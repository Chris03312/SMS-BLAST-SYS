import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatNumber, formatDate } from '../../lib/format.js';

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
  const [remoteInstalls, setRemoteInstalls] = useState([]);
  const [remoteDash, setRemoteDash] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      const [s, c, a, i, rd, ri] = await Promise.all([
        api.get('/stats'),
        api.get('/campaigns'),
        api.get('/agents'),
        api.get('/inbound?limit=5'),
        api.get('/stats/remote-dashboard').catch(() => null),
        api.get('/stats/remote-installations').catch(() => null),
      ]);
      setStats(s);
      setCampaigns((c.campaigns || []).slice(0, 5));
      setAgents((a.agents || []).slice(0, 5));
      setInbound(i.messages || []);
      if (rd) setRemoteDash(rd);
      if (ri) setRemoteInstalls(ri.installations || []);
    } catch (e) {}
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  useWS((event) => {
    if (event.type === 'broadcast:progress' || event.type === 'broadcast:complete' || event.type === 'gateway:status') {
      loadData();
    }
    if (event.type === 'inbound:new') {
      setInbound(prev => [event.message, ...prev].slice(0, 5));
    }
  });

  const dailyData = stats?.daily || [];
  const sentSeries = dailyData.map(d => d.sent);
  const failedSeries = dailyData.map(d => d.failed);

  // Compute week-over-week trend from daily data
  const totalSent = stats?.sent_7d || 0;
  const totalFailed = stats?.failed_7d || 0;
  const deliveryRate = stats?.delivery_rate || 0;
  const activeAgents = stats?.active_agents || 0;

  // Simple trend: compare first half vs second half of the 7 days
  const mid = Math.floor(dailyData.length / 2);
  const firstHalf = dailyData.slice(0, mid).reduce((s, d) => s + d.sent, 0);
  const secondHalf = dailyData.slice(mid).reduce((s, d) => s + d.sent, 0);
  const sentUp = firstHalf > 0 ? secondHalf / firstHalf >= 1 : false;
  const sentTrend = firstHalf > 0
    ? `${Math.round(((secondHalf - firstHalf) / firstHalf) * 100)}%`
    : '';

  const kpis = stats ? [
    {
      label: 'Sent (7d)',
      value: formatNumber(totalSent),
      chart: <Sparkline data={sentSeries} color="var(--brand-1)" fill width={100} height={28} />,
      delta: sentTrend ? (sentUp ? '▲' : '▼') + ' ' + sentTrend : '',
      up: sentUp,
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
    <AdminShell crumbs={['Dashboard']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Overview</div>
          <h1>Dashboard</h1>
          <div className="page-sub">Real-time platform overview across all gateways and agents.</div>
        </div>
        <LiveBadge />
      </div>

      {/* KPIs — mini analytic cards with sparklines and rings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: '18px 20px', height: 120 }} />
        )) : kpis.map(k => (
          <div key={k.label} className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{k.label}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink-1)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{k.value}</div>
                {k.delta && (
                  <div style={{ fontSize: 11, color: k.up ? 'var(--ok)' : 'var(--err)', marginTop: 4, fontWeight: 500 }}>{k.delta}</div>
                )}
              </div>
              {k.chart && (
                <div style={{ flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
                  {k.chart}
                </div>
              )}
            </div>
            {k.label === 'Failed (7d)' && totalFailed > 0 && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6, fontFamily: 'var(--mono)' }}>
                {deliveryRate}% delivered
              </div>
            )}
            {k.label === 'Active Agents' && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}>
                {stats?.gateways_status?.filter(g => g.status === 'online').length || 0} gateways online
              </div>
            )}
            {k.label === 'Sent (7d)' && sentSeries.length > 0 && (
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>
        {/* Throughput chart */}
        <div className="card">
          <div className="card-head">
            <h3>Throughput (7 days)</h3>
          </div>
          <div style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
              {(stats?.daily || []).map((d, i) => {
                const max = Math.max(...(stats?.daily || []).map(x => x.sent), 1);
                const h = Math.round((d.sent / max) * 72);
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', height: h || 4, background: 'var(--brand-1)', borderRadius: '3px 3px 0 0', minHeight: 4 }} />
                    <div style={{ fontSize: 9, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>{d.day?.slice(5)}</div>
                  </div>
                );
              })}
              {(!stats?.daily || stats.daily.length === 0) && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No data for the last 7 days.</div>
              )}
            </div>
          </div>
        </div>

        {/* Gateways status */}
        <div className="card">
          <div className="card-head">
            <h3>Gateways</h3>
          </div>
          <div>
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
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 340px', gap: 16 }}>
        {/* Campaigns */}
        <div className="card">
          <div className="card-head">
            <h3>Active Campaigns</h3>
            <a href="/admin/campaigns" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Sent</th>
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

        {/* Agents */}
        <div className="card">
          <div className="card-head">
            <h3>Agents</h3>
            <a href="/admin/agents" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Sent today</th>
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

        {/* Recent inbound */}
        <div className="card">
          <div className="card-head">
            <h3>Recent Inbound</h3>
            <a href="/admin/inbound" style={{ color: 'var(--brand-1)', fontSize: 12, fontWeight: 500 }}>View all →</a>
          </div>
          <div>
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

      {/* Remote Installations */}
      {remoteInstalls.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h3>Remote Installations</h3>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{remoteDash?.online_installations || 0} online · {remoteDash?.total_installations || 0} total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderBottom: '1px solid var(--line-soft)' }}>
            {[
              { label: 'Installations', val: remoteDash?.total_installations },
              { label: 'Online Now', val: remoteDash?.online_installations },
              { label: 'Messages Today', val: formatNumber(remoteDash?.total_messages_today) },
              { label: 'All-Time Messages', val: formatNumber(remoteDash?.total_messages_sent) },
            ].map(s => (
              <div key={s.label} style={{ padding: '14px 18px', borderRight: '1px solid var(--line-soft)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: 'var(--ink-1)' }}>{s.val ?? '—'}</div>
              </div>
            ))}
          </div>
          <table>
            <thead>
              <tr>
                <th>Installation</th>
                <th>Status</th>
                <th>Sent Today</th>
                <th>Total Sent</th>
                <th>Gateways</th>
                <th>Last Report</th>
              </tr>
            </thead>
            <tbody>
              {remoteInstalls.map(i => {
                const isOnline = new Date(i.last_seen) > new Date(Date.now() - 10 * 60 * 1000);
                return (
                  <tr key={i.install_id}>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{i.org_name || i.hostname || 'Unnamed'}</div>
                      <div className="cell-id">{i.hostname || i.install_id?.slice(0, 8)}</div>
                    </td>
                    <td><Pill status={isOnline ? 'online' : 'offline'} label={isOnline ? 'Online' : 'Offline'} /></td>
                    <td className="num">{i.messages_sent_today || 0}</td>
                    <td className="num">{i.messages_sent_total || 0}</td>
                    <td className="num">{i.gateways_online || 0}/{i.gateways_total || 0}</td>
                    <td className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {i.last_seen ? formatDate(i.last_seen) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="footer">
            <span>Stats auto-reported every 5 min</span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Set central_server_url on remote apps to your ngrok URL</span>
          </div>
        </div>
      )}

      {remoteInstalls.length === 0 && (
        <div className="card" style={{ marginTop: 16, padding: '20px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Remote Installations</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            No remote installations reporting yet.{' '}
            To connect remote Electron apps, set their <strong>central_server_url</strong> setting to your ngrok URL (e.g. <code style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg-soft)', padding: '1px 5px', borderRadius: 3 }}>https://your-tunnel.ngrok-free.app</code>).
          </div>
        </div>
      )}
    </AdminShell>
  );
}
