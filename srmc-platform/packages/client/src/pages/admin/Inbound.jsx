import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import Pill from '../../components/Pill.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatDate } from '../../lib/format.js';

const FLAG_LABELS = {
  'confirmed': 'Confirmed',
  'opt-out': 'Opt Out',
  'needs-reply': 'Needs Reply',
};

const FLAGS = ['all', 'opt-out', 'confirmed', 'needs-reply'];

export default function AdminInbound() {
  const [messages, setMessages] = useState([]);
  const [total, setTotal] = useState(0);
  const [flag, setFlag] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit });
      if (flag !== 'all') params.set('flag', flag);
      const data = await api.get(`/inbound?${params}`);
      setMessages(data.messages || []);
      setTotal(data.total || 0);
    } catch (e) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [flag, page]);

  useWS((event) => {
    if (event.type === 'inbound:new') {
      setMessages(prev => [event.message, ...prev]);
      setTotal(t => t + 1);
    }
  });

  async function handleFlagChange(id, newFlag) {
    try {
      const updated = await api.put(`/inbound/${id}`, { flag: newFlag });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, flag: (updated.message || updated).flag } : m));
    } catch (e) {}
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return formatDate(iso);
  }

  const pages = Math.ceil(total / limit);

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Inbound Messages</h1>
          <div className="page-sub">All inbound replies received across all gateways.</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {FLAGS.map(f => (
            <button key={f} className={flag === f ? 'on' : ''} onClick={() => { setFlag(f); setPage(0); }}>
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>Message</th>
              <th>Re:</th>
              <th>Flag</th>
              <th>Received</th>
              <th>Read</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}              {!loading && messages.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>No inbound messages.</td></tr>}
            {messages.map(m => (
              <tr key={m.id}>
                <td className="num" style={{ fontSize: 13, fontWeight: 500 }}>{m.from_number}</td>
                <td style={{ maxWidth: 260, fontSize: 13, color: 'var(--ink-1)' }}>{m.body}</td>
                <td style={{ maxWidth: 160, fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                  {m.linked_broadcast
                    ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {m.linked_broadcast.outbound_message || m.linked_broadcast.broadcast_message}
                      </span>
                    : <span style={{ color: 'var(--ink-4)' }}>—</span>
                  }
                </td>
                <td>{m.flag ? <Pill status={m.flag} label={FLAG_LABELS[m.flag] || m.flag} /> : <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>—</span>}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{formatTime(m.created_at)}</td>
                <td>
                  {m.read_at
                    ? <span style={{ fontSize: 11, color: 'var(--ok)' }}>Read</span>
                    : <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Unread</span>
                  }
                </td>
                <td>
                  <select
                    className="input"
                    value={m.flag || ''}
                    onChange={e => handleFlagChange(m.id, e.target.value)}
                    style={{ fontSize: 11, padding: '4px 6px', width: 120 }}
                  >
                    <option value="">No flag</option>
                    <option value="opt-out">Opt Out</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="needs-reply">Needs Reply</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="footer">
          <span>Showing {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} of {total}</span>
          <div className="pager">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => (
              <button key={i} className={page === i ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
            ))}
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>›</button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
