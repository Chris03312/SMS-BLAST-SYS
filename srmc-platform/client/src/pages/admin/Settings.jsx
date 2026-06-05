import React, { useState, useEffect, useRef, useCallback } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import { api } from '../../lib/api.js';

// All sections in display order
const SECTIONS = [
  { key: 'account',      label: 'Account',        group: 'General'   },
  { key: 'preferences',  label: 'Preferences',     group: 'General'   },
  { key: 'gateways',     label: 'SMS Gateways',    group: 'Messaging' },
  { key: 'sender-ids',   label: 'Sender IDs',      group: 'Messaging' },
  { key: 'webhooks',     label: 'Webhooks & API',  group: 'Security'  },
  { key: 'central',      label: 'Central Server',  group: 'Security'  },
  { key: 'auth',         label: 'Authentication',  group: 'Security'  },
  { key: 'danger',       label: 'Danger Zone',     group: 'Advanced'  },
];

const GROUPS = ['General', 'Messaging', 'Security', 'Advanced'];

export default function Settings() {
  const [form, setForm]         = useState({});
  const [settings, setSettings] = useState({});
  const [gateways, setGateways] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [active, setActive]     = useState('account');
  const [ngrok, setNgrok]       = useState({ running: false, url: null, webhookUrl: null });
  const [ngrokBusy, setNgrokBusy] = useState(false);

  // One ref per section
  const sectionRefs = useRef({});
  const scrollRef   = useRef(null);   // the .main scroll container

  useEffect(() => {
    api.get('/settings').then(s => { setSettings(s); setForm(s); }).catch(() => {});
    api.get('/gateways').then(d => setGateways(d.gateways || [])).catch(() => {});
    api.get('/ngrok/status').then(d => {
      if (d.success) {
        setNgrok({ running: d.running, url: d.url, webhookUrl: d.webhookUrl });
        if (d.url) setForm(p => ({ ...p, public_url: d.url }));
      }
    }).catch(() => {});
  }, []);

  // IntersectionObserver — highlight whichever section is most visible
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the biggest intersection ratio that's actually visible
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          setActive(visible[0].target.dataset.section);
        }
      },
      {
        root: container,
        threshold: [0.1, 0.3, 0.5, 0.7],
        rootMargin: '-10% 0px -60% 0px',
      }
    );

    SECTIONS.forEach(s => {
      const el = sectionRefs.current[s.key];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  function scrollTo(key) {
    const el = sectionRefs.current[key];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(key);
    }
  }

  function set(key, value) { setForm(p => ({ ...p, [key]: value })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.put('/settings', form);
      setSettings(updated);
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSaving(false);
  }

  async function toggleGateway(g) {
    try {
      const updated = await api.put(`/gateways/${g.id}`, { active: g.active ? 0 : 1 });
      setGateways(p => p.map(x => x.id === g.id ? updated.gateway : x));
    } catch (e) {}
  }

  // ── Ngrok controls ────────────────────────────────────────────────
  async function handleNgrokStart() {
    setNgrokBusy(true);
    try {
      const d = await api.post('/ngrok/start', {});
      if (d.success) {
        setNgrok({ running: true, url: d.url, webhookUrl: d.webhookUrl });
        setForm(p => ({ ...p, public_url: d.url }));
      }
    } catch (e) {
      alert('Failed to start ngrok: ' + e.message);
    }
    setNgrokBusy(false);
  }

  async function handleNgrokStop() {
    setNgrokBusy(true);
    try {
      await api.post('/ngrok/stop', {});
      setNgrok({ running: false, url: null, webhookUrl: null });
    } catch (e) {
      alert('Failed to stop ngrok: ' + e.message);
    }
    setNgrokBusy(false);
  }

  // Derive inbound webhook URL from the saved public_url setting.
  // Falls back to local network URL so it still works on LAN without ngrok.
  const publicBase = (form.public_url || '').replace(/\/$/, '');
  const localBase  = `${window.location.protocol}//${window.location.hostname}:4000`;
  const serverBase = publicBase || localBase;
  const webhookUrl = `${serverBase}/api/webhook/inbound`;

  return (
    <AdminShell crumbs={['System', 'Settings']}>
      {/* form wraps everything so the save bar submit button works */}
      <form onSubmit={handleSave}>

      {/* Two-column layout — sub-nav sticky left, all sections right */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, alignItems: 'start' }}
           ref={scrollRef}>

        {/* ── STICKY SUB-NAV ─────────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0,
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '13px 14px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Settings
            </div>
          </div>
          <nav style={{ padding: '8px 8px 10px' }}>
            {GROUPS.map(group => (
              <div key={group}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--ink-4)',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  padding: '10px 10px 4px',
                }}>
                  {group}
                </div>
                {SECTIONS.filter(s => s.group === group).map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => scrollTo(s.key)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 10px', borderRadius: 7, border: 'none',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      marginBottom: 1,
                      background: active === s.key ? 'var(--ink-1)' : 'transparent',
                      color:      active === s.key ? '#fff'         : 'var(--ink-2)',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        {/* ── ALL SECTIONS STACKED ───────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingBottom: 72 }}>

            {/* Page heading */}
            <div style={{ marginBottom: 24 }}>
              <div className="eyebrow">System</div>
              <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>Settings</h1>
              <div className="page-sub">Platform configuration for your SRMC workspace.</div>
            </div>

            {/* ── Account ── */}
            <SectionBlock sectionKey="account" label="Account & Branding" desc="Your workspace identity shown in agent consoles and exports." refs={sectionRefs}>
              <FieldRow cols={2}>
                <Field label="Organisation name">
                  <input className="input" value={form.org_name || ''} onChange={e => set('org_name', e.target.value)} />
                </Field>
                <Field label="Default sender ID" help="Up to 6 alphanumeric characters · DLT registered">
                  <input className="input mono" value={form.sender_id || ''} onChange={e => set('sender_id', e.target.value)} style={{ fontSize: 12 }} />
                </Field>
              </FieldRow>
              <FieldRow cols={2}>
                <Field label="Region">
                  <select className="input" value={form.region || 'IN'} onChange={e => set('region', e.target.value)}>
                    <option value="IN">India (IN)</option>
                    <option value="SG">Singapore (SG)</option>
                    <option value="US">United States (US)</option>
                  </select>
                </Field>
              </FieldRow>
            </SectionBlock>

            <SectionDivider />

            {/* ── Preferences ── */}
            <SectionBlock sectionKey="preferences" label="Sending Behaviour" desc="Default delay, allowed sending window, and per-agent daily cap." refs={sectionRefs}>
              <Field label="Default delay between sends" style={{ marginBottom: 18 }}>
                <div className="seg" style={{ marginTop: 4 }}>
                  {[['3000','3s'],['6000','6s'],['8000','8s'],['10000','10s']].map(([val, lbl]) => (
                    <button key={val} type="button" className={form.delay === val ? 'on' : ''} onClick={() => set('delay', val)}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Seconds between each SMS send in a broadcast.</div>
              </Field>
              <FieldRow cols={3}>
                <Field label="Window start">
                  <input className="input mono" type="time" value={form.window_start || '00:00'} onChange={e => set('window_start', e.target.value)} style={{ fontSize: 12 }} />
                </Field>
                <Field label="Window end">
                  <input className="input mono" type="time" value={form.window_end || '23:59'} onChange={e => set('window_end', e.target.value)} style={{ fontSize: 12 }} />
                </Field>
                <Field label="Daily cap (per agent)" help="Soft limit">
                  <div style={{ display: 'flex' }}>
                    <input className="input mono" type="number" value={form.daily_cap || 10000} onChange={e => set('daily_cap', e.target.value)}
                      style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }} />
                    <span style={{ padding: '10px 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: '0 8px 8px 0', fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                      msgs/day
                    </span>
                  </div>
                </Field>
              </FieldRow>
              <Field label="Turbo mode delay" style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex' }}>
                  <input className="input mono" type="number" min="0" max="1000" value={form.turbo_delay || 100} onChange={e => set('turbo_delay', e.target.value)}
                    style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', maxWidth: 120 }} />
                  <span style={{ padding: '10px 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: '0 8px 8px 0', fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    ms
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Delay between message batches in Turbo mode. Lower = faster. 100ms default.</div>
              </Field>

              <Field label="Turbo batch size" style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex' }}>
                  <input className="input mono" type="number" min="1" max="20" value={form.turbo_batch_size || 5} onChange={e => set('turbo_batch_size', e.target.value)}
                    style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', maxWidth: 120 }} />
                  <span style={{ padding: '10px 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: '0 8px 8px 0', fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    msgs/batch
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>How many messages to send concurrently in each Turbo batch. Higher = faster but more aggressive.</div>
              </Field>

              <Field label="Max concurrent broadcasts" help="How many broadcasts can run at the same time. 0 = unlimited.">
                <div style={{ display: 'flex' }}>
                  <input className="input mono" type="number" min="0" value={form.max_concurrent_broadcasts || 0} onChange={e => set('max_concurrent_broadcasts', e.target.value)}
                    style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none', maxWidth: 160 }} />
                  <span style={{ padding: '10px 10px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: '0 8px 8px 0', fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    broadcasts
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>
                  Set to 2 = only 2 broadcasts can send simultaneously. Others queue as 'pending' until a slot frees up.
                </div>
              </Field>
            </SectionBlock>

            <SectionDivider />

            {/* ── SMS Gateways ── */}
            <SectionBlock sectionKey="gateways" label="SMS Gateways" desc="Android relay devices. Toggle active/inactive per device." refs={sectionRefs}>
              {gateways.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>
                  No gateways configured. Add them in <strong>Numbers</strong>.
                </div>
              )}
              {gateways.map(g => (
                <div key={g.id} style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr auto auto',
                  alignItems: 'center', gap: 12,
                  padding: '12px 0', borderBottom: '1px solid var(--line-soft)',
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                    <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{g.url}</div>
                  </div>
                  <span className={`pill ${g.status === 'online' ? 'ok' : g.status === 'slow' ? 'warn' : 'idle'}`}>
                    <span className="dot" />{g.status}
                  </span>
                  <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => toggleGateway(g)}>
                    {g.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}
            </SectionBlock>

            <SectionDivider />

            {/* ── Sender IDs ── */}
            <SectionBlock sectionKey="sender-ids" label="Sender IDs & Opt-out" desc="Registered sender names and how STOP messages are handled." refs={sectionRefs}>
              <FieldRow cols={2}>
                <Field label="Default sender ID" help="DLT-registered alphanumeric ID (max 6 chars)">
                  <input className="input mono" value={form.sender_id || ''} onChange={e => set('sender_id', e.target.value)} style={{ fontSize: 12 }} />
                </Field>
                <Field label="Opt-out keywords" help="Recipients replying with these words are auto-flagged">
                  <input className="input mono" value="STOP, UNSUBSCRIBE, CANCEL" readOnly style={{ fontSize: 12, background: 'var(--bg-soft)', color: 'var(--ink-3)' }} />
                </Field>
              </FieldRow>
            </SectionBlock>

            <SectionDivider />

            {/* ── Webhooks ── */}
            <SectionBlock sectionKey="webhooks" label="Webhooks & API" desc="Configure your public server URL so Android gateways can POST inbound SMS back to this platform." refs={sectionRefs}>

              {/* ── Per-device tunnel credentials ── */}
              <FieldRow cols={2}>
                <Field label="Ngrok auth token" help="This device's own token (free at ngrok.com). Stored locally — each install needs its own.">
                  <input
                    className="input mono"
                    type="password"
                    value={form.ngrok_authtoken || ''}
                    onChange={e => set('ngrok_authtoken', e.target.value)}
                    placeholder="2abc…xyz"
                    autoComplete="off"
                    style={{ fontSize: 12 }}
                  />
                </Field>
                <Field label="Reserved domain (optional)" help="Bind to a fixed ngrok domain so this device's URL never changes.">
                  <input
                    className="input mono"
                    value={form.ngrok_domain || ''}
                    onChange={e => set('ngrok_domain', e.target.value)}
                    placeholder="your-name.ngrok-free.dev"
                    style={{ fontSize: 12 }}
                  />
                </Field>
              </FieldRow>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', margin: '0 0 16px', lineHeight: 1.5 }}>
                Save changes first, then <strong>Start Tunnel</strong> below. This opens a public URL so your Android gateways can deliver inbound SMS to <em>this</em> device.
              </div>

              {/* ── Ngrok Tunnel ── */}
              <div style={{
                background: ngrok.running ? 'var(--ok-bg, #ECFDF5)' : 'var(--bg-soft)',
                border: `1px solid ${ngrok.running ? 'var(--ok-line, #A7F3D0)' : 'var(--line-soft)'}`,
                borderRadius: 10, padding: '14px 18px', marginBottom: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>
                    Ngrok Tunnel
                  </div>
                  {ngrok.running ? (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--ok, #059669)', fontWeight: 500, marginBottom: 4 }}>
                        ● Running
                      </div>
                      <div className="num mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                        {ngrok.url}
                      </div>
                      <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                        Inbound: {ngrok.webhookUrl}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      No active tunnel. Set an ngrok auth token in your <code style={{ fontFamily: 'var(--mono)', background: 'var(--bg-soft)', padding: '1px 4px', borderRadius: 3 }}>.env</code> file and restart, or click Start to use the saved token.
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                  {!ngrok.running ? (
                    <button type="button" className="btn-primary" onClick={handleNgrokStart} disabled={ngrokBusy} style={{ fontSize: 12, padding: '8px 16px' }}>
                      {ngrokBusy ? 'Starting…' : 'Start Tunnel'}
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost" onClick={handleNgrokStop} disabled={ngrokBusy} style={{ fontSize: 12, padding: '8px 16px', color: 'var(--err, #EF4444)' }}>
                      {ngrokBusy ? 'Stopping…' : 'Stop Tunnel'}
                    </button>
                  )}
                </div>
              </div>

              {/* Public URL — the ngrok / reverse-proxy base URL */}
              <Field
                label="Public server URL"
                help="Your ngrok or reverse-proxy URL. Android gateways use this to forward inbound SMS."
                style={{ marginBottom: 16 }}
              >
                <div style={{ display: 'flex' }}>
                  <input
                    className="input mono"
                    value={form.public_url || ''}
                    onChange={e => set('public_url', e.target.value)}
                    placeholder="https://abc123.ngrok-free.app"
                    style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                  />
                  <span style={{
                    padding: '0 12px', display: 'flex', alignItems: 'center',
                    background: 'var(--bg-soft)', border: '1px solid var(--line)',
                    borderRadius: '0 8px 8px 0', fontSize: 11,
                    color: publicBase ? 'var(--ok)' : 'var(--ink-4)',
                    whiteSpace: 'nowrap', fontWeight: 600,
                  }}>
                    {publicBase ? 'HTTPS ✓' : 'Local'}
                  </span>
                </div>
                {!publicBase && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--warn)', lineHeight: 1.5 }}>
                    No public URL set. Start the ngrok tunnel above, or paste a URL manually.
                  </div>
                )}
              </Field>

              {/* Derived inbound webhook URL */}
              <Field label="Inbound webhook URL" help="Paste this into each FlashSMSGateway device so inbound replies are forwarded here." style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex' }}>
                  <div className="input mono" style={{ fontSize: 12, flex: 1, background: 'var(--bg-soft)', userSelect: 'all', cursor: 'text', borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}>
                    {webhookUrl}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, borderRadius: '0 8px 8px 0', borderLeft: 'none', whiteSpace: 'nowrap' }}
                    onClick={() => navigator.clipboard.writeText(webhookUrl).then(() => alert('Copied!')).catch(() => {})}
                  >
                    Copy
                  </button>
                </div>
              </Field>

              {/* Per-gateway setup instructions */}
              {gateways.length > 0 && (
                <Field label="Gateway setup" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {gateways.map(g => (
                      <div key={g.id} style={{
                        background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
                        borderRadius: 8, padding: '10px 14px',
                        display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 3 }}>{g.name}</div>
                          <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            Device: {g.url} &nbsp;·&nbsp; Inbound: <span style={{ color: 'var(--brand-1)' }}>{webhookUrl}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: '5px 10px', whiteSpace: 'nowrap' }}
                          onClick={() => navigator.clipboard.writeText(webhookUrl).then(() => alert('Webhook URL copied!')).catch(() => {})}
                        >
                          Copy URL
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                    In the FlashSMSGateway app on each device: open <strong>Settings</strong> → <strong>Webhook URL</strong> → paste the URL above.
                  </div>
                </Field>
              )}

              {/* API Secret */}
              <Field label="API secret" help="Sent as Authorization header on outbound gateway requests. Treat it like a password.">
                <div className="input mono" style={{ fontSize: 12, background: 'var(--bg-soft)', color: 'var(--ink-3)', userSelect: 'all', cursor: 'text' }}>
                  {settings.webhook_secret || '—'}
                </div>
              </Field>
            </SectionBlock>

            <SectionDivider />

            {/* ── Central Server ── */}
            <SectionBlock sectionKey="central" label="Central Server" desc="Report stats to a central monitoring server so you can monitor this installation remotely." refs={sectionRefs}>
              <Field
                label="Central server URL"
                help="Paste the URL of your central monitoring server (e.g. http://103.x.x.x:4000 or a cloudflare tunnel URL). Stats will be reported every 5 minutes."
                style={{ marginBottom: 16 }}
              >
                <div style={{ display: 'flex' }}>
                  <input
                    className="input mono"
                    value={form.central_server_url || ''}
                    onChange={e => set('central_server_url', e.target.value)}
                    placeholder="https://random-name.trycloudflare.com"
                    style={{ fontSize: 12, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                  />
                  <span style={{
                    padding: '0 12px', display: 'flex', alignItems: 'center',
                    background: form.central_server_url ? 'var(--ok-bg)' : 'var(--bg-soft)',
                    border: '1px solid var(--line)',
                    borderRadius: '0 8px 8px 0', fontSize: 11,
                    color: form.central_server_url ? 'var(--ok)' : 'var(--ink-4)',
                    whiteSpace: 'nowrap', fontWeight: 600,
                  }}>
                    {form.central_server_url ? 'Connected' : 'Not set'}
                  </span>
                </div>
                {form.central_server_url && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                    Stats will auto-report every 5 minutes. Open{' '}
                    <a href={form.central_server_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--brand-1)', textDecoration: 'underline' }}>
                      {form.central_server_url}
                    </a>
                    {' '}in your browser to view the dashboard.
                  </div>
                )}
              </Field>
              <div style={{
                background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
                borderRadius: 8, padding: '12px 16px', fontSize: 12,
                color: 'var(--ink-3)', lineHeight: 1.6,
              }}>
                <strong style={{ color: 'var(--ink-1)' }}>How it works:</strong><br />
                Run the central server on any VPS or remote PC, expose it with cloudflare tunnel (no ngrok account needed), then paste the URL here. Your desktop app will start reporting messages sent, gateways online, uptime, and system info every 5 minutes.
              </div>
            </SectionBlock>

            <SectionDivider />

            {/* ── Auth ── */}
            <SectionBlock sectionKey="auth" label="Authentication" desc="Login settings and session management for all users." refs={sectionRefs}>
              <div style={{ background: 'var(--bg-soft)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                Users are managed in <strong>Agents</strong>. Passwords can be reset there.<br />
                Session tokens expire after <strong>24 hours</strong>.
              </div>
            </SectionBlock>

            <SectionDivider />

            {/* ── Danger Zone ── */}
            <SectionBlock sectionKey="danger" label="Danger Zone" desc="Destructive workspace-level operations. These cannot be undone." refs={sectionRefs} danger>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[
                  { label: 'Purge activity log',     desc: 'Delete all activity log entries.',               action: () => window.confirm('Purge all activity logs?') },
                  { label: 'Reset all settings',     desc: 'Restore every setting to its factory default.', action: () => window.confirm('Reset all settings to defaults?') },
                  { label: 'Revoke all sessions',    desc: 'Force all agents to log in again.',              action: () => window.confirm('Revoke all active sessions?') },
                ].map((item, i, arr) => (
                  <div key={item.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--err-line)' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{item.desc}</div>
                    </div>
                    <button type="button" className="btn-danger" onClick={item.action} style={{ flexShrink: 0, marginLeft: 20 }}>
                      {item.label.split(' ').slice(0, 2).join(' ')}…
                    </button>
                  </div>
                ))}
              </div>
            </SectionBlock>

          </div>
        </div>

      </div>{/* end 2-col grid */}

      {/* ── Save bar — fixed, spans from sidebar edge to viewport right ── */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 240,
        right: 0,
        padding: '13px 28px',
        background: '#fff',
        borderTop: '1px solid var(--line)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 20,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {saved
            ? <span style={{ color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Changes saved
              </span>
            : 'Changes apply to the entire workspace.'}
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      </form>{/* end outer form */}
    </AdminShell>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function SectionBlock({ sectionKey, label, desc, danger, refs, children }) {
  return (
    <div
      data-section={sectionKey}
      ref={el => { refs.current[sectionKey] = el; }}
      className="card"
      style={{
        padding: 24, marginBottom: 16,
        borderColor: danger ? 'var(--err-line)' : undefined,
        scrollMarginTop: 16,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: danger ? 'var(--err)' : 'var(--ink-1)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.55 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function SectionDivider() {
  return null; // spacing handled by card marginBottom
}

function FieldRow({ cols = 2, children }) {
  const count = React.Children.count(children);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(count, cols)}, 1fr)`, gap: 14, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Field({ label, help, children, style }) {
  return (
    <div style={style}>
      {label && <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>{label}</label>}
      {children}
      {help && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>{help}</div>}
    </div>
  );
}
