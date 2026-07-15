import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { formatTime, getTimezone } from '../../lib/format.js';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', timeZone: getTimezone() });
}

export default function GatewayNumbers() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);

  async function load(searchTerm) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (searchTerm) params.set('search', searchTerm);
      const data = await api.get(`/gateways/numbers?${params}`);
      setNumbers(data.numbers || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('[gateway-numbers] load error:', e);
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

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Search by gateway name, SIM 1 or SIM 2 number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, fontSize: 13 }}
        />
        <button type="submit" className="btn-primary" style={{ padding: '8px 18px' }}>
          Search
        </button>
        {search && (
          <button type="button" className="btn-ghost" onClick={handleClear}>
            Clear
          </button>
        )}
      </form>

      {/* Results count */}
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        {loading ? 'Loading…' : `${total} number change${total !== 1 ? 's' : ''} recorded`}
      </div>

      {/* Empty state */}
      {!loading && numbers.length === 0 && (
        <div className="card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
            <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="2"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>
            No number changes recorded
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {search ? 'Try a different search term.' : 'Number changes will appear here when you update a gateway\'s SIM numbers.'}
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && numbers.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: 12.5, color: 'var(--ink-1)',
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-soft)' }}>
                <th style={thStyle}>Gateway</th>
                <th style={thStyle}>SIM 1 Number</th>
                <th style={thStyle}>SIM 2 Number</th>
                <th style={thStyle}>SIM 1 Carrier</th>
                <th style={thStyle}>SIM 2 Carrier</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Changed</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map(n => (
                <tr key={n.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{n.gateway_name}</span>
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
                  <td style={tdStyle}>
                    {n.sim_carrier || '—'}
                  </td>
                  <td style={tdStyle}>
                    {n.sim2_carrier || '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--ink-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {timeAgo(n.changed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
};

const tdStyle = {
  padding: '10px 12px',
  whiteSpace: 'nowrap',
};
