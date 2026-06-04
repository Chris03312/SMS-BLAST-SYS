import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Modal from '../../components/Modal.jsx';
import { api } from '../../lib/api.js';

export default function AdminTemplates() {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await api.get('/templates');
      setTemplates(data.templates || []);
    } catch (e) {}
  }

  function openEdit(t) {
    setSelected(t);
    setEditing({ name: t.name, body: t.body, category: t.category, dlt_id: t.dlt_id || '', variables: JSON.parse(t.variables || '[]') });
    setShowModal(true);
    setError('');
  }

  function openNew() {
    setSelected(null);
    setEditing({ name: '', body: '', category: 'transactional', dlt_id: '', variables: [] });
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
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.del(`/templates/${t.id}`);
      setTemplates(prev => prev.filter(x => x.id !== t.id));
    } catch (e) {
      alert(e.message);
    }
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.body.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell crumbs={['Operations', 'Templates']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Templates</h1>
          <div className="page-sub">Manage all SMS message templates including DLT IDs for compliance.</div>
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
              <th>Category</th>
              <th>Body</th>
              <th>DLT ID</th>
              <th>Uses</th>
              <th>Created by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No templates found.</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div className="cell-id">{t.id.slice(0, 8)}</div>
                </td>
                <td>
                  <span style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg-soft)', borderRadius: 5, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t.category}
                  </span>
                </td>
                <td style={{ maxWidth: 280 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</div>
                </td>
                <td className="num" style={{ fontSize: 12, color: t.dlt_id ? 'var(--ok)' : 'var(--ink-4)' }}>{t.dlt_id || '—'}</td>
                <td className="num">{t.use_count}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.creator_name || '—'}</td>
                <td>
                  <div className="row-actions">
                    <button className="iconlink" onClick={() => openEdit(t)} title="Edit">✎</button>
                    <button className="iconlink" onClick={() => handleDelete(t)} title="Delete" style={{ color: 'var(--err)' }}>✕</button>
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

      {showModal && editing && (
        <Modal title={selected ? 'Edit Template' : 'New Template'} onClose={() => setShowModal(false)} width={560}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Name</label>
                  <input className="input" value={editing.name} onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Category</label>
                  <select className="input" value={editing.category} onChange={e => setEditing(prev => ({ ...prev, category: e.target.value }))}>
                    <option value="transactional">Transactional</option>
                    <option value="promotional">Promotional</option>
                    <option value="otp">OTP</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Message body</label>
                <textarea className="input" rows={5} value={editing.body} onChange={e => setEditing(prev => ({ ...prev, body: e.target.value }))} required style={{ resize: 'vertical' }} />
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4, fontFamily: 'var(--mono)' }}>{editing.body.length}ch</div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>DLT Template ID</label>
                <input className="input mono" value={editing.dlt_id} onChange={e => setEditing(prev => ({ ...prev, dlt_id: e.target.value }))} placeholder="e.g. DLT00123456" style={{ fontSize: 12 }} />
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
