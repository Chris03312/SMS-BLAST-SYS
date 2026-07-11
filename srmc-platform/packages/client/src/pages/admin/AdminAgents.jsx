import React, { useState, useEffect, useRef } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateShort } from '../../lib/format.js';
import { useWS } from '../../lib/ws.js';

export default function AdminAgents() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmToggleActive, setConfirmToggleActive] = useState(null);
  const [search, setSearch] = useState('');
  const broadcastSentRef = useRef({});
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  // Live-update sent_today from broadcast:progress WebSocket events
  useWS((event) => {
    if (event.type === 'broadcast:progress' && event.agent_id) {
      setItems(prev => prev.map(a => {
        if (a.id === event.agent_id) {
          const prevSent = broadcastSentRef.current[event.broadcastId] || 0;
          const delta = event.sent - prevSent;
          broadcastSentRef.current[event.broadcastId] = event.sent;
          return delta > 0 ? { ...a, sent_today: (a.sent_today || 0) + delta } : a;
        }
        return a;
      }));
    }
  });

  const filtered = items.filter(a =>
    !search ||
    a.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    a.username?.toLowerCase().includes(search.toLowerCase())
  );

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/agents');
      setItems(data.agents || []);
    } catch (e) {}
    setLoading(false);
  }

  function openNew() {
    setEditItem(null);
    setForm({ username: '', password: '', display_name: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ username: item.username, password: '', display_name: item.display_name });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editItem) {
        const updated = await api.put(`/agents/${editItem.id}`, { display_name: form.display_name, ...(form.password ? { password: form.password } : {}) });
        setItems(prev => prev.map(a => a.id === editItem.id ? updated.agent : a));
        toast(`Agent "${form.display_name}" updated`, 'success');
      } else {
        const a = await api.post('/agents', form);
        setItems(prev => [a.agent, ...prev]);
        toast(`Agent "${form.display_name}" created`, 'success');
      }
      setShowModal(false);
    } catch (e) {
      setError(e.message);
      toast(e.message, 'error');
    }
    setSaving(false);
  }

  async function handleDelete(item) {
    try {
      await api.del(`/agents/${item.id}`);
      setItems(prev => prev.filter(x => x.id !== item.id));
      toast(`Agent "${item.display_name}" deleted`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    setConfirmDelete(null);
  }

  async function handleToggleActive(item) {
    try {
      const newActive = item.active ? 0 : 1;
      const updated = await api.put(`/agents/${item.id}`, { active: newActive });
      setItems(prev => prev.map(a => a.id === item.id ? { ...a, active: updated.agent.active } : a));
      toast(`Agent "${item.display_name}" ${newActive ? 'activated' : 'deactivated'}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
    setConfirmToggleActive(null);
  }

  const activeItems = items.filter(a => a.active).length;
  const idleItems = items.filter(a => !a.active).length;

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">People & Devices</div>
            <h1>Agents</h1>
            <div className="page-sub">
              Manage agent accounts and their broadcast access.
            </div>
          </div>
        </div>
        <button className="btn-primary" onClick={openNew}>
          Invite agent
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Agents', val: items.length },
          { label: 'Active', val: activeItems },
          { label: 'Inactive', val: idleItems },
          { label: 'Sent today', val: items.reduce((s, a) => s + (a.sent_today || 0), 0) },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="card">
        {/* Search bar */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, color: 'var(--ink-1)', flex: 1, fontFamily: 'inherit' }}
            placeholder="Search agents by name or username..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Sent today</th>
              <th>Total Broadcast</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>{search ? 'No agents match your search.' : 'No agents.'}</td></tr>}
            {filtered.map(a => (
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
                <td className="num">{a.sent_today || 0}</td>
                <td className="num">{a.broadcast_count || 0}</td>
                <td>
                  <span className={`pill ${a.active ? 'ok' : 'idle'}`}>
                    <span className="dot" />
                    {a.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {formatDateShort(a.created_at)}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => openEdit(a)} title="Edit">✎</button>
                    <button
                      className="iconlink"
                      onClick={() => setConfirmToggleActive(a)}
                      title={a.active ? 'Deactivate' : 'Activate'}
                      style={{ color: a.active ? 'var(--warn)' : 'var(--ok)' }}
                    >
                      {a.active
                        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      }
                    </button>
                    <button className="iconlink" onClick={() => setConfirmDelete(a)} title="Delete" style={{ color: 'var(--err)' }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{filtered.length} of {items.length} agents</span>
        </div>
      </div>

      {confirmToggleActive && (
        <ConfirmModal
          title={confirmToggleActive.active ? 'Deactivate Agent' : 'Activate Agent'}
          message={confirmToggleActive.active
            ? `Deactivate "${confirmToggleActive.display_name}"? They will not be able to log in or send broadcasts.`
            : `Activate "${confirmToggleActive.display_name}"? They will regain access to the platform.`
          }
          confirmLabel={confirmToggleActive.active ? 'Deactivate' : 'Activate'}
          danger={confirmToggleActive.active}
          onConfirm={() => handleToggleActive(confirmToggleActive)}
          onCancel={() => setConfirmToggleActive(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Agent"
          message={`Permanently delete "${confirmDelete.display_name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Agent' : 'Invite Agent'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Display name</label>
                <input className="input" value={form.display_name} onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))} required />
              </div>
              {!editItem && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Username</label>
                  <input className="input mono" value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))} required style={{ fontSize: 12 }} />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                  Password {editItem && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(leave blank to keep)</span>}
                </label>
                <PasswordInput value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} required={!editItem} />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : (editItem ? 'Save' : 'Invite agent')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
