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

/** Vertical bar chart component */
function MiniBarChart({ data, color = 'var(--brand-1)', labels }) {
  if (!data || data.length === 0) return null;
  const w = 300, h = 140, pad = 28, bottomPad = 28;
  const plotW = w - pad * 2;
  const plotH = h - pad - bottomPad;
  const max = Math.max(...data, 1);
  const barW = Math.max(4, Math.min(20, plotW / data.length * 0.6));
  const gap = plotW / data.length;

  // Date labels — smart sampling
  const dateLabels = [];
  if (labels && labels.length > 0) {
    const maxLabels = data.length > 20 ? 4 : data.length > 10 ? 6 : labels.length;
    const step = Math.max(1, Math.floor(labels.length / maxLabels));
    for (let i = 0; i < labels.length; i += step) {
      dateLabels.push({ index: i, label: (labels[i].length > 7 ? labels[i].slice(5) : labels[i]) });
    }
    if (dateLabels[dateLabels.length - 1]?.index !== labels.length - 1) {
      dateLabels.push({ index: labels.length - 1, label: labels[labels.length - 1].length > 7 ? labels[labels.length - 1].slice(5) : labels[labels.length - 1] });
    }
  }

  // Y-axis reference
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    y: pad + plotH - pct * plotH,
    label: Math.round(pct * max),
  }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', display: 'block' }}>
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <line key={i} x1={pad} y1={t.y} x2={w - pad} y2={t.y} stroke="var(--line)" strokeWidth={0.5} opacity={0.15} />
      ))}
      {/* Y-axis labels */}
      {yTicks.map((t, i) => (
        <text key={i} x={pad - 5} y={t.y + 3} textAnchor="end" fill="var(--ink-4)" fontSize={8.5} fontFamily="var(--mono)" opacity={0.6}>{t.label}</text>
      ))}
      {/* Bars */}
      {data.map((v, i) => {
        const cx = pad + i * gap + (gap - barW) / 2;
        const bh = (v / max) * plotH;
        const y = pad + plotH - bh;
        return (
          <g key={i}>
            <rect x={cx} y={y} width={barW} height={Math.max(bh, 1)} rx={2} fill={color} opacity={0.85}>
              <title>{v}</title>
            </rect>
            {/* Value label on hover — always show first, last, and max */}
            {(i === 0 || i === data.length - 1 || v === max || data.length <= 10) && (
              <text x={cx + barW / 2} y={y - 5} textAnchor="middle" fill="var(--ink-2)" fontSize={8.5} fontWeight={600}>{v}</text>
            )}
          </g>
        );
      })}
      {/* Date labels */}
      {dateLabels.map((dl, i) => (
        <text key={i} x={pad + dl.index * gap + gap / 2} y={h - 4} textAnchor="middle" fill="var(--ink-4)" fontSize={8} fontFamily="var(--mono)" opacity={0.7}>{dl.label}</text>
      ))}
    </svg>
  );
}

