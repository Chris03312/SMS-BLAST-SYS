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
  const [convMessage, setConvMessage] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [convLoading, setConvLoading] = useState(false);
  const [search, setSearch] = useState('');
  const limit = 50;

  async function load() {
    setLoading(true);
    try {
      // unique=1 groups by phone number — one row per number (latest message)
      const params = new URLSearchParams({ limit, offset: page * limit, unique: '1' });
      if (flag !== 'all') params.set('flag', flag);
      const data = await api.get(`/inbound?${params}`);
      setMessages(data.messages || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('[admin-inbound] Load:', e);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [flag, page]);

  const filtered = messages.filter(m =>
    !search ||
    m.from_number?.includes(search) ||
    (m.gateway_name || '').toLowerCase().includes(search.toLowerCase()) ||
    m.body?.toLowerCase().includes(search.toLowerCase())
  );

  useWS((event) => {
    if (event.type === 'inbound:new') {
      setMessages(prev => {
        // Match by (number + gateway) — same number from different gateways = separate rows
        const key = m => `${m.from_number}|${m.gateway_id || ''}`;
        const newKey = key(event.message);
        const idx = prev.findIndex(m => key(m) === newKey);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = event.message;
          return updated;
        }
        // New (number + gateway) pair — prepend to top and increment total
        setTotal(t => t + 1);
        return [event.message, ...prev];
      });
    }
  });

  async function handleFlagChange(id, newFlag) {
    try {
      const updated = await api.put(`/inbound/${id}`, { flag: newFlag });
      setMessages(prev => prev.map(m => m.id === id ? { ...m, flag: (updated.message || updated).flag } : m));
    } catch (e) {
      console.error('[admin-inbound] Flag change:', e);
    }
  }

  async function openConversation(m) {
    setConvMessage(m);
    setConversation([]);
    setConvLoading(true);
    try {
      const data = await api.get(`/inbound/conversation/${encodeURIComponent(m.from_number)}`);
      setConversation(data.messages || []);
    } catch (e) {
      console.error('[admin-inbound] Load conversation:', e);
    }
    setConvLoading(false);
    // Mark as read
    if (!m.read_at) {
      try {
        await api.put(`/inbound/${m.id}`, { read: true });
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read_at: new Date().toISOString() } : x));
      } catch (e) {
        console.error('[admin-inbound] Mark read:', e);
      }
    }
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return formatDate(iso);
  }

  const pages = Math.ceil(total / limit);

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">Operations</div>
            <h1>Inbound Messages</h1>
            <div className="page-sub">All inbound replies received across all gateways.</div>
          </div>
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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-soft)', borderRadius: 7, padding: '6px 10px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, color: 'var(--ink-1)', width: 180, fontFamily: 'inherit' }}
            placeholder="Search by number, gateway or text..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Gateway</th>
              <th>From</th>
              <th>Message</th>
              <th>Received</th>
              <th>Read</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>Loading...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '24px 18px' }}>{search ? 'No messages match your search.' : 'No inbound messages.'}</td></tr>}
            {filtered.map(m => (
              <tr
                key={m.id}
                onClick={() => openConversation(m)}
                style={{ cursor: 'pointer' }}
              >
                <td style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--mono)' }}>
                  {m.gateway_name || '—'}
                </td>
                <td className="num" style={{ fontSize: 13, fontWeight: 500 }}>{m.from_number}</td>
                <td style={{ maxWidth: 260, fontSize: 13, color: 'var(--ink-1)' }}>{m.body}</td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{formatTime(m.created_at)}</td>
                <td>
                  {m.read_at
                    ? <span style={{ fontSize: 11, color: 'var(--ok)' }}>Read</span>
                    : <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Unread</span>
                  }
                </td>
                <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
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

        {/* Conversation modal — polished chat bubble layout */}
        {convMessage && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={e => { if (e.target === e.currentTarget) setConvMessage(null); }}
          >
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 80px rgba(0,0,0,0.3)' }}>
              {/* Header — simple system-themed */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '16px 20px', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                      {convMessage.from_number}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1, fontFamily: 'var(--mono)' }}>
                      {formatTime(convMessage.created_at)}
                    </div>
                  </div>
                </div>
                <button onClick={() => setConvMessage(null)} className="iconlink" style={{ fontSize: 16 }}>×</button>
              </div>

              {/* Chat bubbles */}
              <div style={{
                flex: 1, overflowY: 'auto', padding: 16,
                background: 'linear-gradient(180deg, #f0f2f5 0%, #e8ecf1 100%)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {convLoading && (
                  <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 13, padding: 24 }}>
                    Loading conversation…
                  </div>
                )}
                {!convLoading && conversation.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 13, padding: 24 }}>
                    No messages in this conversation.
                  </div>
                )}
                {!convLoading && conversation.map((msg, i) => {
                  const isInbound = msg.direction === 'inbound';
                  const isFirst = i === 0;
                  const showSender = isFirst || (i > 0 && conversation[i-1].direction !== msg.direction);
                  return (
                    <div key={msg.id || i} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isInbound ? 'flex-start' : 'flex-end',
                      marginTop: showSender ? 4 : 0,
                    }}>
                      {showSender && (
                        <div style={{
                          fontSize: 10, fontWeight: 600, color: 'var(--ink-4)',
                          marginBottom: 4, marginLeft: isInbound ? 8 : 0, marginRight: isInbound ? 0 : 8,
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                        }}>
                          {isInbound ? (msg.other_number || convMessage.from_number) : 'Outbound Reply'}
                        </div>
                      )}
                      <div style={{
                        background: isInbound ? '#fff' : '#2563eb',
                        color: isInbound ? '#1e293b' : '#fff',
                        borderRadius: isInbound
                          ? '4px 16px 16px 16px'
                          : '16px 4px 16px 16px',
                        padding: '10px 14px',
                        fontSize: 13, lineHeight: 1.55,
                        maxWidth: '82%',
                        boxShadow: isInbound
                          ? '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'
                          : '0 2px 8px rgba(37,99,235,0.25)',
                        border: isInbound ? '1px solid rgba(0,0,0,0.05)' : 'none',
                        position: 'relative',
                      }}>
                        {msg.body}
                      </div>
                      <div style={{
                        fontSize: 9.5, color: 'var(--ink-4)',
                        marginTop: 3, fontFamily: 'var(--mono)',
                        marginLeft: isInbound ? 8 : 0, marginRight: isInbound ? 0 : 8,
                        display: 'flex', gap: 4, alignItems: 'center',
                      }}>
                        {formatDate(msg.created_at)}
                        {!isInbound && (
                          <>
                            <span style={{ opacity: 0.5 }}>·</span>
                            <span style={{ color: '#2563eb', fontWeight: 500 }}>✓ Sent</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer — subtle contact bar */}
              <div style={{
                padding: '10px 20px',
                borderTop: '1px solid var(--line)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--ink-4)',
              }}>
                <span>{conversation.filter(m => m.direction === 'inbound').length} inbound · {conversation.filter(m => m.direction !== 'inbound').length} outbound</span>
                {convMessage.flag && (
                  <Pill status={convMessage.flag} label={FLAG_LABELS[convMessage.flag] || convMessage.flag} />
                )}
              </div>
            </div>
          </div>
        )}
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
