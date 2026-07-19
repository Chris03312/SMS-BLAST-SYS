import React, { useState, useEffect } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function AgentTemplates() {
  const [templates, setTemplates] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState({ name: '', body: '', campaign_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    load();
    api.get('/campaigns').then(d => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);

  async function load() {
    try {
      const data = await api.get('/templates');
      setTemplates(data.templates || []);
      if (!selected && data.templates && data.templates.length > 0) {
        selectTemplate(data.templates[0]);
      }
    } catch (e) {}
  }

  function selectTemplate(t) {
    setSelected(t);
    setEditing({
      name: t.name,
      body: t.body,
      campaign_id: t.campaign_id || '',
    });
    setCreating(false);
    setError('');
  }

  function startNew() {
    setSelected(null);
    setCreating(true);
    setEditing({ name: '', body: '', campaign_id: '' });
    setError('');
  }

  /** Check if the template is admin-created — read-only for agents */
  function isAdminTemplate(t) {
    return t && (t.creator_role === 'admin' || t.creator_role === 'super_admin');
  }

  const selectedIsAdminTemplate = isAdminTemplate(selected);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const vars = [...editing.body.matchAll(/\{[^}]+\}/g)].map(m => m[0]);
      const payload = { name: editing.name, body: editing.body, variables: vars, campaign_id: editing.campaign_id || null };
      if (creating) {
        const t = await api.post('/templates', payload);
        setTemplates(prev => [t.template, ...prev]);
        selectTemplate(t.template);
        setCreating(false);
      } else {
        const t = await api.put(`/templates/${selected.id}`, payload);
        setTemplates(prev => prev.map(x => x.id === t.id ? t.template : x));
        setSelected(t.template);
      }
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!selected) return;
    try {
      await api.del(`/templates/${selected.id}`);
      setTemplates(prev => prev.filter(t => t.id !== selected.id));
      setSelected(null);
      setEditing({ name: '', body: '' });
    } catch (e) {
      toast(e.message, 'error');
    }
    setConfirmDelete(null);
  }

  async function handleDuplicate() {
    if (!selected) return;
    try {
      const t = await api.post('/templates', {
        name: selected.name + ' (copy)',
        body: selected.body,
        variables: JSON.parse(selected.variables || '[]'),
      });
      setTemplates(prev => [t.template, ...prev]);
      selectTemplate(t.template);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.body.toLowerCase().includes(search.toLowerCase())
  );

  const charCount = editing.body.length;
  const vars = [...editing.body.matchAll(/\{[^}]+\}/g)].map(m => m[0]);

  return (
    <AgentShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Templates</h1>
            <div className="page-sub">Manage reusable SMS message templates.</div>
          </div>
        </div>
        <button className="btn-primary" onClick={startNew}>New template</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Left list */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '10px 14px' }}>
            <input
              className="input"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding: '6px 10px', fontSize: 12 }}
            />
          </div>
          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '18px 14px', color: 'var(--ink-3)', fontSize: 13 }}>No templates.</div>
            )}
            {filtered.map(t => (
              <div
                key={t.id}
                onClick={() => selectTemplate(t)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line-soft)',
                  cursor: 'pointer',
                  background: selected?.id === t.id ? 'var(--bg-soft)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>{t.name}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>{t.use_count} uses</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right editor */}
        <div className="card">
          <div className="card-head">
            <h3>{creating ? 'New Template' : selected ? selected.name : 'Select a template'}</h3>
            {selected && !creating && (
              <div style={{ display: 'flex', gap: 6 }}>
                {!selectedIsAdminTemplate && (
                  <button className="btn-ghost" onClick={handleDuplicate}>Duplicate</button>
                )}
                {!selectedIsAdminTemplate && (
                  <button className="btn-danger" onClick={() => setConfirmDelete(selected)}>Delete</button>
                )}
              </div>
            )}
          </div>
          {selectedIsAdminTemplate && !creating && (
            <div style={{ padding: '10px 14px', background: 'var(--info-bg)', borderBottom: '1px solid var(--info-line)', fontSize: 11, color: 'var(--info)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              This template is managed by an admin and is read-only.
            </div>
          )}
          {(selected || creating) ? (
            <form style={{ padding: 18 }} onSubmit={handleSave}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Name</label>
                <input
                  className="input"
                  value={editing.name}
                  onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
                  required
                  disabled={selectedIsAdminTemplate}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Campaign</label>
                <select
                  className="input"
                  value={editing.campaign_id}
                  onChange={e => setEditing(prev => ({ ...prev, campaign_id: e.target.value }))}
                  style={{ fontSize: 12 }}
                  disabled={selectedIsAdminTemplate}
                >
                  <option value="">No campaign</option>
                  {campaigns.filter(c => c.status === 'active').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>Message body</label>
                  <span style={{ fontSize: 11, color: charCount > 160 ? 'var(--warn)' : 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                    {charCount}ch
                  </span>
                </div>
                <textarea
                  className="input"
                  rows={6}
                  value={editing.body}
                  onChange={e => setEditing(prev => ({ ...prev, body: e.target.value }))}
                  placeholder="Enter message body. Use {name}, {amount} for variables."
                  required
                  disabled={selectedIsAdminTemplate}
                  style={{ resize: 'vertical' }}
                />
              </div>
              {vars.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Detected variables</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {vars.map((v, i) => (
                      <span key={i} className="filter-pill" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{v}</span>
                    ))}
                  </div>
                </div>
              )}
              {/* Preview */}
              <div style={{ marginBottom: 14, padding: 14, background: 'var(--bg-soft)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Preview</div>
                <div style={{
                  maxWidth: 240, margin: '0 auto',
                  background: '#fff', border: '1px solid var(--line)',
                  borderRadius: 12, padding: 12, fontSize: 12, color: 'var(--ink-1)', lineHeight: 1.5,
                }}>
                  {editing.body || <span style={{ color: 'var(--ink-4)' }}>Your message appears here</span>}
                </div>
              </div>
              {error && (
                <div style={{ padding: '8px 12px', background: 'var(--err-bg)', border: '1px solid var(--err-line)', borderRadius: 7, color: 'var(--err)', fontSize: 12, marginBottom: 10 }}>
                  {error}
                </div>
              )}
              {selected && !creating && (
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
                  <span>Used <strong className="num">{selected.use_count}</strong> times</span>
                  <span>By: <strong>{selected.creator_name || 'Unknown'}</strong></span>
                </div>
              )}
              {!selectedIsAdminTemplate && (
                <button className="btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Saving...' : (creating ? 'Create template' : 'Save changes')}
                </button>
              )}
            </form>            ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              Select a template from the list or create a new one.
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Delete Template"
          message={`Permanently delete template "${confirmDelete.name}"? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </AgentShell>
  );
}
