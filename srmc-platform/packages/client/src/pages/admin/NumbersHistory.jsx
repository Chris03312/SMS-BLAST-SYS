import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { getTimezone } from '../../lib/format.js';
import { exportNumbersHistoryXlsx } from '../../lib/export.js';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { useToast } from '../../context/ToastContext.jsx';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', timeZone: getTimezone() });
}

export default function NumbersHistory() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  async function load(searchTerm) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (searchTerm) params.set('search', searchTerm);
      const data = await api.get(`/gateways/numbers?${params}`);
      setNumbers(data.numbers || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('[admin-numbers-history] load error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(''); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load(search.trim());
  }

  function handleClear() {
    setSearch('');
    load('');
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.del(`/gateways/numbers/${confirmDelete.id}`);
      toast('History record deleted', 'success');
      setNumbers(prev => prev.filter(n => n.id !== confirmDelete.id));
      setTotal(prev => prev - 1);
    } catch (e) {
      toast(e.message || 'Failed to delete', 'error');
    }
    setDeleting(false);
    setConfirmDelete(null);
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-head">
        <h3>SIM Card History</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!loading && numbers.length > 0 && (
            <button className="btn-ghost" onClick={() => exportNumbersHistoryXlsx(numbers)} style={{ padding: '4px 12px', fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, verticalAlign: 'middle' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          )}
          {!loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{total} changes</span>}
        </div>
      </div>

      {/* Search bar */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-soft)' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)',
              fontSize: 12.5, fontFamily: 'inherit', color: 'var(--ink-1)', background: 'var(--bg)', outline: 'none',
            }}
            placeholder="Search by gateway, agent, SIM 1 or SIM 2 number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: 12 }}>
            Search
          </button>
          {search && (
            <button type="button" className="btn-ghost" onClick={handleClear} style={{ padding: '8px 16px', fontSize: 12 }}>
              Clear
            </button>
          )}
        </form>
      </div>

      {loading ? (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
      ) : numbers.length === 0 ? (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            No number changes recorded
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {search ? 'Try a different search term.' : 'Number changes appear here when a gateway\'s SIM numbers are updated.'}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, color: 'var(--ink-1)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
                <th style={thStyle}>Gateway</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>SIM 1 Number</th>
                <th style={thStyle}>SIM 2 Number</th>
                <th style={thStyle}>SIM 1 Carrier</th>
                <th style={thStyle}>SIM 2 Carrier</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Changed</th>
                <th style={{ ...thStyle, textAlign: 'center', width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {numbers.map(n => (
                <tr key={n.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{n.gateway_name}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: n.agent_name ? 'var(--ink-1)' : 'var(--ink-4)', fontSize: 11.5 }}>
                      {n.agent_name || '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span className="num" style={{ color: n.number ? 'var(--ink-1)' : 'var(--ink-4)' }}>
                      {n.number || '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span className="num" style={{ color: n.number2 ? 'var(--ink-1)' : 'var(--ink-4)' }}>
                      {n.number2 || '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>{n.sim_carrier || '—'}</td>
                  <td style={tdStyle}>{n.sim2_carrier || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {timeAgo(n.changed_at)}
                  </td>
                  <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <button
                      className="iconlink"
                      onClick={() => setConfirmDelete(n)}
                      title="Delete record"
                      style={{ color: 'var(--err)', fontSize: 13 }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete History Record"
          message={`Remove the number change record for "${confirmDelete.gateway_name}" from ${timeAgo(confirmDelete.changed_at)}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 12px',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-3)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-soft)',
  zIndex: 1,
};

const tdStyle = {
  padding: '10px 12px',
  whiteSpace: 'nowrap',
};
