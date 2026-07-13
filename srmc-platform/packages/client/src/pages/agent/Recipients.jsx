import React, { useState, useEffect } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useNavigate } from 'react-router-dom';

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
  const [maxSelect, setMaxSelect] = useState(200);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    // Load max_selected_contacts setting
    api.get('/settings').then(s => {
      if (s.max_selected_contacts) setMaxSelect(Number(s.max_selected_contacts) || 200);
    }).catch(() => {});
    load();
  }, [dateFilter]);

  async function load() {
    setLoading(true);
    try {
      const qs = `date=${encodeURIComponent(dateFilter)}`;
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
        if (next.size >= maxSelect) {
          toast(`You can select up to ${maxSelect} numbers at a time`, 'warning');
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
      const ids = contacts.slice(0, maxSelect).map(c => c.id);
      setSelected(new Set(ids));
      setSelectAll(true);
    }
  }

  function toggleSelectColumn(columnContacts) {
    const unselected = columnContacts.filter(c => !selected.has(c.id));
    const toAdd = unselected.slice(0, Math.min(maxSelect, unselected.length));
    if (toAdd.length === 0) {
      toast('All contacts in this group are already selected', 'info');
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      for (const c of toAdd) next.add(c.id);
      return next;
    });
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
              Numbers assigned to you by the admin. Select up to {maxSelect} and copy or send them to the Compose page.
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

      {/* Group contacts by Category → DPD — sectioned column layout */}
      {(() => {
        // First group by category, then by DPD within each category
        const byCategory = {};
        for (const c of contacts) {
          const catKey = c.category || '__nocat__';
          if (!byCategory[catKey]) byCategory[catKey] = { category: c.category || '', dpdGroups: {} };
          const dpdKey = c.dpd_group || '__none__';
          if (!byCategory[catKey].dpdGroups[dpdKey]) byCategory[catKey].dpdGroups[dpdKey] = [];
          byCategory[catKey].dpdGroups[dpdKey].push(c);
        }

        // Sort categories: named ones first (natural sort), unnamed last
        const catKeys = Object.keys(byCategory).sort((a, b) => {
          if (a === '__nocat__') return 1;
          if (b === '__nocat__') return -1;
          return a.localeCompare(b, undefined, { numeric: true });
        });

        // Flatten to compute global max rows per column (for filler alignment)
        let globalMaxRows = 0;
        for (const catKey of catKeys) {
          const dpdKeys = Object.keys(byCategory[catKey].dpdGroups);
          for (const dpdKey of dpdKeys) {
            globalMaxRows = Math.max(globalMaxRows, byCategory[catKey].dpdGroups[dpdKey].length);
          }
        }

        return (
          <div className="card">
            <div className="card-head">
              <h3>Contact Numbers</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {total > 0 && (
                  <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--ink-2)' }}>
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={toggleSelectAll}
                      style={{ accentColor: 'var(--ink-1)' }}
                    />
                    Select all {Math.min(total, maxSelect)}
                  </label>
                )}
                {!loading && total > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                    {total} total
                  </span>
                )}
              </div>
            </div>

            {/* Category nav bar */}
            {!loading && contacts.length > 0 && catKeys.filter(k => k !== '__nocat__').length > 1 && (
              <div style={{
                padding: '8px 18px',
                borderBottom: '1px solid var(--line-soft)',
                background: 'var(--bg)',
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'center',
                position: 'sticky',
                top: 0,
                zIndex: 2,
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
                  Jump to:
                </span>
                {catKeys.filter(k => k !== '__nocat__').map(catKey => {
                  const section = byCategory[catKey];
                  const sectionTotal = Object.values(section.dpdGroups).reduce((sum, arr) => sum + arr.length, 0);
                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(`cat-section-${catKey.replace(/[^a-zA-Z0-9]/g, '_')}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: 5,
                        border: '1px solid rgba(59,130,246,0.25)',
                        background: 'rgba(59,130,246,0.06)',
                        color: '#3b82f6',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.06)'; }}
                    >
                      {section.category}
                      <span style={{ marginLeft: 4, opacity: 0.6, fontFamily: 'var(--mono)' }}>{sectionTotal}</span>
                    </button>
                  );
                })}
              </div>
            )}

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
              <div style={{ overflowX: 'auto', padding: '14px 18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {catKeys.map((catKey) => {
                    const section = byCategory[catKey];
                    const isNoCat = catKey === '__nocat__';
                    const catLabel = isNoCat ? 'Uncategorized' : section.category;
                    const sectionId = `cat-section-${catKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

                    // Sort DPD groups within this category
                    const dpdKeys = Object.keys(section.dpdGroups).sort((a, b) => {
                      if (a === '__none__') return 1;
                      if (b === '__none__') return -1;
                      return a.localeCompare(b, undefined, { numeric: true });
                    });

                    const sectionTotal = dpdKeys.reduce((sum, k) => sum + section.dpdGroups[k].length, 0);

                    return (
                      <div key={catKey} id={sectionId} style={{
                        border: `1px solid ${isNoCat ? 'var(--line-soft)' : 'rgba(59,130,246,0.25)'}`,
                        borderRadius: 10,
                        background: isNoCat ? 'transparent' : 'rgba(59,130,246,0.03)',
                        overflow: 'hidden',
                      }}>
                        {/* Category header */}
                        <div style={{
                          padding: '10px 14px',
                          background: isNoCat ? 'var(--bg-soft)' : 'rgba(59,130,246,0.08)',
                          borderBottom: `1px solid ${isNoCat ? 'var(--line-soft)' : 'rgba(59,130,246,0.15)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}>
                          <span style={{
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            color: isNoCat ? 'var(--ink-4)' : '#3b82f6',
                          }}>
                            {catLabel}
                          </span>
                          <span style={{
                            fontSize: 10,
                            fontFamily: 'var(--mono)',
                            color: 'var(--ink-4)',
                            background: 'var(--bg)',
                            padding: '1px 7px',
                            borderRadius: 4,
                          }}>
                            {sectionTotal}
                          </span>
                          {dpdKeys.length > 1 && (
                            <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                              {dpdKeys.length} DPD groups
                            </span>
                          )}
                        </div>

                        {/* DPD columns inside this category */}
                        <div style={{ display: 'flex', gap: 12, padding: '12px 14px', overflowX: 'auto', alignItems: 'stretch' }}>
                          {dpdKeys.map(dpdKey => {
                            const colContacts = section.dpdGroups[dpdKey];
                            const isNoDpd = dpdKey === '__none__';
                            const dpdLabel = isNoDpd ? 'No DPD' : dpdKey;
                            const colSelected = colContacts.filter(c => selected.has(c.id)).length;

                            return (
                              <div key={dpdKey} style={{
                                flex: '0 0 auto',
                                width: 200,
                                border: '1px solid var(--line-soft)',
                                borderRadius: 8,
                                background: 'var(--bg)',
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                              }}>
                                {/* DPD column header */}
                                <div style={{
                                  padding: '8px 10px',
                                  borderBottom: '1px solid var(--line-soft)',
                                  background: isNoDpd ? 'var(--bg-soft)' : 'rgba(219,39,119,0.06)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 5,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em',
                                      color: isNoDpd ? 'var(--ink-4)' : '#db2777',
                                    }}>
                                      {dpdLabel}
                                    </span>
                                    <span style={{
                                      fontSize: 9,
                                      fontFamily: 'var(--mono)',
                                      color: 'var(--ink-4)',
                                      background: 'var(--bg)',
                                      padding: '1px 6px',
                                      borderRadius: 3,
                                    }}>
                                      {colContacts.length}
                                    </span>
                                  </div>
                                  {(() => {
                                    const unselectedCount = colContacts.filter(c => !selected.has(c.id)).length;
                                    const canSelect = Math.min(maxSelect, unselectedCount);
                                    const disabled = canSelect <= 0;
                                    return (
                                      <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={e => { e.stopPropagation(); toggleSelectColumn(colContacts); }}
                                        style={{
                                          fontSize: 9,
                                          fontWeight: 600,
                                          padding: '2px 8px',
                                          borderRadius: 4,
                                          border: `1px solid ${disabled ? 'var(--line-soft)' : 'var(--line)'}`,
                                          background: disabled ? 'var(--bg-soft)' : 'var(--bg)',
                                          color: disabled ? 'var(--ink-4)' : 'var(--ink-2)',
                                          cursor: disabled ? 'default' : 'pointer',
                                          fontFamily: 'inherit',
                                          transition: 'all 0.12s',
                                          width: '100%',
                                          textAlign: 'center',
                                          opacity: disabled ? 0.5 : 1,
                                        }}
                                        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.borderColor = 'var(--ink-4)'; } }}
                                        onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--line)'; } }}
                                      >
                                        {disabled ? 'Full' : `Select ${canSelect}`}
                                      </button>
                                    );
                                  })()}
                                </div>

                                {/* Column body */}
                                <div style={{ flex: 1, overflowY: 'auto', maxHeight: 360 }}>
                                  {colContacts.map(c => (
                                    <div
                                      key={c.id}
                                      onClick={() => toggleSelect(c.id)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '5px 10px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid var(--line-soft)',
                                        background: selected.has(c.id) ? 'var(--bg-soft)' : 'transparent',
                                        transition: 'background 0.1s',
                                        fontSize: 11,
                                      }}
                                      onMouseEnter={e => { if (!selected.has(c.id)) e.currentTarget.style.background = 'var(--bg-soft)'; }}
                                      onMouseLeave={e => { if (!selected.has(c.id)) e.currentTarget.style.background = 'transparent'; }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selected.has(c.id)}
                                        onChange={() => toggleSelect(c.id)}
                                        onClick={e => e.stopPropagation()}
                                        style={{ accentColor: 'var(--ink-1)', cursor: 'pointer', flexShrink: 0, width: 12, height: 12 }}
                                      />
                                      <span className="num" style={{
                                        fontFamily: 'var(--mono)',
                                        color: 'var(--ink-1)',
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        fontSize: 11,
                                      }}>
                                        {c.phone_number}
                                      </span>
                                    </div>
                                  ))}
                                  {/* Empty rows to fill remaining space */}
                                  {Array.from({ length: globalMaxRows - colContacts.length }).map((_, i) => (
                                    <div key={`empty-${i}`} style={{ padding: '5px 10px', borderBottom: '1px solid var(--line-soft)', opacity: 0.3 }}>
                                      <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>—</span>
                                    </div>
                                  ))}
                                </div>

                                {/* Column footer */}
                                <div style={{
                                  padding: '5px 10px',
                                  borderTop: '1px solid var(--line-soft)',
                                  fontSize: 9,
                                  color: 'var(--ink-4)',
                                  fontFamily: 'var(--mono)',
                                  textAlign: 'center',
                                }}>
                                  {colSelected > 0 ? (
                                    <span style={{ color: 'var(--info)', fontWeight: 600 }}>{colSelected} selected</span>
                                  ) : (
                                    <span>Click to select</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="footer">
              <span>
                {catKeys.length} categor{catKeys.length !== 1 ? 'ies' : 'y'} · {total} numbers · {used} used
                {selected.size > 0 && <span style={{ marginLeft: 8, color: 'var(--info)' }}>· {selected.size} selected</span>}
              </span>
            </div>
          </div>
        );
      })()}
    </AgentShell>
  );
}
