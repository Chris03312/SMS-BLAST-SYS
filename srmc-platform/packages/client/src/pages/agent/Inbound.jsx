import React, { useState, useEffect, useRef } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import Pill from '../../components/Pill.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { useWS } from '../../lib/ws.js';
import { formatTime, getTimezone } from '../../lib/format.js';

/* nav=60px + padding-top=24px + padding-bottom=24px = 108px */
const SPLIT_HEIGHT = 'calc(100vh - 108px)';

const FOLDERS = [
  { key: 'all',          label: 'All',          icon: '◉' },
  { key: 'unread',       label: 'Unread',        icon: '●' },
  { key: 'confirmed',    label: 'Confirmed',     icon: '✓' },
  { key: 'opt-out',      label: 'Opt-outs',      icon: '✕' },
  { key: 'needs-reply',  label: 'Needs reply',   icon: '↩' },
];

const FLAG_LABELS = {
  'confirmed': 'Confirmed',
  'opt-out': 'Opt Out',
  'needs-reply': 'Needs Reply',
};

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', timeZone: getTimezone() });
}

function FolderPane({ folder, counts, onChange }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--line)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--line-soft)',
        fontSize: 11, fontWeight: 600,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}>
        Inbox
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {FOLDERS.map(f => (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px', borderRadius: 7,
              background: folder === f.key ? 'var(--ink-1)' : 'transparent',
              color: folder === f.key ? '#fff' : 'var(--ink-2)',
              border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
              fontSize: 13, fontWeight: 500,
            }}
          >
            <span>{f.label}</span>
            {counts[f.key] > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                background: folder === f.key ? 'rgba(255,255,255,0.2)' : 'var(--bg-soft)',
                color: folder === f.key ? '#fff' : 'var(--ink-3)',
                padding: '1px 7px', borderRadius: 10,
                fontFamily: 'var(--mono)',
              }}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Inbound() {
  const { user } = useAuth();
  const [folder, setFolder]       = useState('all');
  const [messages, setMessages]   = useState([]);
  const [counts, setCounts]       = useState({ all: 0, unread: 0, confirmed: 0, 'opt-out': 0, 'needs-reply': 0 });
  const [selected, setSelected]   = useState(null);
  const [conversation, setConversation] = useState([]);
  const [gateways, setGateways]   = useState([]);
  const [replyText, setReplyText] = useState('');
  const [replyGw, setReplyGw]     = useState('');
  const [replySim, setReplySim]   = useState('sim1');
  const [replying, setReplying]   = useState(false);
  const [replyError, setReplyError] = useState('');
  const [search, setSearch]       = useState('');
  const chatRef = useRef(null);

  useEffect(() => {
    api.get('/gateways').then(d => setGateways(d.gateways || [])).catch(e => console.error('[inbound] Load gateways:', e));
    refreshCounts();
  }, []);

  useEffect(() => { loadMessages(); }, [folder, search]);

  // Auto-select the first (latest) message when messages load
  useEffect(() => {
    if (messages.length > 0 && !selected) {
      handleSelect(messages[0]);
    }
  }, [messages, selected]);

  // Auto-scroll chat to bottom when conversation loads or new message sent
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation]);

  useWS((event) => {
    if (event.type === 'inbound:new') {
      // Agents only see messages belonging to their own broadcasts
      if (user?.role === 'agent' && event.message.agent_id !== user?.id) return;
      setMessages(prev => [event.message, ...prev]);
      setCounts(c => ({ ...c, all: c.all + 1, unread: c.unread + 1 }));
    }
  });

  async function refreshCounts() {
    try {
      const [all, unread, confirmed, optout, needsReply] = await Promise.all([
        api.get('/inbound?limit=1'),
        api.get('/inbound?limit=1&unread=1'),
        api.get('/inbound?limit=1&flag=confirmed'),
        api.get('/inbound?limit=1&flag=opt-out'),
        api.get('/inbound?limit=1&flag=needs-reply'),
      ]);
      setCounts({
        all:           all.total          || 0,
        unread:        unread.total       || 0,
        confirmed:     confirmed.total    || 0,
        'opt-out':     optout.total       || 0,
        'needs-reply': needsReply.total   || 0,
      });
    } catch (e) {
      console.error('[inbound] Refresh counts:', e);
    }
  }

  async function loadMessages() {
    try {
      const params = new URLSearchParams({ limit: '60' });
      if (folder === 'unread')      params.set('unread', '1');
      else if (folder !== 'all')    params.set('flag', folder);
      if (search.trim())            params.set('search', search.trim());
      const data = await api.get(`/inbound?${params}`);
      setMessages(data.messages || []);
    } catch (e) {
      console.error('[inbound] Load messages:', e);
    }
  }

  /** Check if a gateway has dual-SIM capability */
  function hasDualSim(gw) {
    return gw && ((gw.sim_carrier && gw.sim2_carrier) || (gw.number && gw.number2));
  }

  async function handleSelect(m) {
    setSelected(m);
    setReplyText('');
    setReplyError('');
    setReplyGw('');
    setReplySim('sim1');
    // Load full conversation thread
    try {
      const data = await api.get(`/inbound/conversation/${encodeURIComponent(m.from_number)}`);
      setConversation(data.messages || []);
    } catch (_) {
      setConversation([]);
    }
    if (!m.read_at) {
      try {
        await api.put(`/inbound/${m.id}`, { read: true });
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read_at: new Date().toISOString() } : x));
        setCounts(c => ({ ...c, unread: Math.max(0, c.unread - 1) }));
      } catch (e) {
      console.error('[inbound] Mark read:', e);
    }
    }
  }

  async function handleFlag(flag) {
    if (!selected) return;
    try {
      const updated = await api.put(`/inbound/${selected.id}`, { flag: selected.flag === flag ? null : flag });
      setMessages(prev => prev.map(m => m.id === selected.id ? { ...m, flag: updated.flag } : m));
      setSelected(s => ({ ...s, flag: updated.flag }));
      refreshCounts();
    } catch (e) {
      console.error('[inbound] Flag update:', e);
    }
  }

  async function handleReply(e) {
    e.preventDefault();
    if (!replyText.trim() || !replyGw) return;
    setReplying(true);
    setReplyError('');
    try {
      await api.post(`/inbound/${selected.id}/reply`, { message: replyText.trim(), gateway_id: replyGw, sim_mode: replySim });
      setReplyText('');
      // Add the sent message to conversation immediately for instant feedback
      const sentMsg = {
        id: 'temp-' + Date.now(),
        direction: 'outbound',
        other_number: selected.from_number,
        body: replyText.trim(),
        created_at: new Date().toISOString(),
      };
      setConversation(prev => [...prev, sentMsg]);
    } catch (e) {
      setReplyError(e.message || 'Failed to send');
    }
    setReplying(false);
  }

  return (
    <AgentShell>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '200px minmax(0,1fr) 360px',
        gap: 14,
        height: SPLIT_HEIGHT,
        minHeight: 0,
      }}>

        {/* ── FOLDER PANE ── */}
        <FolderPane folder={folder} counts={counts} onChange={setFolder} />

        {/* ── MESSAGE LIST ── */}
        <div style={{
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* List header + search */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>
                {FOLDERS.find(f => f.key === folder)?.label}
              </span>
              <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {counts[folder] || messages.length}
              </span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--bg-soft)', borderRadius: 7, padding: '6px 10px',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, color: 'var(--ink-1)', flex: 1, fontFamily: 'inherit' }}
                placeholder="Search by number or text…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Message rows */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {messages.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                No messages in this folder.
              </div>
            )}
            {messages.map(m => {
              const isActive  = selected?.id === m.id;
              const isUnread  = !m.read_at;
              return (
                <div
                  key={m.id}
                  onClick={() => handleSelect(m)}
                  style={{
                    padding: '11px 14px',
                    borderBottom: '1px solid var(--line-soft)',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${isActive ? 'var(--ink-1)' : 'transparent'}`,
                    background: isActive ? 'var(--bg-soft)' : '#fff',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span className="num" style={{ fontSize: 12.5, fontWeight: isUnread ? 700 : 500, color: 'var(--ink-1)' }}>
                      {m.from_number}
                    </span>
                    <span className="num" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                      {timeAgo(m.created_at)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12, color: isUnread ? 'var(--ink-2)' : 'var(--ink-3)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isUnread ? 500 : 400,
                  }}>
                    {m.body}
                  </div>
                  {m.linked_broadcast && (
                    <div style={{ marginTop: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" style={{ flexShrink: 0 }}>
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      </svg>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Re: {m.linked_broadcast.outbound_message || m.linked_broadcast.broadcast_message}
                      </span>
                    </div>
                  )}
                  {m.gateway_name && (
                    <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--ink-4)' }}>
                      <span style={{ fontWeight: 500 }}>{m.gateway_name}</span>
                      {m.sim_carrier && <span>📱1 {m.sim_carrier}</span>}
                      {m.sim2_carrier && <span>📱2 {m.sim2_carrier}</span>}
                    </div>
                  )}
                  {m.flag && (
                    <div style={{ marginTop: 4 }}>
                      <Pill status={m.flag} label={FLAG_LABELS[m.flag] || m.flag} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CONVERSATION PANE ── */}
        <div style={{
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {!selected ? (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-4)', gap: 10, padding: 32,
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span style={{ fontSize: 13 }}>Select a message</span>
            </div>
          ) : (
            <>
              {/* Conversation header */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--line-soft)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexShrink: 0,
              }}>
                <div>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)' }}>
                    {selected.from_number}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                    {formatTime(selected.created_at)}
                  </div>
                </div>
                {selected.flag && <Pill status={selected.flag} label={FLAG_LABELS[selected.flag] || selected.flag} />}
              </div>

              {/* Chat conversation — full thread */}
              <div ref={chatRef} style={{
                flex: 1, overflowY: 'auto',
                padding: 16,
                background: '#f7f7f8',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {conversation.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 12, padding: 20 }}>
                    No messages in this conversation.
                  </div>
                )}
                {conversation.map((msg, i) => {
                  const isInbound = msg.direction === 'inbound';
                  const isFirst = i === 0;
                  const isLast = i === conversation.length - 1;
                  const showSender = isFirst || (i > 0 && conversation[i-1].direction !== msg.direction);
                  return (
                    <div key={msg.id || i} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isInbound ? 'flex-start' : 'flex-end',
                    }}>
                      {/* Sender label */}
                      {showSender && (
                        <div style={{
                          fontSize: 10, color: 'var(--ink-4)',
                          marginBottom: 3, marginLeft: isInbound ? 4 : 0, marginRight: isInbound ? 0 : 4,
                          fontFamily: 'var(--mono)',
                        }}>
                          {isInbound ? msg.other_number || selected.from_number : 'You'}
                        </div>
                      )}
                      {/* Bubble */}
                      <div style={{
                        background: isInbound ? '#fff' : '#1a1a1a',
                        color: isInbound ? 'var(--ink-1)' : '#fff',
                        borderRadius: isInbound
                          ? '4px 14px 14px 14px'
                          : '14px 4px 14px 14px',
                        padding: '9px 13px',
                        fontSize: 13, lineHeight: 1.5,
                        maxWidth: '85%',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        border: isInbound ? '1px solid var(--line)' : 'none',
                      }}>
                        {msg.body}
                      </div>
                      {/* Timestamp */}
                      <div style={{
                        fontSize: 9.5, color: 'var(--ink-4)',
                        marginTop: 2, fontFamily: 'var(--mono)',
                        marginLeft: isInbound ? 4 : 0, marginRight: isInbound ? 0 : 4,
                      }}>
                        {formatTime(msg.created_at)}
                        {!isInbound && ' · ✓ Sent'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Flag buttons */}
              <div style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--line-soft)',
                display: 'flex', gap: 6,
                flexShrink: 0,
              }}>
                {[
                  { key: 'confirmed',   label: 'Confirmed'   },
                  { key: 'opt-out',     label: 'Opt-out'     },
                  { key: 'needs-reply', label: 'Needs reply' },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => handleFlag(f.key)}
                    style={{
                      fontSize: 11, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
                      fontFamily: 'inherit', fontWeight: 500,
                      background: selected.flag === f.key ? 'var(--ink-1)' : '#fff',
                      color:      selected.flag === f.key ? '#fff' : 'var(--ink-2)',
                      border:     `1px solid ${selected.flag === f.key ? 'var(--ink-1)' : 'var(--line)'}`,
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Reply composer */}
              <form
                onSubmit={handleReply}
                style={{
                  padding: '10px 12px',
                  borderTop: '1px solid var(--line-soft)',
                  display: 'flex', flexDirection: 'column', gap: 7,
                  flexShrink: 0,
                  background: 'var(--bg-page)',
                }}
              >
                {/* Gateway selector — full width */}
                <div style={{ width: '100%' }}>
                  <select
                    className="input"
                    value={replyGw}
                    onChange={e => { setReplyGw(e.target.value); setReplySim('sim1'); }}
                    style={{ fontSize: 12, width: '100%' }}
                  >
                    <option value="">Select gateway to send reply…</option>
                    {gateways.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* SIM selector — only when selected gateway has dual SIM */}
                {replyGw && hasDualSim(gateways.find(g => g.id === replyGw)) && (
                  <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                    {['sim1', 'sim2'].map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setReplySim(s)}
                        style={{
                          flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 600,
                          borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                          background: replySim === s ? 'var(--ink-1)' : '#fff',
                          color: replySim === s ? '#fff' : 'var(--ink-2)',
                          border: `1.5px solid ${replySim === s ? 'var(--ink-1)' : 'var(--line)'}`,
                          transition: 'all 0.12s',
                        }}
                      >
                        {s === 'sim1' ? '📱1 SIM 1' : '📱2 SIM 2'}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
                  <textarea
                    className="input"
                    rows={2}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type reply…"
                    style={{ resize: 'none', fontSize: 12, flex: 1 }}
                  />
                  <button
                    className="btn-primary"
                    type="submit"
                    disabled={replying || !replyText.trim() || !replyGw}
                    style={{ flexShrink: 0, padding: '9px 14px' }}
                  >
                    {replying ? '…' : '→'}
                  </button>
                </div>

                {replyError && (
                  <div style={{ fontSize: 11, color: 'var(--err)' }}>{replyError}</div>
                )}
              </form>
            </>
          )}
        </div>

      </div>
    </AgentShell>
  );
}
