import React, { useState, useEffect } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import LiveBadge from '../../components/LiveBadge.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import GatewayNumbers from './GatewayNumbers.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatNumber } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY_FORM = { name: '', url: '', token: '', sim_carrier: '', number: '', number2: '' };

function timeAgo(iso) {
  if (!iso) return 'never';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Inline gateway form (add or edit) ───────────────────────────────────────
function GatewayForm({ initial = EMPTY_FORM, onSave, onCancel, onTestInline, saving, error }) {
  const [form, setForm] = useState(initial);
  const [inlineTestResult, setInlineTestResult] = useState(null);
  const [inlineTesting, setInlineTesting] = useState(false);
  const isEdit = !!initial.id;

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function handleSubmit(e) {
    e.preventDefault();
    onSave(form);
  }

  async function handleTestInline() {
    if (!isEdit || !form.url) return;
    setInlineTesting(true);
    setInlineTestResult(null);
    try {
      const result = await onTestInline(initial.id, form.token);
      setInlineTestResult(result);
    } catch (e) {
      setInlineTestResult({ ok: false, msg: e.message || 'Test failed' });
    } finally {
      setInlineTesting(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, border: '2px solid var(--brand-1)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 16 }}>
        {isEdit ? 'Edit gateway' : 'Add new gateway'}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Name + URL on the same row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
              Gateway name <span style={{ color: 'var(--err)' }}>*</span>
            </label>
            <input
              className="input"
              placeholder="e.g. Galaxy A54 – SIM 1"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              required
              autoFocus={!isEdit}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
              Gateway URL <span style={{ color: 'var(--err)' }}>*</span>
            </label>
            <input
              className="input mono"
              placeholder="http://192.168.1.100:8080"
              value={form.url}
              onChange={e => set('url', e.target.value)}
              required
              type="url"
            />
          </div>
        </div>

        {/* Token + SIM carrier */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
              API token
            </label>
            <PasswordInput
              className="input mono"
              placeholder="Bearer token from the app"
              value={form.token}
              onChange={e => set('token', e.target.value.toLowerCase())}
              autoComplete="off"
            />
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              Found in FlashSMSGateway app → Settings → API Key
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
              SIM carrier
            </label>
            <input
              className="input"
              placeholder="e.g. Airtel, Jio, Vi"
              value={form.sim_carrier}
              onChange={e => set('sim_carrier', e.target.value)}
            />
          </div>
        </div>

        {/* Sender number — SIM 1 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
            SIM 1 number
          </label>
          <input
            className="input mono"
            placeholder="e.g. +91XXXXXXXXXX (SIM 1's number)"
            value={form.number}
            onChange={e => set('number', e.target.value)}
            style={{ fontSize: 12 }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Primary SIM sender number. Shown in activity and send logs.
          </div>
        </div>

        {/* Sender number — SIM 2 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>
            SIM 2 number
          </label>
          <input
            className="input mono"
            placeholder="e.g. +91XXXXXXXXXX (SIM 2's number)"
            value={form.number2}
            onChange={e => set('number2', e.target.value)}
            style={{ fontSize: 12 }}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Secondary SIM sender number for dual-SIM gateways.
          </div>
        </div>

        {/* Hint box */}
        <div style={{
          background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--ink-2)', display: 'block', marginBottom: 2 }}>How to find the URL</strong>
          Open FlashSMSGateway on your Android device → Dashboard tab → the endpoint shows as{' '}
          <code style={{ fontFamily: 'var(--mono)', background: 'var(--line-soft)', padding: '1px 5px', borderRadius: 4 }}>
            http://&lt;device-ip&gt;:&lt;port&gt;/send
          </code>
          {' '}— use everything before <code style={{ fontFamily: 'var(--mono)', background: 'var(--line-soft)', padding: '1px 5px', borderRadius: 4 }}>/send</code>.
        </div>

        {/* Inline test result */}
        {inlineTestResult && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: inlineTestResult.ok ? 'var(--ok-bg)' : 'var(--err-bg)',
            border: `1px solid ${inlineTestResult.ok ? 'var(--ok-line)' : 'var(--err-line)'}`,
            borderRadius: 7, color: inlineTestResult.ok ? 'var(--ok)' : 'var(--err)', fontSize: 12,
          }}>
            {inlineTestResult.ok ? '✓' : '✗'} {inlineTestResult.msg}
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: 'var(--err-bg)', border: '1px solid var(--err-line)',
            borderRadius: 7, color: 'var(--err)', fontSize: 12,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {isEdit && (
            <button
              type="button"
              className="btn-ghost"
              style={{ borderColor: 'var(--ok-line)', color: 'var(--ok)' }}
              onClick={handleTestInline}
              disabled={inlineTesting || !form.url}
              title={form.url ? 'Test with this token without saving' : 'Enter a URL first'}
            >
              {inlineTesting ? 'Testing…' : 'Test connection'}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add gateway'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Gateway card ─────────────────────────────────────────────────────────────
function GatewayCard({ gw, onEdit, onDelete, onTest, onTestSim, onRemoveClick }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const [testingSim1, setTestingSim1] = useState(false);
  const [testingSim2, setTestingSim2] = useState(false);
  const [simTestResult, setSimTestResult] = useState(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(gw);
      if (result.status === 'online') {
        setTestResult({ ok: true, msg: '✓ Gateway reachable and responding' });
      } else if (result.last_error) {
        setTestResult({ ok: false, msg: result.last_error });
      } else if (result.status === 'slow') {
        setTestResult({ ok: false, msg: 'Gateway slow to respond — may be overloaded' });
      } else {
        setTestResult({ ok: false, msg: `Status: ${result.status}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message || 'Connection failed — gateway unreachable' });
    } finally {
      setTesting(false);
    }
  }

  async function handleTestSim(sim) {
    if (sim === 'sim1') setTestingSim1(true);
    else setTestingSim2(true);
    setSimTestResult(null);
    try {
      const result = await onTestSim(gw, sim);
      setSimTestResult({ sim, ok: !result.failed, msg: result.message });
    } catch (e) {
      setSimTestResult({ sim, ok: false, msg: e.message || 'Test failed' });
    } finally {
      if (sim === 'sim1') setTestingSim1(false);
      else setTestingSim2(false);
    }
  }

  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {gw.name}
          </div>
          <div className="num" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {gw.url}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {gw.in_use ? (
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.06em', padding: '2px 7px',
              borderRadius: 5, color: '#fff', background: 'var(--info)',
              whiteSpace: 'nowrap',
            }}>
              In Use
            </span>
          ) : null}
          <Pill status={gw.status} label={gw.status} />
        </div>
      </div>

      {/* Meta grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'SIM', value: gw.sim_carrier || '—' },
          { label: 'SIM 1 #', value: gw.number || '—', mono: true },
          { label: 'SIM 2 #', value: gw.number2 || '—', mono: true },
          { label: 'Last beat', value: timeAgo(gw.last_beat), mono: true },
          { label: 'Sent today', value: formatNumber(gw.sent_today), mono: true },
          { label: 'State', value: gw.active ? 'Active' : 'Disabled', color: gw.active ? 'var(--ok)' : 'var(--ink-3)' },
        ].map(m => (
          <div key={m.label} style={{ background: 'var(--bg-soft)', borderRadius: 7, padding: '7px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
              {m.label}
            </div>
            <div className={m.mono ? 'num' : ''} style={{ fontSize: 12, fontWeight: 500, color: m.color || 'var(--ink-1)' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Token row */}
      {gw.token && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--bg-soft)', borderRadius: 7 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>Token</div>
          <div className="num" style={{ flex: 1, fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showToken ? gw.token : '•'.repeat(Math.min(24, gw.token.length))}
          </div>
          <button
            style={{ fontSize: 11, color: 'var(--brand-1)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
            onClick={() => setShowToken(s => !s)}
          >
            {showToken ? 'Hide' : 'Reveal'}
          </button>
        </div>
      )}

      {/* No-load warning from send failures */}
      {gw.consecutive_fails >= 5 && (
        <div style={{
          padding: '7px 10px', borderRadius: 7, fontSize: 12,
          background: 'var(--err-bg)', border: '1px solid var(--err-line)',
          color: 'var(--err)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            {gw.consecutive_fails} consecutive failures —{' '}
            <strong>SIM may have no load</strong>
          </span>
        </div>
      )}

      {/* Delivery failure warning badge */}
      {gw.delivery_fails >= 3 && (
        <div style={{
          padding: '7px 10px', borderRadius: 7, fontSize: 12,
          background: 'linear-gradient(135deg, var(--err-bg), #fff4e5)',
          border: '1.5px solid var(--warn)',
          color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            <strong>{gw.delivery_fails} undelivered messages</strong> —{' '}
            {gw.delivery_fails >= 10
              ? 'Carrier is not delivering. SIM likely has no load!'
              : gw.delivery_fails >= 5
                ? 'Carrier delivery failing consistently. Check SIM load.'
                : 'Carrier not confirming delivery. May indicate no load.'}
          </span>
        </div>
      )}

      {/* Connectivity test result */}
      {testResult && (
        <div style={{
          padding: '7px 10px', borderRadius: 7, fontSize: 12,
          background: testResult.ok ? 'var(--ok-bg)' : 'var(--err-bg)',
          border: `1px solid ${testResult.ok ? 'var(--ok-line)' : 'var(--err-line)'}`,
          color: testResult.ok ? 'var(--ok)' : 'var(--err)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {testResult.ok ? '✓' : '✗'} {testResult.msg}
        </div>
      )}

      {/* SIM test result */}
      {simTestResult && (
        <div style={{
          padding: '7px 10px', borderRadius: 7, fontSize: 12,
          background: simTestResult.ok ? 'var(--ok-bg)' : 'var(--err-bg)',
          border: `1px solid ${simTestResult.ok ? 'var(--ok-line)' : 'var(--err-line)'}`,
          color: simTestResult.ok ? 'var(--ok)' : 'var(--err)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {simTestResult.ok ? '✓' : '✗'}
          <span><strong>SIM {simTestResult.sim === 'sim2' ? '2' : '1'}:</strong> {simTestResult.msg}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={handleTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button className="btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onEdit(gw)}>
          Edit
        </button>
        <button
          className="btn-ghost"
          style={{ flex: 1, justifyContent: 'center', color: 'var(--err)', borderColor: 'var(--err-line)' }}
          onClick={() => onRemoveClick(gw)}
        >
          Remove
        </button>
      </div>

      {/* SIM test buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-ghost"
          style={{
            flex: 1, justifyContent: 'center',
            borderColor: 'var(--ok-line)', color: 'var(--ok)',
          }}
          onClick={() => handleTestSim('sim1')}
          disabled={testingSim1 || !gw.number}
          title={!gw.number ? 'Set SIM 1 number first' : 'Send test SMS via SIM 1'}
        >
          {testingSim1 ? 'Sending…' : `📱 Test SIM 1`}
        </button>
        <button
          className="btn-ghost"
          style={{
            flex: 1, justifyContent: 'center',
            borderColor: 'var(--brand-1)', color: 'var(--brand-1)',
          }}
          onClick={() => handleTestSim('sim2')}
          disabled={testingSim2 || !gw.number2}
          title={!gw.number2 ? 'Set SIM 2 number first' : 'Send test SMS via SIM 2'}
        >
          {testingSim2 ? 'Sending…' : `📱 Test SIM 2`}
        </button>
      </div>
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'devices', label: 'Devices' },
  { key: 'numbers', label: 'Number History' },
];

// ── Main page ────────────────────────────────────────────────────────────────
export default function Gateway() {
  const [tab, setTab] = useState('devices');
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingGw, setEditingGw] = useState(null); // null = add, object = edit
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [serverInfo, setServerInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    api.get('/gateways')
      .then(data => { setGateways(data.gateways || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get('/server-info').then(setServerInfo).catch(() => {});
  }, []);

  function copyText(text) {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  useWS((event) => {
    if (event.type === 'gateway:status') {
      setGateways(prev => prev.map(g =>
        g.id === event.gatewayId
          ? { ...g, status: event.status, last_beat: event.last_beat, sent_today: event.sent_today ?? g.sent_today, last_error: event.last_error ?? g.last_error }
          : g
      ));
    }
    if (event.type === 'gateway:warning') {
      setGateways(prev => prev.map(g =>
        g.id === event.gatewayId
          ? {
              ...g,
              consecutive_fails: event.consecutive_fails,
              delivery_fails: event.delivery_fails ?? g.delivery_fails,
            }
          : g
      ));
    }
  });

  function openAdd()       { setEditingGw(null); setFormError(''); setShowForm(true); }
  function openEdit(gw)    { setEditingGw(gw);   setFormError(''); setShowForm(true); }
  function closeForm()     { setShowForm(false); setEditingGw(null); setFormError(''); }

  async function handleSave(form) {
    setSaving(true);
    setFormError('');
    try {
      if (editingGw) {
        const updated = await api.put(`/gateways/${editingGw.id}`, form);
        setGateways(prev => prev.map(g => g.id === editingGw.id ? updated.gateway : g));
      } else {
        const created = await api.post('/gateways', form);
        setGateways(prev => [created.gateway, ...prev]);
        // Auto-test the new gateway
        try {
          const result = await api.post(`/gateways/${created.id}/test`);
          const gw = result.gateway || result;
          setGateways(prev => prev.map(g => g.id === created.id ? { ...g, status: gw.status || g.status, last_beat: gw.last_beat || g.last_beat } : g));
        } catch { /* test failure is non-fatal */ }
      }
      closeForm();
    } catch (e) {
      setFormError(e.message || 'Failed to save gateway');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(gw) {
    try {
      await api.del(`/gateways/${gw.id}`);
      setGateways(prev => prev.filter(g => g.id !== gw.id));
    } catch (e) {
      toast('Failed to remove: ' + e.message, 'error');
    }
    setConfirmDelete(null);
  }

  async function handleTest(gw) {
    const result = await api.post(`/gateways/${gw.id}/test`);
    const gwData = result.gateway || result;
    setGateways(prev => prev.map(g =>
      g.id === gw.id
        ? { ...g, status: gwData.status || g.status, last_beat: gwData.last_beat || g.last_beat, last_error: gwData.last_error ?? g.last_error }
        : g
    ));
    return gwData;
  }

  async function handleTestInline(gatewayId, token) {
    // Test with the form's token instead of the DB-stored one
    const result = await api.post(`/gateways/${gatewayId}/test`, { token });
    const gwData = result.gateway || result;
    if (gwData.status === 'online') {
      return { ok: true, msg: '✓ Gateway reachable and responding' };
    } else if (gwData.last_error) {
      return { ok: false, msg: gwData.last_error };
    } else if (gwData.status === 'slow') {
      return { ok: false, msg: 'Gateway slow to respond — may be overloaded' };
    } else {
      return { ok: false, msg: `Status: ${gwData.status}` };
    }
  }

  async function handleTestSim(gw, sim) {
    const result = await api.post(`/gateways/${gw.id}/test-sim`, { sim });
    return result;
  }

  const online  = gateways.filter(g => g.status === 'online').length;
  const slow    = gateways.filter(g => g.status === 'slow').length;
  const offline = gateways.filter(g => !['online', 'slow'].includes(g.status)).length;

  return (
    <AgentShell>

      {/* Page head */}
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Devices</div>
            <h1>Gateways</h1>
            <div className="page-sub">Android relay devices your broadcasts route through.</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LiveBadge label="Live" />
          {!showForm && (
            <button className="btn-primary" onClick={openAdd}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add gateway
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: tab === t.key ? 600 : 500,
              color: tab === t.key ? 'var(--ink-1)' : 'var(--ink-3)',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--ink-1)' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* This PC's server address — paste into the Android gateway app */}
      {serverInfo && serverInfo.primary_url && (
        <div className="card" style={{ padding: 16, marginBottom: 20, border: '1px solid var(--brand-1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 2 }}>
                Connect your Android gateway
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 420 }}>
                On your Android phone (FlashSMSGateway app), set the Server URL to the address below.
                Works over Wi-Fi/LAN — <strong>no internet needed</strong>.
                The phone and this PC must be on the same network.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <code className="num" style={{
                fontSize: 15, fontWeight: 700, color: 'var(--brand-1)',
                background: 'var(--ok-bg)', border: '2px solid var(--ok-line)',
                borderRadius: 8, padding: '8px 12px', userSelect: 'all',
              }}>
                {serverInfo.primary_url}
              </code>
              <button className="btn-primary" onClick={() => copyText(serverInfo.primary_url)}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Alternative addresses */}
          {serverInfo.addresses && serverInfo.addresses.length > 1 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-soft)', fontSize: 11, color: 'var(--ink-3)' }}>
              Other network adapters (if the main one doesn&apos;t work):&nbsp;
              {serverInfo.addresses
                .filter(a => a.url !== serverInfo.primary_url)
                .map(a => (
                  <code key={a.ip} className="num" title={`Copy ${a.url} (${a.iface})`} onClick={() => copyText(a.url)}
                    style={{ marginRight: 8, cursor: 'pointer', color: 'var(--ink-2)', textDecoration: 'underline dotted' }}>
                    {a.url}
                  </code>
                ))}
            </div>
          )}

          {/* Connectivity hint */}
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: '1px solid var(--line-soft)',
            display: 'flex', gap: 6, alignItems: 'flex-start',
            fontSize: 11, color: 'var(--ink-4)',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>
              Your phone needs to reach this PC. If they&apos;re on the same Wi-Fi, use the LAN URL above.
              If not (e.g. the phone is at a different location), set up ngrok in Settings for a public URL.
            </span>
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total',   value: gateways.length, color: 'var(--ink-1)' },
          { label: 'Online',  value: online,           color: 'var(--ok)'   },
          { label: 'Slow',    value: slow,             color: 'var(--warn)' },
          { label: 'Offline', value: offline,          color: 'var(--err)'  },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {s.label}
            </div>
            <div className="num" style={{ fontSize: 26, fontWeight: 600, marginTop: 8, color: s.color, lineHeight: 1 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Tab: Number History */}
      {tab === 'numbers' && <GatewayNumbers />}

      {/* Tab: Devices */}
      {tab === 'devices' && (<>

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ marginBottom: 20 }}>
          <GatewayForm
            initial={editingGw || EMPTY_FORM}
            onSave={handleSave}
            onCancel={closeForm}
            onTestInline={handleTestInline}
            saving={saving}
            error={formError}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          Loading gateways…
        </div>
      )}

      {/* Empty state */}
      {!loading && gateways.length === 0 && !showForm && (
        <div className="card" style={{ padding: '56px 24px', textAlign: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" style={{ margin: '0 auto 14px' }}>
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
            <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>No gateways yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>
            Add an Android device running FlashSMSGateway to start sending broadcasts.
          </div>
          <button className="btn-primary" onClick={openAdd}>Add your first gateway</button>
        </div>
      )}

      {/* Gateway cards grid */}
      {!loading && gateways.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {gateways.map(gw => (
            <GatewayCard
              key={gw.id}
              gw={gw}
              onEdit={openEdit}
              onDelete={handleDelete}
              onTest={handleTest}
              onTestSim={handleTestSim}
              onRemoveClick={setConfirmDelete}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Remove Gateway"
          message={`Remove "${confirmDelete.name}"? It will no longer be available for broadcasts.`}
          confirmLabel="Remove"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      </>)} {/* end tab=devices */}
    </AgentShell>
  );
}
