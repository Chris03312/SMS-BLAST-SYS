import React, { useState, useEffect } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useNavigate } from 'react-router-dom';

const MAX_SELECT = 200;

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Recipients() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [dateFilter, setDateFilter] = useState(todayStr);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => { load(); }, [dateFilter]);

  async function load() {
    setLoading(true);
    try {
      const qs = `limit=200&date=${encodeURIComponent(dateFilter)}`;
      const data = await api.get(`/agent/contacts?${qs}`);
      setContacts(data.contacts || []);
      setTotal(data.total || 0);
      setUsed(data.used || 0);
    } catch (e) {
      toast(e.message, 'error');
    }
    setLoading(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SELECT) {
          toast(`You can select up to ${MAX_SELECT} numbers at a time`, 'warning');
          return prev;
        }
        next.add(id);
      }
      return next;
    });
    setSelectAll(false);
  }

  function toggleSelectAll() {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      const ids = contacts.slice(0, MAX_SELECT).map(c => c.id);
      setSelected(new Set(ids));
      setSelectAll(true);
    }
  }

  function handleCopySelected() {
    const nums = contacts
      .filter(c => selected.has(c.id))
      .map(c => c.phone_number)
      .join('\n');
    if (!nums) {
      toast('No contacts selected', 'warning');
      return;
    }
    navigator.clipboard.writeText(nums).then(() => {
      toast(`Copied ${selected.size} numbers to clipboard`, 'success');
    }).catch(() => {
      toast('Failed to copy', 'error');
    });
  }

  function handleSendToCompose() {
    const nums = contacts
      .filter(c => selected.has(c.id))
      .map(c => c.phone_number);
    if (nums.length === 0) {
      toast('No contacts selected', 'warning');
      return;
    }
    // Store in sessionStorage so the compose page can pick it up
    try {
      sessionStorage.setItem('srmc_imported_contacts', JSON.stringify(nums));
      toast(`Sent ${nums.length} numbers to Compose`, 'success');
      navigate('/compose');
    } catch (e) {
      toast('Failed to save contacts', 'error');
    }
  }

  return (
    <AgentShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Contacts</div>
            <h1>My Recipients</h1>
            <div className="page-sub">
              Numbers assigned to you by the admin. Select up to {MAX_SELECT} and copy or send them to the Compose page.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn-primary"
            disabled={selected.size === 0}
            onClick={handleSendToCompose}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Send to Compose ({selected.size})
          </button>
          <button
            className="btn-ghost"
            disabled={selected.size === 0}
            onClick={handleCopySelected}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy {selected.size}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Available', val: total, color: 'var(--ok)' },
          { label: 'Used', val: used, color: 'var(--ink-3)' },
          { label: 'Selected', val: selected.size, color: selected.size > 0 ? 'var(--info)' : 'var(--ink-3)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Date filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          Filter by date
        </label>
        <input
          type="date"
          value={dateFilter}
          onChange={e => { setDateFilter(e.target.value); setSelected(new Set()); setSelectAll(false); }}
          style={{
            padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)',
            fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--ink-1)',
            background: 'var(--bg)', outline: 'none', cursor: 'pointer',
          }}
        />
        {dateFilter !== todayStr() && (
          <button
            className="btn-ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => { setDateFilter(todayStr()); setSelected(new Set()); setSelectAll(false); }}
          >
            Reset to Today
          </button>
        )}
      </div>

      {/* Contacts table */}
      <div className="card">
        <div className="card-head">
          <h3>Contact Numbers</h3>
          {total > 0 && (
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--ink-2)' }}>
              <input
                type="checkbox"
                checked={selectAll}
                onChange={toggleSelectAll}
                style={{ accentColor: 'var(--ink-1)' }}
              />
              Select all {Math.min(total, MAX_SELECT)}
            </label>
          )}
        </div>

        {loading ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading...</div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: '40px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
              {dateFilter && dateFilter !== todayStr() ? 'No contacts found' : 'No contacts assigned'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
              {dateFilter && dateFilter !== todayStr()
                ? `No contacts were uploaded on ${new Date(dateFilter + 'T00:00:00').toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}. Try a different date.`
                : "Your admin hasn't uploaded any contacts for you yet."}
            </div>
          </div>
        ) : (
          <>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table>
                <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th style={{ textAlign: 'left' }}>Phone Number</th>
                    <th style={{ textAlign: 'left' }}>Batch</th>
                    <th style={{ textAlign: 'left' }}>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map(c => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => toggleSelect(c.id)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          style={{ accentColor: 'var(--ink-1)' }}
                        />
                      </td>
                      <td>
                        <span className="num" style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 500 }}>
                          {c.phone_number}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                        {c.batch_id?.slice(0, 8)}…
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                        {c.created_at ? new Date(c.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="footer">
              <span>
                Showing {contacts.length} of {total} available · {used} used
                {selected.size > 0 && <span style={{ marginLeft: 8, color: 'var(--info)' }}>· {selected.size} selected</span>}
              </span>
            </div>
          </>
        )}
      </div>
    </AgentShell>
  );
}