/** Inline mini progress bar for table rows */
function MiniBar({ value, max, color = 'var(--brand-1)', bg = 'var(--bg-soft)', height = 5 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ width: '100%', height, background: bg, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s ease', minWidth: pct > 0 ? 3 : 0 }} />
    </div>
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
    api.get('/campaigns').then(d => setCampaigns(d.campaigns || [])).catch(e => console.error('[analytics] Load campaigns:', e));
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Analytics</h1>
            <div className="page-sub">Historical message volume, delivery trends, and per-agent breakdowns.</div>
          </div>
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
            style={{ fontSize: 12, padding: '7px 14px', whiteSpace: 'nowrap' }}
            title="Export all data as Excel workbook (multi-sheet)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: 'middle' }}>
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

      {!loading && !error && data && (
        <>
          {/* KPI cards row — 4 cards: Sent, Failed, Rate, Avg Daily */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
            {[
              { label: 'Total Sent', value: formatNumber(totals.sent), color: 'var(--brand-1)' },
              { label: 'Total Failed', value: formatNumber(totals.failed), color: 'var(--err)' },
              { label: 'Delivery Rate', value: `${totals.delivery_rate}%`, color: totals.delivery_rate >= 80 ? 'var(--ok)' : totals.delivery_rate >= 50 ? 'var(--warn)' : 'var(--err)' },
              { label: 'Avg Daily', value: series.length > 0 ? formatNumber(Math.round(totals.sent / series.length)) : '0', color: 'var(--ink-1)' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '16px 18px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{k.label}</div>
                <div className="num" style={{ fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Two charts side by side — Sent + Failed */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            <div className="card">
              <div className="card-head">
                <h3>Sent</h3>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{totals.sent} total</span>
              </div>
              <div style={{ padding: '8px 12px 4px' }}>
                {series.length > 0 ? (
                  <MiniBarChart data={sentSeries} color="var(--brand-1)" labels={series.map(s => s.date)} />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '30px 0', textAlign: 'center' }}>No data for this period.</div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h3>Failed</h3>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{totals.failed} total</span>
              </div>
              <div style={{ padding: '8px 12px 4px' }}>
                {series.length > 0 ? (
                  <MiniBarChart data={failedSeries} color="var(--err)" labels={series.map(s => s.date)} />
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '30px 0', textAlign: 'center' }}>No data for this period.</div>
                )}
              </div>
            </div>
          </div>

          {/* Tables row — Campaign + Gateway side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-head" style={{ flexShrink: 0 }}>
                <h3>By Campaign</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byCampaign.length} campaigns</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Campaign</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Sent</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Failed</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCampaign.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px', fontSize: 13 }}>No data.</td></tr>
                    )}
                    {(() => {
                      const maxSent = Math.max(...byCampaign.map(c => c.sent), 1);
                      return byCampaign.map(c => {
                        const rate = (c.sent + c.failed) > 0 ? Math.round((c.sent / (c.sent + c.failed)) * 100) : 0;
                        return (
                          <tr key={c.campaign_id || '__nc__'}>
                            <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: 500 }}>
                              <div>{c.campaign_name || 'Uncategorized'}</div>
                              <div style={{ marginTop: 3, width: 80 }}><MiniBar value={c.sent} max={maxSent} height={3} /></div>
                            </td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12 }}>{c.sent}</td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: c.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{c.failed}</td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-head" style={{ flexShrink: 0 }}>
                <h3>By Gateway</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byGateway.length} devices</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 300 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Gateway</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Sent</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Failed</th>
                      <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byGateway.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px', fontSize: 13 }}>No data.</td></tr>
                    )}
                    {(() => {
                      const maxSent = Math.max(...byGateway.map(g => g.sent), 1);
                      return byGateway.map(g => {
                        const rate = (g.sent + g.failed) > 0 ? Math.round((g.sent / (g.sent + g.failed)) * 100) : 0;
                        return (
                          <tr key={g.gateway_id}>
                            <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: 500 }}>
                              <div>{g.gateway_name}</div>
                              {g.number && <div className="cell-id num" style={{ fontSize: 10 }}>{g.number}</div>}
                              <div style={{ marginTop: 3, width: 80 }}><MiniBar value={g.sent} max={maxSent} height={3} /></div>
                            </td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12 }}>{g.sent}</td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: g.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{g.failed}</td>
                            <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* By Agent — full-width table at bottom */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h3>By Agent</h3>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{byUser.length} agents</span>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 340 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Agent</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Sent</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Failed</th>
                    <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', borderBottom: '1px solid var(--line-soft)' }}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px', fontSize: 13 }}>No data.</td></tr>
                  )}
                  {(() => {
                    const maxSent = Math.max(...byUser.map(u => u.sent), 1);
                    return byUser.map(u => {
                      const rate = (u.sent + u.failed) > 0 ? Math.round((u.sent / (u.sent + u.failed)) * 100) : 0;
                      return (
                        <tr key={u.agent_id}>
                          <td style={{ padding: '8px 14px' }}>
                            <div className="cell-name" style={{ gap: 8 }}>
                              <div className="row-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{u.display_name?.slice(0, 2).toUpperCase() || u.username?.slice(0, 2).toUpperCase()}</div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 500 }}>{u.display_name || u.username}</div>
                                <div className="cell-id" style={{ fontSize: 10 }}>{u.username}</div>
                              </div>
                              <div style={{ width: 60 }}><MiniBar value={u.sent} max={maxSent} height={3} /></div>
                            </div>
                          </td>
                          <td className="num" style={{ padding: '8px 14px', fontSize: 12 }}>{u.sent}</td>
                          <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: u.failed > 0 ? 'var(--err)' : 'var(--ink-3)' }}>{u.failed}</td>
                          <td className="num" style={{ padding: '8px 14px', fontSize: 12, color: rate >= 80 ? 'var(--ok)' : rate >= 50 ? 'var(--warn)' : 'var(--err)' }}>{rate}%</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
