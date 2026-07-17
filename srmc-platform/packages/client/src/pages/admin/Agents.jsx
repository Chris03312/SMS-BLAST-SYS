import React, { useState } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import { api } from '../../lib/api.js';
import { useApiQuery, useApiMutation } from '../../lib/useApiQuery.js';
import { formatDateShort } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { SkeletonTable } from '../../components/Skeleton.jsx';

function lastSeen(iso) {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 300) return 'online';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDateShort(iso);
}

export default function Admins() {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'admin' });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmToggleActive, setConfirmToggleActive] = useState(null);

  const { data, isLoading } = useApiQuery('admins', '/agents/admins');
  const items = data?.admins || [];

  const saveMut = useApiMutation(
    (body) => editItem ? api.put(`/agents/admins/${editItem.id}`, body) : api.post('/agents', body),
    { onRefetch: 'admins', onSuccess: () => setShowModal(false) },
  );

  const deleteMut = useApiMutation(
    (item) => api.del(`/agents/admins/${item.id}`),
    { onRefetch: 'admins' },
  );

  const toggleMut = useApiMutation(
    (item) => api.put(`/agents/admins/${item.id}`, { active: item.active ? 0 : 1 }),
    { onRefetch: 'admins' },
  );

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
    setError('');
    try {
      if (editItem) {
        await saveMut.mutateAsync({ display_name: form.display_name, ...(form.password ? { password: form.password } : {}) });
      } else {
        await saveMut.mutateAsync({ ...form, role: form.role });
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(item) {
    try { await deleteMut.mutateAsync(item); }
    catch (e) { toast(e.message, 'error'); }
    setConfirmDelete(null);
  }

  async function handleToggleActive(item) {
    try { await toggleMut.mutateAsync(item); }
    catch (e) { toast(e.message, 'error'); }
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
            <h1>Admins</h1>
            <div className="page-sub">Manage admin accounts. Super admins can create and manage other admins.</div>
          </div>
        </div>
        <button className="btn-primary" onClick={openNew}>Create admin</button>
      </div>

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
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTable cols={5} rows={5} avatar />}
            {!isLoading && items.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No admins.</td></tr>}
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
                  <span style={{ fontSize: 11, fontWeight: 500, color: a.role === 'super_admin' ? 'var(--brand-1)' : 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                    {a.role === 'super_admin' ? 'Super admin' : a.role}
                  </span>
                </td>
                <td>
                  {!a.active ? (
                    <span className="pill idle"><span className="dot" />Disabled</span>
                  ) : (
                    (() => {
                      const seen = lastSeen(a.last_login_at);
                      return seen === 'online' ? (
                        <span className="pill ok"><span className="dot" />Active</span>
                      ) : (
                        <span className="pill idle"><span className="dot" />{seen ? `Last seen ${seen}` : 'Inactive'}</span>
                      );
                    })()
                  )}
                </td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatDateShort(a.created_at)}</td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => openEdit(a)} title="Edit">✎</button>
                    <button className="iconlink" onClick={() => setConfirmToggleActive(a)} title={a.active ? 'Deactivate' : 'Activate'} style={{ color: a.active ? 'var(--warn)' : 'var(--ok)' }}>
                      {a.active
                        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      }
                    </button>
                    <button className="iconlink" onClick={() => setConfirmDelete(a)} title="Delete" style={{ color: a.role === 'super_admin' ? 'var(--ink-5)' : 'var(--err)' }} disabled={a.role === 'super_admin'}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer"><span>{items.length} admins</span></div>
      </div>

      {confirmToggleActive && (
        <ConfirmModal
          title={confirmToggleActive.active ? 'Deactivate Admin' : 'Activate Admin'}
          message={confirmToggleActive.active ? `Deactivate "${confirmToggleActive.display_name}"? They will not be able to log in or manage the platform.` : `Activate "${confirmToggleActive.display_name}"? They will regain access to the platform.`}
          confirmLabel={confirmToggleActive.active ? 'Deactivate' : 'Activate'}
          danger={confirmToggleActive.active}
          onConfirm={() => handleToggleActive(confirmToggleActive)}
          onCancel={() => setConfirmToggleActive(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Admin" message={`Permanently delete "${confirmDelete.display_name}"? This cannot be undone.`} confirmLabel="Delete" onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
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
                  <select className="input" value={form.role} onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))} style={{ fontSize: 12 }}>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Password {editItem && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(leave blank to keep)</span>}</label>
                <PasswordInput value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} required={!editItem} />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving...' : (editItem ? 'Save' : 'Create admin')}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
