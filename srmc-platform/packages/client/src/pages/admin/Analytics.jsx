import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import { api } from '../../lib/api.js';
import { formatNumber } from '../../lib/format.js';
import { exportAnalyticsXlsx } from '../../lib/export.js';

const PERIODS = [
  { key: 'day',   label: 'Daily' },
  { key: 'week',  label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'year',  label: 'Yearly' },
];

function MiniLine({ data, color = 'var(--brand-1)', labels }) {
  if (!data || data.length === 0) return null;
  const w = 300, h = 100, pad = 4;
  const max = Math.max(...data, 1);
  const stepX = (w - pad * 2) / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `${pad},${h - pad} ${pts.join(' ')} ${pad + (data.length - 1) * stepX},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%' }}>
      {/* Area fill */}
      <polygon points={area} fill={color} fillOpacity={0.08} />
      {/* Line */}
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Dots */}
      {data.map((v, i) => {
        const cx = pad + i * stepX;
        const cy = h - pad - (v / max) * (h - pad * 2);
        return (
          <g key={i}>
            <circle cx={cx} cy={cy} r={2.5} fill={color} />
            <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--ink-2)" fontSize={10} fontWeight={600}>{v}</text>
          </g>
        );
      })}
      {/* Date labels */}
      {labels && labels.length > 0 && (
        <g>
          <text x={pad} y={h + 10} textAnchor="start" fill="var(--ink-4)" fontSize={9} fontFamily="var(--mono)">{labels[0]}</text>
          <text x={pad + (labels.length - 1) * stepX} y={h + 10} textAnchor="end" fill="var(--ink-4)" fontSize={9} fontFamily="var(--mono)">{labels[labels.length - 1]}</text>
        </g>
      )}
    </svg>
  );
}

export default function AdminAnalytics() {
  const [period, setPeriod] = useState('day');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load campaigns list on mount
  useEffect(() => {
    api.get('/campaigns').then(d => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadData();
  }, [period, campaignFilter]);

  function rangeFromPeriod(p) {
    const now = new Date();
    switch (p) {
      case 'day':   return new Date(now - 30  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      case 'week':  return new Date(now - 90  * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      case 'month': return new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      case 'year':  return new Date(now - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      default:      return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
  }

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = rangeFromPeriod(period);
      let url = `/stats/historical?period=${period}&from=${from}&to=${to}`;
      if (campaignFilter) url += `&campaign_id=${campaignFilter}`;
      const result = await api.get(url);
      setData(result);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  const series = data?.series || [];
  const byUser = data?.by_user || [];
  const byGateway = data?.by_gateway || [];
  const byCampaign = data?.by_campaign || [];
  const totals = data?.totals || { sent: 0, failed: 0, delivery_rate: 0 };
  const sentSeries = series.map(s => s.sent);
  const failedSeries = series.map(s => s.failed);

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Analytics</h1>
          <div className="page-sub">Historical message volume, delivery trends, and per-agent breakdowns.</div>
        </div>
        <LiveBadge />
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Period selector — determines both grouping and date range */}
        <div className="seg">
          {PERIODS.map(p => (
            <button key={p.key} type="button" className={period === p.key ? 'on' : ''} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Campaign filter */}
          <select
            className="input"
            value={campaignFilter}
            onChange={e => { setCampaignFilter(e.target.value); }}
            style={{ fontSize: 12, padding: '6px 10px', maxWidth: 200 }}
          >
            <option value="">All campaigns</option>
            {campaigns.filter(c => c.status === 'active').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="button" className="btn-ghost" onClick={loadData} style={{ fontSize: 12, padding: '7px 14px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const periodLabel = PERIODS.find(p => p.key === period)?.label || period;
              exportAnalyticsXlsx(data, periodLabel);
            }}
            disabled={!data}
            style={{ fontSize: 12, padding: '7px 14px' }}
            title="Export all data as Excel workbook (multi-sheet)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Excel
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          Loading analytics...
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--err-bg)', border: '1px solid var(--err-line)', borderRadius: 8, color: 'var(--err)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
            {[
              { label: 'Total Sent', value: formatNumber(totals.sent), color: 'var(--brand-1)' },
              { label: 'Total Failed', value: formatNumber(totals.failed), color: 'var(--err)' },
              { label: 'Delivery Rate', value: `${totals.delivery_rate}%`, color: totals.delivery_rate >= 80 ? 'var(--ok)' : totals.delivery_rate >= 50 ? 'var(--warn)' : 'var(--err)' },
              { label: 'Periods', value: series.length, color: 'var(--ink-3)' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{k.label}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Main chart area */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            {/* Sent chart — line graph */}
            <div className="card">
              <div className="card-head">
                <h3>Sent</h3>
              </div>
              <div style={{ padding: '16px 18px', minHeight: 130 }}>
                {series.length > 0 ? (
                  <MiniLine data={sentSeries} color="var(--brand-1)" labels={series.map(s => s.date)} />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '30px 0', textAlign: 'center' }}>No data for this period.</div>
                )}
              </div>
            </div>

            {/* Failed chart — line graph */}
            <div className="card">
              <div className="card-head">
                <h3>Failed</h3>
                {series.length > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {totals.failed} total
                  </span>
                )}
              </div>
              <div style={{ padding: '16px 18px', minHeight: 130 }}>
                {series.length > 0 ? (
                  <MiniLine data={failedSeries} color="var(--err)" labels={series.map(s => s.date)} />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '30px 0', textAlign: 'center' }}>No data for this period.</div>
                )}
              </div>
            </div>
          </div>

          {/* Data tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            {/* Per-campaign table */}
            <div className="card">
              <div className="card-head">
                <h3>By Campaign</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byCampaign.length} campaigns</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th style={{ textAlign: 'right' }}>Sent</th>
                    <th style={{ textAlign: 'right' }}>Failed</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byCampaign.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No data.</td></tr>
                  )}
                  {byCampaign.map(c => {
                    const total = c.sent + c.failed;
                    const rate = total > 0 ? Math.round((c.sent / total) * 100) : 0;
                    return (
                      <tr key={c.campaign_id || '__nc__'}>
                        <td>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{c.campaign_name || 'Uncategorized'}</div>
                          <div className="cell-id">{c.campaign_id?.slice(0, 8) || ''}</div>
                        </td>
                        <td className="num">{c.sent}</td>
                        <td className="num" style={{ color: c.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{c.failed}</td>
                        <td className="num" style={{ color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Per-user table */}
            <div className="card">
              <div className="card-head">
                <h3>By Agent</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byUser.length} agents</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th style={{ textAlign: 'right' }}>Sent</th>
                    <th style={{ textAlign: 'right' }}>Failed</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No data.</td></tr>
                  )}
                  {byUser.map(u => {
                    const total = u.sent + u.failed;
                    const rate = total > 0 ? Math.round((u.sent / total) * 100) : 0;
                    return (
                      <tr key={u.agent_id}>
                        <td>
                          <div className="cell-name">
                            <div className="row-avatar">{u.display_name?.slice(0, 2).toUpperCase() || u.username?.slice(0, 2).toUpperCase()}</div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{u.display_name || u.username}</div>
                              <div className="cell-id">{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="num">{u.sent}</td>
                        <td className="num" style={{ color: u.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{u.failed}</td>
                        <td className="num" style={{ color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Per-gateway table */}
            <div className="card">
              <div className="card-head">
                <h3>By Gateway</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byGateway.length} devices</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Gateway</th>
                    <th style={{ textAlign: 'right' }}>Sent</th>
                    <th style={{ textAlign: 'right' }}>Failed</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byGateway.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No data.</td></tr>
                  )}
                  {byGateway.map(g => {
                    const total = g.sent + g.failed;
                    const rate = total > 0 ? Math.round((g.sent / total) * 100) : 0;
                    return (
                      <tr key={g.gateway_id}>
                        <td>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{g.gateway_name}</div>
                          {g.number && <div className="cell-id num">{g.number}</div>}
                        </td>
                        <td className="num">{g.sent}</td>
                        <td className="num" style={{ color: g.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{g.failed}</td>
                        <td className="num" style={{ color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail series table */}
          <div className="card">
            <div className="card-head">
              <h3>Period Breakdown</h3>
              <span className="pill info">{series.length} periods</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Sent</th>
                  <th style={{ textAlign: 'right' }}>Failed</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {series.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No data for the selected period and range.</td></tr>
                )}
                {series.map((s, i) => {
                  const total = s.sent + s.failed;
                  const rate = total > 0 ? Math.round((s.sent / total) * 100) : 0;
                  return (
                    <tr key={i}>
                      <td className="num" style={{ fontSize: 12 }}>{s.date}</td>
                      <td className="num">{s.sent}</td>
                      <td className="num" style={{ color: s.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{s.failed}</td>
                      <td className="num">{total}</td>
                      <td className="num" style={{ color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                    </tr>
                  );
                }).slice().reverse()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
