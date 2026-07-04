import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import { api } from '../../lib/api.js';
import { formatDateShort } from '../../lib/format.js';

export default function Admins() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'admin' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/agents/admins');
      setItems(data.admins || []);
    } catch (e) {}
    setLoading(false);
  }

  function openNew() {
    setEditItem(null);
    setForm({ username: '', password: '', display_name: '', role: 'admin' });
    setError('');
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ username: item.username, password: '', display_name: item.display_name, role: item.role || 'admin' });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editItem) {
        const updated = await api.put(`/agents/admins/${editItem.id}`, { display_name: form.display_name, ...(form.password ? { password: form.password } : {}) });
        setItems(prev => prev.map(a => a.id === editItem.id ? updated.admin : a));
      } else {
        const payload = { ...form, role: form.role };
        const a = await api.post('/agents', payload);
        setItems(prev => [a.agent, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function handleDelete(item) {
    try {
      await api.del(`/agents/admins/${item.id}`);
      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (e) {
      alert(e.message);
    }
    setConfirmDelete(null);
  }

  const activeItems = items.filter(a => a.active).length;
  const idleItems = items.filter(a => !a.active).length;

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">People & Devices</div>
          <h1>Admins</h1>
          <div className="page-sub">
            Manage admin accounts. Super admins can create and manage other admins.
          </div>
        </div>
        <button className="btn-primary" onClick={openNew}>
          Create admin
        </button>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Admins', val: items.length },
          { label: 'Active', val: activeItems },
          { label: 'Inactive', val: idleItems },
          { label: 'Super admins', val: items.filter(a => a.role === 'super_admin').length },
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
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No admins.</td></tr>}
            {items.map(a => (
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
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: a.role === 'super_admin' ? 'var(--brand-1)' : 'var(--ink-3)',
                    fontFamily: 'var(--mono)',
                  }}>
                    {a.role === 'super_admin' ? 'Super admin' : a.role}
                  </span>
                </td>
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
                    <button className="iconlink" onClick={() => setConfirmDelete(a)} title="Delete" style={{ color: a.role === 'super_admin' ? 'var(--ink-5)' : 'var(--err)' }} disabled={a.role === 'super_admin'}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{items.length} admins</span>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete Admin"
          message={`Permanently delete "${confirmDelete.display_name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && (
        <Modal title={editItem ? 'Edit Admin' : 'Create Admin'} onClose={() => setShowModal(false)}>
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
              {!editItem && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Role</label>
                  <select
                    className="input"
                    value={form.role}
                    onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
                    style={{ fontSize: 12 }}
                  >
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
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
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : (editItem ? 'Save' : 'Create admin')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
