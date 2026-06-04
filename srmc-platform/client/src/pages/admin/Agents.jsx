import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import { api } from '../../lib/api.js';
import { formatDateShort } from '../../lib/format.js';

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAgent, setEditAgent] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/agents');
      setAgents(data.agents || []);
    } catch (e) {}
    setLoading(false);
  }

  function openNew() {
    setEditAgent(null);
    setForm({ username: '', password: '', display_name: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(a) {
    setEditAgent(a);
    setForm({ username: a.username, password: '', display_name: a.display_name });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editAgent) {
        const updated = await api.put(`/agents/${editAgent.id}`, { display_name: form.display_name, ...(form.password ? { password: form.password } : {}) });
        setAgents(prev => prev.map(a => a.id === editAgent.id ? updated.agent : a));
      } else {
        const a = await api.post('/agents', form);
        setAgents(prev => [a.agent, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function handleToggle(a) {
    try {
      const updated = await api.put(`/agents/${a.id}`, { active: a.active ? 0 : 1 });
      setAgents(prev => prev.map(x => x.id === a.id ? updated.agent : x));
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDelete(a) {
    if (!confirm(`Deactivate ${a.display_name}?`)) return;
    try {
      await api.del(`/agents/${a.id}`);
      setAgents(prev => prev.map(x => x.id === a.id ? { ...x, active: 0 } : x));
    } catch (e) {
      alert(e.message);
    }
  }

  const active = agents.filter(a => a.active).length;
  const idle = agents.filter(a => !a.active).length;

  return (
    <AdminShell crumbs={['People & Devices', 'Agents']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">People & Devices</div>
          <h1>Agents</h1>
          <div className="page-sub">Manage agent accounts and their broadcast access.</div>
        </div>
        <button className="btn-primary" onClick={openNew}>Invite agent</button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', val: agents.length },
          { label: 'Active', val: active },
          { label: 'Inactive', val: idle },
          { label: 'Admins', val: 1 },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Sent today</th>
              <th>Total broadcasts</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && agents.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No agents.</td></tr>}
            {agents.map(a => (
              <tr key={a.id}>
                <td>
                  <div className="cell-name">
                    <div className="row-avatar">{a.display_name?.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{a.display_name}</div>
                      <div className="cell-id">{a.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`pill ${a.active ? 'ok' : 'idle'}`}>
                    <span className="dot" />
                    {a.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="num">{a.sent_today || 0}</td>
                <td className="num">{a.broadcast_count || 0}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {formatDateShort(a.created_at)}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => openEdit(a)} title="Edit">✎</button>
                    <button className="iconlink" onClick={() => handleToggle(a)} title="Toggle active" style={{ color: 'var(--warn)' }}>
                      {a.active ? '⊘' : '⊙'}
                    </button>
                    <button className="iconlink" onClick={() => handleDelete(a)} title="Remove" style={{ color: 'var(--err)' }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{agents.length} agents</span>
        </div>
      </div>

      {showModal && (
        <Modal title={editAgent ? 'Edit Agent' : 'Invite Agent'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Display name</label>
                <input className="input" value={form.display_name} onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))} required />
              </div>
              {!editAgent && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Username</label>
                  <input className="input mono" value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))} required style={{ fontSize: 12 }} />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                  Password {editAgent && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(leave blank to keep)</span>}
                </label>
                <input className="input" type="password" value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} required={!editAgent} />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : (editAgent ? 'Save' : 'Create agent')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
