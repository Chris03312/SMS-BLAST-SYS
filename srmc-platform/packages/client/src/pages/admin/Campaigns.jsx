import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import Modal from '../../components/Modal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateShort } from '../../lib/format.js';

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', status: 'active', boss_numbers: '' });
  const [editForm, setEditForm] = useState({ name: '', status: 'active', boss_numbers: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/campaigns');
      setCampaigns(data.campaigns || []);
    } catch (e) {}
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const c = await api.post('/campaigns', form);
      setCampaigns(prev => [c.campaign, ...prev]);
      setShowModal(false);
      setForm({ name: '', status: 'active', boss_numbers: '' });
      toast(`Campaign "${form.name}" created`, 'success');
    } catch (e) {
      setError(e.message);
      toast(e.message, 'error');
    }
    setSaving(false);
  }

  function handleEdit(c) {
    setEditItem(c);
    setEditForm({ name: c.name, status: c.status, boss_numbers: c.boss_numbers || '' });
    setError('');
    setShowEditModal(true);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editItem) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.put(`/campaigns/${editItem.id}`, editForm);
      setCampaigns(prev => prev.map(c => c.id === editItem.id ? updated.campaign : c));
      setShowEditModal(false);
      setEditItem(null);
      toast(`Campaign "${editForm.name}" updated`, 'success');
    } catch (e) {
      setError(e.message);
      toast(e.message, 'error');
    }
    setSaving(false);
  }

  async function handleStatusChange(id, status) {
    try {
      const updated = await api.put(`/campaigns/${id}`, { status });
      setCampaigns(prev => prev.map(c => c.id === id ? updated.campaign : c));
      toast(`Campaign status changed to "${status}"`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return formatDateShort(iso);
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Campaigns</h1>
            <div className="page-sub">Manage and track bulk SMS campaigns across all agents.</div>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>New campaign</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Broadcasts</th>
              <th>Sent</th>
              <th>Created</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>
            )}
            {!loading && campaigns.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No campaigns yet.</td></tr>
            )}
            {campaigns.map(c => (
              <tr key={c.id}>
                <td>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div className="cell-id">{c.id.slice(0, 8)}</div>
                </td>
                <td style={{ fontSize: 13, color: 'var(--ink-2)' }}>{c.owner_name || '—'}</td>
                <td><Pill status={c.status} label={c.status} /></td>
                <td className="num">{c.broadcast_count || 0}</td>
                <td className="num">{c.total_sent || 0}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatDate(c.created_at)}</td>
                <td>
                  <div className="row-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={() => handleEdit(c)}
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6 }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3, verticalAlign: 'middle' }}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit
                    </button>
                    <select
                      className="input"
                      value={c.status}
                      onChange={e => handleStatusChange(c.id, e.target.value)}
                      style={{ fontSize: 11, padding: '4px 6px', width: 100 }}
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="done">Done</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>{campaigns.length} campaigns</span>
        </div>
      </div>

      {showModal && (
        <Modal title="New Campaign" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Campaign name</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Q3 EMI Recovery Drive"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Status</label>
                <select className="input" value={form.status} onChange={e => setForm(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                  Boss Numbers
                  <span style={{ fontWeight: 400, color: 'var(--ink-4)', marginLeft: 4 }}>(one per line — these numbers receive campaign alerts)</span>
                </label>
                <textarea
                  className="input"
                  rows={4}
                  value={form.boss_numbers}
                  onChange={e => setForm(prev => ({ ...prev, boss_numbers: e.target.value }))}
                  placeholder="09171234567&#10;09179876543"
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create campaign'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {showEditModal && editItem && (
        <Modal title="Edit Campaign" onClose={() => { setShowEditModal(false); setEditItem(null); }}>
          <form onSubmit={handleSaveEdit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Campaign name</label>
                <input
                  className="input"
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Q3 EMI Recovery Drive"
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>Status</label>
                <select className="input" value={editForm.status} onChange={e => setEditForm(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="done">Done</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 6 }}>
                  Boss Numbers
                  <span style={{ fontWeight: 400, color: 'var(--ink-4)', marginLeft: 4 }}>(one per line — these numbers receive campaign alerts)</span>
                </label>
                <textarea
                  className="input"
                  rows={4}
                  value={editForm.boss_numbers}
                  onChange={e => setEditForm(prev => ({ ...prev, boss_numbers: e.target.value }))}
                  placeholder="09171234567&#10;09179876543"
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                />
              </div>
              {error && <div style={{ color: 'var(--err)', fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" onClick={() => { setShowEditModal(false); setEditItem(null); }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}
