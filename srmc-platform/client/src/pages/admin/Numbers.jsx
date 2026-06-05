import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import Modal from '../../components/Modal.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatTime } from '../../lib/format.js';

export default function Numbers() {
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editGateway, setEditGateway] = useState(null);
  const [form, setForm] = useState({ name: '', url: '', token: '', sim_carrier: '', number: '', number2: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState({});

  useEffect(() => { load(); }, []);

  useWS((event) => {
    if (event.type === 'gateway:status') {
      setGateways(prev => prev.map(g => g.id === event.gatewayId
        ? { ...g, status: event.status, last_beat: event.last_beat, sent_today: event.sent_today }
        : g
      ));
    }
    if (event.type === 'gateway:warning') {
      setGateways(prev => prev.map(g => g.id === event.gatewayId
        ? { ...g, consecutive_fails: event.consecutive_fails }
        : g
      ));
    }
  });

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/gateways');
      setGateways(data.gateways || []);
    } catch (e) {}
    setLoading(false);
  }

  function openNew() {
    setEditGateway(null);
    setForm({ name: '', url: 'http://192.168.3.', token: '', sim_carrier: '', number: '', number2: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(g) {
    setEditGateway(g);
    setForm({ name: g.name, url: g.url, token: g.token || '', sim_carrier: g.sim_carrier || '', number: g.number || '', number2: g.number2 || '' });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editGateway) {
        const updated = await api.put(`/gateways/${editGateway.id}`, form);
        setGateways(prev => prev.map(g => g.id === editGateway.id ? updated.gateway : g));
      } else {
        const g = await api.post('/gateways', form);
        setGateways(prev => [g.gateway, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function handleDelete(g) {
    if (!confirm(`Remove ${g.name}?`)) return;
    try {
      await api.del(`/gateways/${g.id}`);
      setGateways(prev => prev.filter(x => x.id !== g.id));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleTest(g) {
    setTesting(prev => ({ ...prev, [g.id]: true }));
    try {
      const result = await api.post(`/gateways/${g.id}/test`);
      setGateways(prev => prev.map(x => x.id === g.id ? result.gateway : x));
    } catch (e) {
      alert('Test failed: ' + e.message);
    }
    setTesting(prev => ({ ...prev, [g.id]: false }));
  }

  function formatBeat(iso) {
    if (!iso) return 'Never';
    const ago = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (ago < 60) return `${ago}s ago`;
    if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
    return formatTime(iso);
  }

  return (
    <AdminShell crumbs={['People & Devices', 'Numbers']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">People & Devices</div>
          <h1>Gateway Numbers</h1>
          <div className="page-sub">Android SMS gateways connected to the broadcast network.</div>
        </div>
        <button className="btn-primary" onClick={openNew}>Add gateway</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Gateway</th>
              <th>URL</th>
              <th>SIM Carrier</th>
              <th>SIM 1 #</th>
              <th>SIM 2 #</th>
              <th>Status</th>
              <th>Last heartbeat</th>
              <th>Sent today</th>
              <th>Fails</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && gateways.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No gateways configured.</td></tr>}
            {gateways.map(g => (
              <tr key={g.id}>
                <td>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                  <div className="cell-id">{g.id.slice(0, 8)}</div>
                </td>
                <td className="num" style={{ fontSize: 12 }}>{g.url}</td>
                <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{g.sim_carrier || '—'}</td>
                <td className="num" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{g.number || '—'}</td>
                <td className="num" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{g.number2 || '—'}</td>
              <td><Pill status={g.status} label={g.status} /></td>
              <td className="num" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatBeat(g.last_beat)}</td>
              <td className="num">{g.sent_today || 0}</td>
              <td>
                {g.consecutive_fails >= 5 ? (
                  <span style={{ color: 'var(--err)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {g.consecutive_fails} fails
                  </span>
                ) : (
                  <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>—</span>
                )}
              </td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => handleTest(g)} title="Test" disabled={testing[g.id]} style={{ fontSize: 12 }}>
                      {testing[g.id] ? '…' : '⟳'}
                    </button>
                    <button className="iconlink" onClick={() => openEdit(g)} title="Edit">✎</button>
                    <button className="iconlink" onClick={() => handleDelete(g)} title="Remove" style={{ color: 'var(--err)' }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{gateways.length} gateways</span>
        </div>
      </div>

      {showModal && (
        <Modal title={editGateway ? 'Edit Gateway' : 'Add Gateway'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Name</label>
                <input className="input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Galaxy A54 – SIM 1" required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>URL</label>
                <input className="input mono" value={form.url} onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))} placeholder="http://192.168.3.78:8080" required style={{ fontSize: 12 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Bearer token</label>
                <input className="input mono" value={form.token} onChange={e => setForm(prev => ({ ...prev, token: e.target.value }))} placeholder="token from Android app" style={{ fontSize: 12 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>SIM carrier</label>
                <input className="input" value={form.sim_carrier} onChange={e => setForm(prev => ({ ...prev, sim_carrier: e.target.value }))} placeholder="e.g. Airtel, Jio, BSNL" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>SIM 1 number</label>
                <input className="input mono" value={form.number} onChange={e => setForm(prev => ({ ...prev, number: e.target.value }))} placeholder="e.g. +919700942849" style={{ fontSize: 12 }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>SIM 2 number</label>
                <input className="input mono" value={form.number2} onChange={e => setForm(prev => ({ ...prev, number2: e.target.value }))} placeholder="e.g. +918800123456" style={{ fontSize: 12 }} />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : (editGateway ? 'Save' : 'Add gateway')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
