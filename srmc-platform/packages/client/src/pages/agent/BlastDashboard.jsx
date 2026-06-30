import React, { useState, useEffect, useRef, useCallback } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatTime } from '../../lib/format.js';

const FLAG_LABELS = {
  'confirmed': 'Confirmed',
  'opt-out': 'Opt Out',
  'needs-reply': 'Needs Reply',
};

function buildDelayOptions(turboDelay) {
  return [
    { label: '🚀 Turbo', value: turboDelay || 100 },
    { label: '1s', value: 1000 },
    { label: '2s', value: 2000 },
    { label: '3s', value: 3000 },
    { label: '4s', value: 4000 },
    { label: '6s', value: 6000 },
    { label: '8s', value: 8000 },
    { label: '10s', value: 10000 },
  ];
}

const STORAGE_KEY = 'srmc_compose_draft';

function estimateTime(count, delay) {
  const secs = Math.ceil((count * delay) / 1000);
  if (secs < 60) return `~${secs}s`;
  return `~${Math.ceil(secs / 60)}m`;
}

function saveDraft(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export default function BlastDashboard() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [activities, setActivities] = useState([]);
  const [inboundRecent, setInboundRecent] = useState([]);
  const [adminSettings, setAdminSettings] = useState({});
  const [turboDelay, setTurboDelay] = useState(100);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  // Dynamic delay options using admin-configured turbo delay
  const [delayOptions, setDelayOptions] = useState(() => buildDelayOptions(100));

  // Restore draft from sessionStorage
  const savedDraft = useRef(loadDraft());

  const [selectedTemplate, setSelectedTemplate] = useState(savedDraft.current?.selectedTemplate ?? null);
  const [selectedCampaign, setSelectedCampaign] = useState(savedDraft.current?.selectedCampaign ?? '');
  const [message, setMessage] = useState(savedDraft.current?.message ?? '');
  const [recipients, setRecipients] = useState(savedDraft.current?.recipients ?? '');
  const [selectedGateways, setSelectedGateways] = useState(savedDraft.current?.selectedGateways ?? []);
  const [distribution, setDistribution] = useState(savedDraft.current?.distribution ?? 'round-robin');
  const [delayMs, setDelayMs] = useState(6000);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const [activeBroadcasts, setActiveBroadcasts] = useState({}); // { [id]: { sent, failed, total, status, message? } }
  const [failedMessages, setFailedMessages] = useState([]);

  const [statsSent, setStatsSent] = useState(0);
  const [statsFailed, setStatsFailed] = useState(0);
  const [statsTotal, setStatsTotal] = useState(0);
  const [broadcastsPaused, setBroadcastsPaused] = useState(false);

  useEffect(() => {
    api.get('/templates').then(d => setTemplates(d.templates || [])).catch(() => {});
    api.get('/gateways').then(d => setGateways(d.gateways || [])).catch(() => {});
    api.get('/campaigns').then(d => setCampaigns(d.campaigns || [])).catch(() => {});
    api.get('/activity?limit=20').then(d => setActivities(d.activities || [])).catch(() => {});
    api.get('/inbound?limit=5').then(d => setInboundRecent(d.messages || [])).catch(() => {});
    api.get('/broadcasts?status=sending&limit=10').then(d => {
      if (d.broadcasts && d.broadcasts.length > 0) {
        const map = {};
        for (const b of d.broadcasts) {
          map[b.id] = { sent: b.sent || 0, failed: b.failed || 0, total: b.total || 0, status: b.status, message: b.message };
        }
        setActiveBroadcasts(map);
      }
    }).catch(() => {});

    // Load admin settings (delay default, time window, daily cap, turbo delay, global pause)
    api.get('/settings').then(d => {
      setAdminSettings(d);
      setBroadcastsPaused(d.broadcasts_globally_paused === 'true');
      const td = parseInt(d.turbo_delay) || 100;
      setTurboDelay(td);
      setDelayOptions(buildDelayOptions(td));
      // Only set delay from settings if no saved draft
      if (d.delay && !savedDraft.current) setDelayMs(parseInt(d.delay));
    }).catch(() => {});

    // Load stats
    api.get('/stats').then(d => {
      setStatsSent(d.sent_7d || 0);
      setStatsFailed(d.failed_7d || 0);
    }).catch(() => {});

    setInitialDataLoaded(true);
  }, []);

  // Restore delay from draft after settings are loaded
  useEffect(() => {
    if (initialDataLoaded && savedDraft.current?.delayMs) {
      setDelayMs(savedDraft.current.delayMs);
    }
  }, [initialDataLoaded]);

  // Save draft on every form state change
  useEffect(() => {
    if (!initialDataLoaded) return;
    saveDraft({
      selectedTemplate,
      selectedCampaign,
      message,
      recipients,
      selectedGateways,
      distribution,
      delayMs,
    });
  }, [selectedTemplate, selectedCampaign, message, recipients, selectedGateways, distribution, delayMs, initialDataLoaded]);

  useWS((event) => {
    if (event.type === 'broadcast:progress' && event.broadcastId) {
      setActiveBroadcasts(prev => ({
        ...prev,
        [event.broadcastId]: { sent: event.sent, failed: event.failed, total: event.total, status: event.status, message: prev[event.broadcastId]?.message },
      }));
    }
    if (event.type === 'broadcast:complete' && event.broadcastId) {
      setActiveBroadcasts(prev => {
        const next = { ...prev };
        if (next[event.broadcastId]) {
          next[event.broadcastId] = { ...next[event.broadcastId], status: event.status, sent: event.sent, failed: event.failed };
        }
        return next;
      });
      // Load failed messages for this completed broadcast
      api.get(`/broadcasts/${event.broadcastId}/messages?status=failed`).then(d => {
        if (d.messages && d.messages.length > 0) {
          setFailedMessages(prev => [...prev, ...d.messages]);
        }
      }).catch(() => {});
    }
    if (event.type === 'inbound:new') {
      // Agents only see messages belonging to their own broadcasts
      if (user?.role === 'agent' && event.message.agent_id !== user?.id) return;
      setInboundRecent(prev => [event.message, ...prev].slice(0, 5));
    }
    if (event.type === 'activity:new') {
      setActivities(prev => [{ ...event, id: Date.now() }, ...prev].slice(0, 20));
    }
    if (event.type === 'broadcasts:global-pause') {
      setBroadcastsPaused(event.paused);
    }
  });

  // Rebuild delay options if turbo delay changes
  useEffect(() => {
    setDelayOptions(buildDelayOptions(turboDelay));
  }, [turboDelay]);

  function handleTemplateSelect(t) {
    setSelectedTemplate(t);
    setMessage(t.body);
  }

  function toggleGateway(id) {
    setSelectedGateways(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function insertToken(token) {
    setMessage(prev => prev + token);
  }

  function normalizePhone(raw) {
    const n = String(raw).trim().replace(/[\s\-().]/g, '');
    if (n.startsWith('+'))                    return n;
    if (n.startsWith('09'))                   return '+63' + n.slice(1);
    if (n.startsWith('9') && n.length === 10) return '+63' + n;
    if (n.startsWith('63'))                   return '+' + n;
    return n;
  }

  function parseRecipients(text) {
    return text
      .split(/[\n;,]+/)
      .map(s => normalizePhone(s.trim()))
      .filter(s => s.length >= 7);
  }

  const recipientList = parseRecipients(recipients);
  const charCount = message.length;
  const segments = Math.ceil(charCount / 160) || 1;
  const isTurbo = delayMs < 1000; // Turbo is the only option below 1000ms
  const isLowDelay = delayMs <= 2000 && !isTurbo;
  const isLargeBatch = recipientList.length > 200;

  async function handleVerifyGateways() {
    if (selectedGateways.length === 0) return;
    const results = await Promise.allSettled(
      selectedGateways.map(id => api.post(`/gateways/${id}/test`))
    );
    const lines = selectedGateways.map((id, i) => {
      const gw = gateways.find(g => g.id === id);
      const r = results[i];
      return `${gw?.name}: ${r.status === 'fulfilled' ? r.value.status || 'ok' : 'unreachable'}`;
    });
    alert(lines.join('\n'));
  }

  async function handleSend(e) {
    e.preventDefault();
    if (broadcastsPaused) {
      setError('Broadcasting is paused by admin. No new broadcasts can be sent until it is resumed.');
      return;
    }
    if (selectedGateways.length === 0 || !message || recipientList.length === 0) {
      setError('Select at least one gateway, enter a message, and add recipients.');
      return;
    }
    setError('');
    setSending(true);
    try {
      const result = await api.post('/broadcasts', {
        gateway_ids: selectedGateways,
        distribution,
        campaign_id: selectedCampaign || null,
        template_id: selectedTemplate?.id || null,
        message,
        recipients: recipientList,
        delay_ms: delayMs,
      });
      const bid = result.broadcast.id;
      setActiveBroadcasts(prev => ({
        ...prev,
        [bid]: { sent: 0, failed: 0, total: result.broadcast.total, status: 'sending', message: result.broadcast.message },
      }));
      setStatsTotal(result.broadcast.total);
      setSending(false);
      // Clear draft after successful send
      clearDraft();
    } catch (e) {
      setError(e.message);
      setSending(false);
    }
  }

  async function handleCancel(broadcastId) {
    if (!broadcastId) return;
    try {
      await api.del(`/broadcasts/${broadcastId}`);
      setActiveBroadcasts(prev => {
        const next = { ...prev };
        delete next[broadcastId];
        return next;
      });
    } catch (e) {}
  }

  const activeBcList = Object.entries(activeBroadcasts).filter(([_, b]) => b.status === 'sending' || b.status === 'paused');
  const isSending = activeBcList.length > 0;

  return (
    <AgentShell>
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 360px', gap: 16, minHeight: 0 }}>

        {/* LEFT COL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* System Status */}
          <div className="card">
            <div className="card-head">
              <h3>System Status</h3>
              {isSending ? <LiveBadge label={`${activeBcList.length} active`} /> : <span className="pill idle"><span className="dot" />Idle</span>}
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeBcList.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No active broadcast.</div>
              )}
              {activeBcList.map(([id, bc]) => {
                const pct = bc.total > 0 ? Math.round((bc.sent / bc.total) * 100) : 0;
                return (
                  <div key={id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {bc.message ? bc.message.substring(0, 30) + (bc.message.length > 30 ? '…' : '') : 'Broadcast'}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--ink-2)', marginLeft: 8, flexShrink: 0 }}>
                        {bc.sent}/{bc.total}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-soft)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: bc.status === 'paused' ? 'var(--warn)' : 'var(--ok)', borderRadius: 3, transition: 'width 0.4s' }} />
                    </div>
                    <button
                      className="btn-danger"
                      style={{ width: '100%', padding: '3px 8px', fontSize: 11 }}
                      onClick={() => handleCancel(id)}
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Sent (7d)', val: statsSent },
              { label: 'Failed (7d)', val: statsFailed },
              { label: 'Total msgs', val: statsTotal || progress.total },
              { label: 'Queued', val: isSending ? activeBcList.reduce((sum, [_, b]) => sum + Math.max(0, b.total - b.sent), 0) : 0 },
            ].map(s => (
              <div key={s.label} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: 'var(--ink-1)' }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Failed messages */}
          {failedMessages.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>Failed</h3><span className="pill err">{failedMessages.length}</span></div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {failedMessages.map(m => (
                  <div key={m.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-soft)', fontSize: 12 }}>
                    <div className="num" style={{ color: 'var(--ink-1)' }}>{m.to_number}</div>
                    <div style={{ color: 'var(--err)', marginTop: 2 }}>{m.error || 'Failed'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CENTER COL */}
        <div>
          {isSending && (
            <div style={{
              padding: '10px 16px', marginBottom: 14,
              background: 'var(--info-bg)', border: '1px solid var(--info-line)',
              borderRadius: 10, fontSize: 12, color: 'var(--info)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <LiveBadge label={`${activeBcList.length} running`} />
              <span style={{ flex: 1 }}>
                {activeBcList.length} broadcast{activeBcList.length > 1 ? 'es' : ''} sending — all running simultaneously.
              </span>
            </div>
          )}
          <div className="card">
            <div className="card-head">
              <h3>Compose Broadcast</h3>
            </div>
            <form style={{ padding: 18 }} onSubmit={handleSend}>
              {/* Template pills */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Templates
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {templates.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      className={`filter-pill${selectedTemplate?.id === t.id ? ' on' : ''}`}
                      style={selectedTemplate?.id === t.id ? { background: 'var(--ink-1)', color: '#fff', borderColor: 'var(--ink-1)' } : {}}
                      onClick={() => handleTemplateSelect(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message textarea */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Message</label>
                  <span style={{ fontSize: 11, color: charCount > 160 ? 'var(--warn)' : 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                    {charCount}ch / {segments} seg
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={5}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Type your message or select a template above..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Variable tokens */}
              {selectedTemplate && JSON.parse(selectedTemplate.variables || '[]').length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>Variables</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {JSON.parse(selectedTemplate.variables).map(v => (
                      <button key={v} type="button" className="filter-pill" onClick={() => insertToken(v)} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Recipients */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Recipients</label>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>{recipientList.length} numbers</span>
                </div>
                <textarea
                  className="input mono"
                  rows={4}
                  value={recipients}
                  onChange={e => setRecipients(e.target.value)}
                  placeholder="+919700942849&#10;+918800123456&#10;Paste numbers separated by newlines or semicolons"
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>

              {/* Multi-gateway picker */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>
                    Gateways
                  </label>
                  {selectedGateways.length > 1 && recipientList.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                      {distribution === 'linear'
                        ? `~${Math.ceil(recipientList.length / selectedGateways.length)} msgs each · linear`
                        : `~${Math.ceil(recipientList.length / selectedGateways.length)} msgs each · round-robin`}
                    </span>
                  )}
                </div>
                {gateways.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 12px', background: 'var(--bg-soft)', borderRadius: 8 }}>
                    No gateways configured. Add one in the Gateway tab.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {gateways.map(g => {
                      const checked = selectedGateways.includes(g.id);
                      const statusColor = g.status === 'online' ? 'var(--ok)' : g.status === 'slow' ? 'var(--warn)' : 'var(--ink-4)';
                      return (
                        <div
                          key={g.id}
                          onClick={() => toggleGateway(g.id)}
                          title={g.name}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 12px', borderRadius: 8,
                            cursor: 'pointer',
                            opacity: 1,
                            border: `1.5px solid ${checked ? 'var(--ink-1)' : 'var(--line)'}`,
                            background: checked ? 'var(--ink-1)' : '#fff',
                            transition: 'all 0.12s',
                          }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                            border: `2px solid ${checked ? '#fff' : 'var(--line)'}`,
                            background: checked ? '#fff' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {checked && (
                              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                                <polyline points="2,6 5,9 10,3" stroke="var(--ink-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          {/* Name */}
                          <span style={{ fontSize: 13, fontWeight: 500, flex: 1, color: checked ? '#fff' : 'var(--ink-1)' }}>
                            {g.name}
                          </span>
                          {/* SIM carrier */}
                          {g.sim_carrier && (
                            <span style={{ fontSize: 11, color: checked ? 'rgba(255,255,255,0.6)' : 'var(--ink-3)' }}>
                              {g.sim_carrier}
                            </span>
                          )}
                          {/* Status dot */}
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: checked ? 'rgba(255,255,255,0.7)' : statusColor,
                            boxShadow: g.status === 'online' && !checked ? '0 0 0 2px rgba(5,150,105,0.2)' : 'none',
                          }} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Distribution mode — only shown when 2+ gateways selected */}
              {selectedGateways.length > 1 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                    Distribution mode
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      {
                        key: 'round-robin',
                        title: 'Round-robin',
                        desc: 'Interleaved — 1→GW1 · 2→GW2 · 3→GW1 · 4→GW2',
                      },
                      {
                        key: 'linear',
                        title: 'Linear',
                        desc: 'Chunked — first half→GW1 · second half→GW2',
                      },
                    ].map(opt => {
                      const active = distribution === opt.key;
                      return (
                        <div
                          key={opt.key}
                          onClick={() => setDistribution(opt.key)}
                          style={{
                            padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: `1.5px solid ${active ? 'var(--ink-1)' : 'var(--line)'}`,
                            background: active ? 'var(--ink-1)' : '#fff',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#fff' : 'var(--ink-1)', marginBottom: 3 }}>
                            {opt.title}
                          </div>
                          <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.6)' : 'var(--ink-3)', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>
                            {opt.desc}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Campaign selector */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Campaign</label>
                <select
                  className="input"
                  value={selectedCampaign}
                  onChange={e => setSelectedCampaign(e.target.value)}
                  style={{ fontSize: 12 }}
                >
                  <option value="">No campaign</option>
                  {campaigns.filter(c => c.status === 'active').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Delay selector */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Send delay</label>
                <div className="seg">
                  {delayOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      className={delayMs === opt.value ? 'on' : ''}
                      onClick={() => setDelayMs(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {isTurbo && (
                  <div style={{
                    marginTop: 6, padding: '8px 12px',
                    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
                    borderRadius: 8, fontSize: 11, color: '#fff',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 16 }}>🚀</span>
                    <div>
                      <strong>TURBO MODE</strong> — sending at maximum speed! Messages are sent concurrently in batches.
                      <div style={{ marginTop: 3, opacity: 0.8 }}>⚠️ May cause carrier throttling or SIM bans. Use responsibly.</div>
                    </div>
                  </div>
                )}
                {isLowDelay && (
                  <div style={{
                    marginTop: 6, padding: '6px 10px',
                    background: 'var(--warn-bg)', border: '1px solid var(--warn-line)',
                    borderRadius: 6, fontSize: 11, color: 'var(--warn)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span><strong>Fast delay ({delayMs / 1000}s)</strong> — may cause carrier throttling or SIM bans. Use 3s+ for reliable delivery.</span>
                  </div>
                )}
              </div>

              {/* Large batch warning */}
              {isLargeBatch && (
                <div style={{
                  marginBottom: 8, padding: '7px 12px',
                  background: 'var(--warn-bg)', border: '1px solid var(--warn-line)',
                  borderRadius: 7, fontSize: 11, color: 'var(--warn)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span><strong>{recipientList.length} recipients</strong> — large batch. Estimated time may be significant. Consider splitting into smaller groups.</span>
                </div>
              )}

              {/* Summary row */}
              {/* Summary row */}
              <div style={{
                padding: '10px 14px',
                background: isTurbo ? 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(219,39,119,0.08))' : 'var(--bg-soft)',
                border: isTurbo ? '1px solid rgba(124,58,237,0.2)' : 'none',
                borderRadius: 8, marginBottom: 6,
                display: 'flex', gap: 20, fontSize: 12, color: 'var(--ink-2)',
                alignItems: 'center',
              }}>
                <span>Recipients: <strong className="num">{recipientList.length}</strong></span>
                <span>Est. time: <strong>{isTurbo ? '⚡ Turbo' : estimateTime(recipientList.length, delayMs)}</strong></span>
                {isTurbo && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#7c3aed', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Concurrent sending
                  </span>
                )}
              </div>

              {/* Global pause warning */}
              {broadcastsPaused && (
                <div style={{
                  padding: '10px 14px', marginBottom: 12,
                  background: 'var(--err-bg)', border: '1px solid var(--err-line)',
                  borderRadius: 8, fontSize: 12, color: 'var(--err)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                  </svg>
                  <span><strong>Broadcasting paused</strong> — an admin has paused all broadcasts. Sending is disabled until resumed.</span>
                </div>
              )}

              {/* Admin limits info */}
              {(adminSettings.window_start || adminSettings.daily_cap) && (
                <div style={{ padding: '7px 14px', background: 'var(--bg)', border: '1px solid var(--line-soft)', borderRadius: 8, marginBottom: 12, fontSize: 11, color: 'var(--ink-3)', display: 'flex', gap: 16 }}>
                  {adminSettings.window_start && (
                    <span>Sending window: <strong>{adminSettings.window_start}–{adminSettings.window_end || '20:00'}</strong></span>
                  )}
                  {adminSettings.daily_cap && (
                    <span>Daily cap: <strong className="num">{parseInt(adminSettings.daily_cap).toLocaleString('en-PH')}</strong> msgs</span>
                  )}
                </div>
              )}

              {error && (
                <div style={{ padding: '8px 12px', background: 'var(--err-bg)', border: '1px solid var(--err-line)', borderRadius: 7, color: 'var(--err)', fontSize: 12, marginBottom: 10 }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={handleVerifyGateways} disabled={selectedGateways.length === 0}>
                  Verify gateway
                </button>
                <button type="submit" className="btn-primary" disabled={sending || selectedGateways.length === 0} style={{ flex: 1 }}>
                  {sending ? 'Sending...' : `Send broadcast (${recipientList.length})`}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* RIGHT COL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Activity log */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-head">
              <h3>Activity</h3>
              <LiveBadge />
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {activities.length === 0 && (
                <div style={{ padding: '20px 18px', fontSize: 13, color: 'var(--ink-3)' }}>No recent activity.</div>
              )}
              {activities.map((a, i) => (
                <div key={a.id || i} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-soft)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: a.level === 'error' ? 'var(--err)' : a.level === 'warn' ? 'var(--warn)' : 'var(--ok)' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-1)' }}>{a.action}</div>
                    {a.detail && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{a.detail}</div>}
                    <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                      {formatTime(a.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inbound replies */}
          <div className="card">
            <div className="card-head">
              <h3>Inbound Replies</h3>
              {inboundRecent.length > 0 && <span className="pill info">{inboundRecent.length}</span>}
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {inboundRecent.length === 0 && (
                <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--ink-3)' }}>No recent inbound.</div>
              )}
              {inboundRecent.map(m => (
                <div key={m.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="num" style={{ fontSize: 12 }}>{m.from_number}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {m.flag && <Pill status={m.flag} label={FLAG_LABELS[m.flag] || m.flag} />}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>{m.body}</div>
                  {m.linked_broadcast && (
                    <div style={{ marginTop: 3, display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" style={{ marginTop: 2, flexShrink: 0 }}>
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-4)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        Re: {m.linked_broadcast.outbound_message || m.linked_broadcast.broadcast_message}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AgentShell>
  );
}
