import React, { useState, useEffect, useMemo, useRef } from 'react';
import AgentShell from '../../components/AgentShell.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useNavigate } from 'react-router-dom';
import Skeleton from '../../components/Skeleton.jsx';

const BATCH_SIZE = 200;

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
  const [available, setAvailable] = useState(0);
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [dateFilter, setDateFilter] = useState(todayStr);
  const [usedFilter, setUsedFilter] = useState('all'); // 'all', 'available', 'used'
  const [categoryFilter, setCategoryFilter] = useState('');
  const [allCategories, setAllCategories] = useState([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const { toast } = useToast();
  const navigate = useNavigate();
  const perPage = 200;
  // Cache for fetched pages — avoids re-fetching pages across selection clicks
  const pageCacheRef = useRef({});

  useEffect(() => {
    load();
  }, [dateFilter, usedFilter, categoryFilter, page]);

  // Reset to page 0 and clear page cache when filters change
  useEffect(() => {
    setPage(0);
    pageCacheRef.current = {};
  }, [dateFilter, usedFilter, categoryFilter]);

  async function load() {
    setLoading(true);
    try {
      const qs = `date=${encodeURIComponent(dateFilter)}&used=${usedFilter}&category=${encodeURIComponent(categoryFilter)}&page=${page}&perPage=${perPage}`;
      const data = await api.get(`/agent/contacts?${qs}`);
      setContacts(data.contacts || []);
      setAllCategories(data.all_categories || []);
      setTotal(data.total || 0);
      setAvailable(data.available || 0);
      setUsed(data.used || 0);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      toast(e.message, 'error');
    }
    setLoading(false);
  }

  // Group contacts by Category → DPD
  const grouped = useMemo(() => {
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

    return { byCategory, catKeys };  }, [contacts]);


  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function selectColumn(columnContacts, dpdKey, catKey) {
    // Snapshot which contacts are already selected at call time
    const initiallySelected = new Set(selected);

    // Find unselected contacts on the current page (within this column)
    const unselectedCurrent = columnContacts.filter(c => !initiallySelected.has(c.id));
    const toAdd = unselectedCurrent.slice(0, BATCH_SIZE);

    // Track IDs we're adding in this invocation to avoid dupes across fetches
    const locallyAdded = new Set();

    // Add the batch from the current page
    for (const c of toAdd) locallyAdded.add(c.id);
    if (toAdd.length > 0) {
      setSelected(prev => {
        const next = new Set(prev);
        for (const c of toAdd) next.add(c.id);
        return next;
      });
    }

    let remaining = BATCH_SIZE - toAdd.length;

    // If current page didn't have enough, fetch next pages
    if (remaining > 0) {
      let fetchPage = page + 1;
      while (remaining > 0 && fetchPage < totalPages) {
        try {
          // Use in-memory cache to avoid redundant API calls for already-fetched pages
          let pageContacts = pageCacheRef.current[fetchPage];
          if (!pageContacts) {
            const qs = `date=${encodeURIComponent(dateFilter)}&used=${usedFilter}&page=${fetchPage}&perPage=${perPage}`;
            const data = await api.get(`/agent/contacts?${qs}`);
            pageContacts = data.contacts || [];
            pageCacheRef.current[fetchPage] = pageContacts;
          }
          const nextCol = pageContacts.filter(c =>
            (c.dpd_group || '__none__') === dpdKey &&
            (c.category || '__nocat__') === catKey &&
            !initiallySelected.has(c.id) &&
            !locallyAdded.has(c.id)
          );
          if (nextCol.length === 0) {
            fetchPage++;
            continue;
          }

          const batch = nextCol.slice(0, remaining);
          for (const c of batch) locallyAdded.add(c.id);
          setSelected(prev => {
            const next = new Set(prev);
            for (const c of batch) next.add(c.id);
            return next;
          });
          remaining -= batch.length;
          fetchPage++;
        } catch (_) {
          break;
        }
      }
    }

    // If nothing could be added at all, inform the user
    if (locallyAdded.size === 0) {
      toast('All contacts in this group are already selected', 'info');
    }
  }

  function unselectColumn(columnContacts) {
    // Remove all contacts in this column from selection
    setSelected(prev => {
      const next = new Set(prev);
      for (const c of columnContacts) next.delete(c.id);
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
              Numbers assigned to you by the admin. Use the column buttons to quickly select or unselect numbers, then copy or send them to the Compose page.
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

      {/* Viewport-fill wrapper */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, flexShrink: 0 }}>
        {[
          { label: 'Available', val: available, color: 'var(--ok)' },
          { label: 'Used', val: used, color: 'var(--ink-3)' },
          { label: 'Selected', val: selected.size, color: selected.size > 0 ? 'var(--info)' : 'var(--ink-3)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Used status filter */}
        <div className="seg" style={{ fontSize: 11 }}>
          {['all', 'available', 'used'].map(s => (
            <button
              key={s}
              className={usedFilter === s ? 'on' : ''}
              onClick={() => { setUsedFilter(s); setSelected(new Set()); }}
            >
              {s === 'all' ? 'All' : s === 'available' ? 'Available' : 'Used'}
            </button>
          ))}
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          Date
        </label>
        <input
          type="date"
          value={dateFilter}
          onChange={e => { setDateFilter(e.target.value); setSelected(new Set()); }}
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
            onClick={() => { setDateFilter(todayStr()); setSelected(new Set()); }}
          >
            Reset to Today
          </button>
        )}
      </div>

      {/* Group contacts by Category → DPD — sectioned column layout */}
      {(() => {
        const { byCategory, catKeys } = grouped;

        return (
          <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="card-head" style={{ flexShrink: 0 }}>
              <h3>Contact Numbers</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!loading && total > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                    {total} total
                  </span>
                )}
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '24px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Skeleton variant="card" height={80} count={3} />
                <div style={{ display: 'flex', gap: 12 }}>
                  <Skeleton variant="card" height={200} width={200} />
                  <Skeleton variant="card" height={200} width={200} />
                  <Skeleton variant="card" height={200} width={200} />
                </div>
              </div>
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
              <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto', padding: '14px 18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {catKeys.map((catKey) => {
                    const section = byCategory[catKey];
                    const isNoCat = catKey === '__nocat__';
                    const catLabel = isNoCat ? 'Uncategorized' : section.category;
                    const sectionId = `cat-section-${catKey.replace(/[^a-zA-Z0-9]/g, '_')}`;

                    // Sort DPD groups: lowest DPD value on the left, 'No DPD' on the right
                    const dpdKeys = Object.keys(section.dpdGroups).sort((a, b) => {
                      if (a === '__none__') return 1;
                      if (b === '__none__') return -1;
                      const numA = parseInt(a.replace(/\D/g, '')) || 0;
                      const numB = parseInt(b.replace(/\D/g, '')) || 0;
                      return numA - numB;
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
                                    const colSelected = colContacts.filter(c => selected.has(c.id)).length;
                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {colSelected > 0 && (
                                          <button
                                            type="button"
                                            onClick={e => { e.stopPropagation(); unselectColumn(colContacts); }}
                                            style={{
                                              fontSize: 9,
                                              fontWeight: 600,
                                              padding: '2px 8px',
                                              borderRadius: 4,
                                              border: '1px solid rgba(219,39,119,0.3)',
                                              background: 'rgba(219,39,119,0.08)',
                                              color: '#db2777',
                                              cursor: 'pointer',
                                              fontFamily: 'inherit',
                                              transition: 'all 0.12s',
                                              width: '100%',
                                              textAlign: 'center',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(219,39,119,0.15)'; e.currentTarget.style.borderColor = 'rgba(219,39,119,0.5)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(219,39,119,0.08)'; e.currentTarget.style.borderColor = 'rgba(219,39,119,0.3)'; }}
                                          >
                                            ✕ Unselect {colSelected}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={e => { e.stopPropagation(); selectColumn(colContacts, dpdKey, catKey); }}
                                          style={{
                                            fontSize: 9,
                                            fontWeight: 600,
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            border: '1px solid var(--line)',
                                            background: 'var(--bg)',
                                            color: 'var(--ink-2)',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            transition: 'all 0.12s',
                                            width: '100%',
                                            textAlign: 'center',
                                          }}
                                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-soft)'; e.currentTarget.style.borderColor = 'var(--ink-4)'; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
                                        >
                                          Select {BATCH_SIZE}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </div>

                                {/* Column body */}
                                <div>
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
                                      {c.used !== undefined && (
                                        <span style={{
                                          fontSize: 8,
                                          fontWeight: 700,
                                          padding: '1px 5px',
                                          borderRadius: 3,
                                          flexShrink: 0,
                                          marginLeft: 'auto',
                                          color: c.used ? 'var(--ok)' : '#3b82f6',
                                          background: c.used ? 'var(--ok-bg)' : 'rgba(59,130,246,0.1)',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.04em',
                                        }}>
                                          {c.used ? 'Used' : 'Open'}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>

                                {/* Column footer */}
                                <div style={{
                                  marginTop: 'auto',
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

            {/* Category jumps — scroll-to-section tabs */}
            {/* Shows ALL categories from the backend (not just this page's) */}
            {!loading && allCategories.length > 0 && (
              <div style={{
                padding: '8px 18px',
                borderTop: '1px solid var(--line-soft)',
                background: 'var(--bg)',
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}>
                {/* Build unique category list from all_categories (real DB totals) */}
                {(() => {
                  const catMap = {};
                  for (const c of allCategories) {
                    const key = c.category || '__nocat__';
                    if (!catMap[key]) catMap[key] = { name: c.category || '', label: c.category || 'Uncategorized', count: c.count || 0 };
                  }
                  const sortedKeys = Object.keys(catMap).sort((a, b) => {
                    if (a === '__nocat__') return 1;
                    if (b === '__nocat__') return -1;
                    return a.localeCompare(b, undefined, { numeric: true });
                  });
                  const sectionId = (key) => `cat-section-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
                  return sortedKeys.map(catKey => {
                    const info = catMap[catKey];
                    const isNoCat = catKey === '__nocat__';
                    return (
                      <button
                        key={catKey}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(catKey);
                          setSelected(new Set());
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '3px 10px',
                          borderRadius: 5,
                          border: `1px solid ${
                            categoryFilter === catKey
                              ? isNoCat ? 'var(--ink-4)' : '#2563eb'
                              : isNoCat ? 'var(--line-soft)' : 'rgba(59,130,246,0.3)'
                          }`,
                          background: categoryFilter === catKey
                            ? (isNoCat ? 'var(--bg-soft)' : '#2563eb')
                            : (isNoCat ? 'var(--bg-soft)' : 'transparent'),
                          color: categoryFilter === catKey
                            ? (isNoCat ? 'var(--ink-4)' : '#fff')
                            : (isNoCat ? 'var(--ink-4)' : '#3b82f6'),
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => {
                          if (categoryFilter !== catKey)
                            e.currentTarget.style.background = 'rgba(59,130,246,0.12)';
                        }}
                        onMouseLeave={e => {
                          if (categoryFilter !== catKey)
                            e.currentTarget.style.background = isNoCat ? 'var(--bg-soft)' : 'transparent';
                        }}
                      >
                        📄 {info.label}
                        <span style={{ marginLeft: 4, opacity: 0.6, fontFamily: 'var(--mono)' }}>{info.count}</span>
                      </button>
                    );
                  });
                })()}
              </div>
            )}

            <div className="footer" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                {catKeys.length} categor{catKeys.length !== 1 ? 'ies' : 'y'} · {total} numbers · {used} used
                {selected.size > 0 && <span style={{ marginLeft: 8, color: 'var(--info)' }}>· {selected.size} selected</span>}
              </span>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    disabled={page === 0}
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                  >
                    ‹ Prev
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                    const pNum = start + i;
                    if (pNum >= totalPages) return null;
                    return (
                      <button
                        key={pNum}
                        type="button"
                        onClick={() => setPage(pNum)}
                        style={{
                          width: 24, height: 24, borderRadius: 4,
                          border: `1px solid ${page === pNum ? 'var(--ink-1)' : 'var(--line)'}`,
                          background: page === pNum ? 'var(--ink-1)' : 'var(--bg-card)',
                          color: page === pNum ? '#fff' : 'var(--ink-2)',
                          fontSize: 10, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'var(--mono)',
                        }}
                      >
                        {pNum + 1}
                      </button>
                    );
                  })}
                  <button
                    className="btn-ghost"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </div>
    </AgentShell>
  );
}
