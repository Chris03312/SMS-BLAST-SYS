import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function AdminTemplates() {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await api.get('/templates');
      setTemplates(data.templates || []);
    } catch (e) {}
  }

  function openEdit(t) {
    setSelected(t);
    setEditing({ name: t.name, body: t.body, variables: JSON.parse(t.variables || '[]') });
    setShowModal(true);
    setError('');
  }

  function openNew() {
    setSelected(null);
    setEditing({ name: '', body: '', variables: [] });
    setShowModal(true);
    setError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const vars = [...editing.body.matchAll(/\{[^}]+\}/g)].map(m => m[0]);
      if (selected) {
        const t = await api.put(`/templates/${selected.id}`, { ...editing, variables: vars });
        setTemplates(prev => prev.map(x => x.id === t.id ? t.template : x));
      } else {
        const t = await api.post('/templates', { ...editing, variables: vars });
        setTemplates(prev => [t.template, ...prev]);
      }
      setShowModal(false);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function handleDelete(t) {
    try {
      await api.del(`/templates/${t.id}`);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
    } catch (e) {
      toast(e.message, 'error');
    }
    setConfirmDelete(null);
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.body.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Templates</h1>
            <div className="page-sub">Manage all SMS message templates.</div>
          </div>
        </div>
        <button className="btn-primary" onClick={openNew}>New template</button>
      </div>

      <div className="toolbar">
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          <input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Body</th>
              <th>Uses</th>
              <th>Created by</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No templates found.</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div className="cell-id">{t.id.slice(0, 8)}</div>
                </td>
                <td style={{ maxWidth: 280 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</div>
                </td>

                <td className="num">{t.use_count}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.creator_name || '—'}</td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => openEdit(t)} title="Edit">✎</button>
                    <button className="iconlink" onClick={() => setConfirmDelete(t)} title="Delete" style={{ color: 'var(--err)' }}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{filtered.length} templates</span>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete Template"
          message={`Permanently delete template "${confirmDelete.name}"? This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {showModal && editing && (
        <Modal title={selected ? 'Edit Template' : 'New Template'} onClose={() => setShowModal(false)} width={560}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Name</label>
                <input className="input" value={editing.name} onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Message body</label>
                <textarea className="input" rows={5} value={editing.body} onChange={e => setEditing(prev => ({ ...prev, body: e.target.value }))} required style={{ resize: 'vertical' }} />
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4, fontFamily: 'var(--mono)' }}>{editing.body.length}ch</div>
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
