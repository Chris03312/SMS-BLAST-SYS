import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import AdminShell from '../../components/AdminShell.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { PageCache } from '../../lib/page-cache.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateShort } from '../../lib/format.js';
import Skeleton, { SkeletonTable } from '../../components/Skeleton.jsx';

export default function AdminContacts() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [parsedAgents, setParsedAgents] = useState([]);
  const [viewBatch, setViewBatch] = useState(null);     // batchId being viewed
  const [batchContacts, setBatchContacts] = useState([]);
  const [batchByAgent, setBatchByAgent] = useState({});
  const [batchAllCategories, setBatchAllCategories] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchPage, setBatchPage] = useState(0);
  const [batchTotalPages, setBatchTotalPages] = useState(1);
  const [perPage, setPerPage] = useState(200);
  const perPageOptions = [50, 100, 200, 500, 1000];
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(null);
  const [deletingContact, setDeletingContact] = useState(null);
  
  // ── Inline / bulk editing ──
  const [allAgents, setAllAgents] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [editingField, setEditingField] = useState(null); // { id, field: 'category'|'agent'|'dpd' }
  const [editingValue, setEditingValue] = useState('');
  const [bulkAction, setBulkAction] = useState(null); // 'category'|'agent'|'dpd'
  const [bulkValue, setBulkValue] = useState('');
  const [renamingCategory, setRenamingCategory] = useState(null); // { batchId, oldName }
  const [renameInput, setRenameInput] = useState('');
  const [updatingIds, setUpdatingIds] = useState(new Set()); // IDs currently being saved

  const fileInputRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => { loadBatches(); }, []);

  async function loadBatches() {
    setLoading(true);
    try {
      const data = await api.get('/admin/contacts/batches');
      setBatches(data.batches || []);
    } catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const sheetNames = wb.SheetNames;

      if (sheetNames.length === 0) {
        toast('The Excel file has no sheets.', 'warning');
        return;
      }

      const allAgents = [];
      let totalNumbers = 0;

      for (const sheetName of sheetNames) {
        const category = sheetName.trim();
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (!rows || rows.length < 2) {
          // Skip empty sheets — still show in preview?
          continue;
        }

        // Row 0 = DPD group headers (e.g. "DPD 1", "DPD 2", ...)
        // Row 1 = Agent names (e.g. "Christian Catalan", "Maria Santos", ...)
        // Row 2+ = Phone numbers
        const dpdRow = rows[0];
        const nameRow = rows[1];

        if (!nameRow || nameRow.filter(Boolean).length === 0) {
          toast(`Sheet "${sheetName}" is missing agent names in row 2.`, 'warning');
          continue;
        }

        const agentNames = nameRow.map(cell => cell ? String(cell).trim() : '');
        const dpdGroups = dpdRow.map(cell => cell ? String(cell).trim() : '');
        const validCols = agentNames.filter(Boolean).length;

        if (validCols === 0) continue;

        // Build agent data for this sheet — carry forward DPD across merged cells
        let currentDpd = '';
        const sheetAgents = agentNames.map((name, i) => {
          if (dpdGroups[i]) currentDpd = dpdGroups[i];
          if (!name) return null;
          return { name, numbers: [], dpd_group: currentDpd, category };
        }).filter(Boolean);

        const maxCols = Math.max(agentNames.length, ...rows.slice(2).map(r => Array.isArray(r) ? r.length : 0));
        for (let r = 2; r < rows.length; r++) {
          const row = rows[r];
          if (!Array.isArray(row)) continue;
          for (let c = 0; c < maxCols; c++) {
            const cell = row[c];
            if (!agentNames[c]) continue;
            if (cell === undefined || cell === null) continue;
            const str = String(cell).trim();
            // Skip Excel error values like #N/A, #REF!, #VALUE!, etc.
            if (str.startsWith('#') || str.toLowerCase().includes('#n/a')) continue;
            // Strip semicolons and formatting chars for validation only
            const cleaned = str.replace(/[\s\-().;]/g, '');
            if (cleaned.length >= 7 && /^\+?\d{7,15}$/.test(cleaned)) {
              // Find which agent this column belongs to
              const agentIdx = agentNames.slice(0, c + 1).filter(Boolean).length - 1;
              if (sheetAgents[agentIdx]) {
                // Store the original string (with semicolons) as-is
                sheetAgents[agentIdx].numbers.push(str);
                totalNumbers++;
              }
            }
          }
        }

        allAgents.push(...sheetAgents);
      }

      if (allAgents.length === 0 || totalNumbers === 0) {
        toast('No phone numbers found in the file.', 'warning');
        return;
      }

      setParsedAgents(allAgents);
      setPreview({
        fileName: file.name,
        sheets: sheetNames.map(s => s.trim()),
        agents: allAgents.map(a => ({ name: a.name, count: a.numbers.length, dpd_group: a.dpd_group, category: a.category })),
        total: totalNumbers,
      });
    } catch (err) {
      toast(`Failed to parse file: ${err.message}`, 'error');
    }

    e.target.value = '';
  }

  async function handleUpload() {
    if (!preview || parsedAgents.length === 0) return;
    setUploading(true);
    try {
      // Build payload with DPD group info
      const payload = {
        agents: parsedAgents.map(a => ({
          name: a.name,
          numbers: a.numbers,
          dpd_group: a.dpd_group || '',
          category: a.category || '',
        })),
        fileName: preview.fileName,
      };
      const result = await api.post('/admin/contacts/upload', payload);
      const skippedParts = [];
      let unmatchedCount = 0;
      if (result.unmatched && result.unmatched.length > 0) {
        unmatchedCount = result.unmatched.reduce((s, u) => s + (u.count || 0), 0);
        const names = result.unmatched.map(u => `"${u.name}"`).join(', ');
        skippedParts.push(`${unmatchedCount} from unknown agents (${names})`);
      }
      if ((result.skipped || 0) > 0) {
        skippedParts.push(`${result.skipped} duplicates`);
      }
      let msg = `Uploaded ${result.total} numbers to ${result.agents} agents`;
      const totalSkipped = unmatchedCount + (result.skipped || 0);
      if (totalSkipped > 0) {
        const fromPreview = (preview?.total || 0);
        msg += `. ${totalSkipped} skipped from ${fromPreview} found (${skippedParts.join(', ')})`;
      }
      if (result.unmatched?.length > 0) {
        msg += `. System agents: ${(result.system_agents || []).join(', ')}`;
      }
      toast(msg, totalSkipped > 0 ? 'warning' : 'success');
      setPreview(null);
      setParsedAgents([]);
      loadBatches();
    } catch (e) {
      toast(e.message, 'error');
    }
    setUploading(false);
  }

  function downloadSample() {
    // Multi-sheet sample: each sheet name = category
    const wb = XLSX.utils.book_new();

    const sheets = [
      {
        name: 'PRIORITY',
        data: [
          ['DPD 1', 'DPD 1', 'DPD 2'],
          ['Christian Catalan', 'Maria Santos', 'Jose Rizal'],
          ['09171234567', '09179876543', '09195551234'],
          ['09177654321', '09193332211', '09194447777'],
        ],
      },
      {
        name: 'INSUFFICIENT',
        data: [
          ['DPD 1', 'DPD 2'],
          ['Ana Lopez', 'Pedro Gomez'],
          ['09172223333', '09174445555'],
          ['09178889999', '09176667777'],
        ],
      },
    ];

    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.data);
      ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }

    XLSX.writeFile(wb, 'contact_template.xlsx');
  }

  // ── Batch view ──────────────────────────────────────────────────────

  const batchViewRef = useRef(null);

  async function openBatchView(batchId, searchVal, pageNum, perPageOverride) {
    const isNewBatch = batchId !== viewBatch;
    const pp = perPageOverride ?? perPage;
    setViewBatch(batchId);
    setViewLoading(true);
    // Only clear contacts when opening a different batch (not on page change)
    if (isNewBatch) {
      setBatchContacts([]);
      setBatchByAgent({});
      setSelectedContactIds(new Set());
    }
    loadAgents();
    const p = pageNum ?? 0;
    setBatchPage(p);
    try {
      const qs = searchVal
        ? `?search=${encodeURIComponent(searchVal)}&page=${p}&perPage=${pp}`
        : `?page=${p}&perPage=${pp}`;
      const data = await api.get(`/admin/contacts/batch/${batchId}${qs}`);
      setBatchContacts(data.contacts || []);
      setBatchByAgent(data.by_agent || {});
      setBatchAllCategories(data.all_categories || []);
      setBatchTotalPages(data.totalPages || 1);
    } catch (e) {
      toast(e.message, 'error');
    }
    setViewLoading(false);
    // When opening a new batch, scroll it into view
    if (isNewBatch) {
      requestAnimationFrame(() => {
        if (batchViewRef.current) {
          batchViewRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    }
  }

  async function loadAgents() {
    try {
      const data = await api.get('/admin/contacts/agents');
      setAllAgents(data.agents || []);
    } catch (e) { /* non-critical */ }
  }

  // ── Inline editing ──

  function startEdit(contactId, field, currentValue) {
    setEditingField({ id: contactId, field });
    setEditingValue(currentValue || '');
  }

  function cancelEdit() {
    setEditingField(null);
    setEditingValue('');
  }

  async function saveEdit() {
    if (!editingField) return;
    const { id, field } = editingField;
    const payload = {};
    if (field === 'category') payload.category = editingValue;
    else if (field === 'agent') payload.agent_id = editingValue;
    else if (field === 'dpd') payload.dpd_group = editingValue;
    else if (field === 'phone') payload.phone_number = editingValue;
    else return;

    setUpdatingIds(prev => new Set(prev).add(id));
    try {
      await api.put(`/admin/contacts/${id}`, payload);
      toast('Contact updated', 'success');
      cancelEdit();
      // Refresh batch view
      if (viewBatch) {
        const data = await api.get(`/admin/contacts/batch/${viewBatch}`);
        setBatchContacts(data.contacts || []);
        setBatchByAgent(data.by_agent || {});
        loadBatches();
      }
    } catch (e) {
      toast(e.message, 'error');
    }
    setUpdatingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // ── Bulk actions ──

  function toggleSelectContact(id) {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllContacts() {
    if (selectedContactIds.size === batchContacts.length) {
      setSelectedContactIds(new Set());
    } else {
      setSelectedContactIds(new Set(batchContacts.map(c => c.id)));
    }
  }

  function startBulkAction(action) {
    setBulkAction(action);
    setBulkValue('');
  }

  function cancelBulkAction() {
    setBulkAction(null);
    setBulkValue('');
  }

  async function executeBulkAction() {
    if (!bulkAction || selectedContactIds.size === 0 || !bulkValue) return;
    const ids = [...selectedContactIds];
    const payload = { ids };
    if (bulkAction === 'category') payload.category = bulkValue;
    else if (bulkAction === 'agent') payload.agent_id = bulkValue;
    else if (bulkAction === 'dpd') payload.dpd_group = bulkValue;

    try {
      await api.put('/admin/contacts/bulk-update', payload);
      toast(`Updated ${ids.length} contacts`, 'success');
      cancelBulkAction();
      setSelectedContactIds(new Set());
      if (viewBatch) {
        const data = await api.get(`/admin/contacts/batch/${viewBatch}`);
        setBatchContacts(data.contacts || []);
        setBatchByAgent(data.by_agent || {});
        loadBatches();
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Category rename ──

  function startRenameCategory(batchId, oldName) {
    setRenamingCategory({ batchId, oldName });
    setRenameInput(oldName);
  }

  function cancelRenameCategory() {
    setRenamingCategory(null);
    setRenameInput('');
  }

  async function executeRenameCategory() {
    if (!renamingCategory || !renameInput.trim()) return;
    try {
      await api.put('/admin/contacts/rename-category', {
        batch_id: renamingCategory.batchId,
        old_name: renamingCategory.oldName,
        new_name: renameInput.trim(),
      });
      toast(`Renamed category to "${renameInput.trim()}"`, 'success');
      cancelRenameCategory();
      if (viewBatch) {
        const data = await api.get(`/admin/contacts/batch/${viewBatch}`);
        setBatchContacts(data.contacts || []);
        setBatchByAgent(data.by_agent || {});
        loadBatches();
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function handleDeleteContact(contactId) {
    try {
      await api.del(`/admin/contacts/${contactId}`);
      toast('Contact deleted', 'success');
      // Refresh batch view and parent list
      const data = await api.get(`/admin/contacts/batch/${viewBatch}`);
      setBatchContacts(data.contacts || []);
      setBatchByAgent(data.by_agent || {});
      loadBatches();
    } catch (e) {
      toast(e.message, 'error');
    }
    setDeletingContact(null);
  }

  async function handleDeleteBatch(batch) {
    try {
      const result = await api.del(`/admin/contacts/batch/${batch.batch_id}`);
      toast(`Deleted batch — ${result.deleted} contacts removed`, 'success');
      setConfirmDeleteBatch(null);
      if (viewBatch === batch.batch_id) setViewBatch(null);
      loadBatches();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">People & Devices</div>
            <h1>Contacts</h1>
            <div className="page-sub">
              Upload recipient numbers and assign them to agents. Each agent will see only their numbers when composing broadcasts.
            </div>
          </div>
        </div>
      </div>

      {/* Upload card */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h3>Upload Contact List</h3></div>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.6 }}>
            Upload a multi-sheet Excel file (.xlsx). Each <strong>sheet name</strong> becomes a <strong>category</strong>.
            <br />Within each sheet: Row 1 = <strong>DPD group</strong>, Row 2 = <strong>Agent name</strong>, Row 3+ = <strong>Phone numbers</strong>.
            <br />Use merged cells to group agents under DPD groups. Numbers below each agent column are assigned to that agent.
            <br />The system ignores empty cells and validates phone numbers. <strong>Agent names must match display names exactly.</strong>
          </div>

          {!preview ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Select Excel File
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={downloadSample}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download Sample Template
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                padding: '12px 16px', background: 'var(--bg-soft)', borderRadius: 8,
                marginBottom: 12, fontSize: 13,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--ink-1)' }}>
                  {preview.fileName} — {preview.total} numbers found
                </div>
                {/* Sheets (categories) */}
                {preview.sheets && preview.sheets.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {preview.sheets.map(sheet => {
                      const sheetCount = preview.agents.filter(a => a.category === sheet).reduce((s, a) => s + a.count, 0);
                      return (
                        <span key={sheet} style={{
                          padding: '3px 10px', borderRadius: 6,
                          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                          fontSize: 10, fontWeight: 600, color: '#3b82f6',
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          📄 {sheet}
                          <span style={{ opacity: 0.6, fontFamily: 'var(--mono)' }}>{sheetCount}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* DPD group badges */}
                {preview.agents.some(a => a.dpd_group) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {[...new Set(preview.agents.filter(a => a.dpd_group).map(a => a.dpd_group))].map(dpd => (
                      <span key={dpd} style={{
                        padding: '3px 10px', borderRadius: 6,
                        background: 'rgba(219,39,119,0.08)', border: '1px solid rgba(219,39,119,0.2)',
                        fontSize: 10, fontWeight: 600, color: '#db2777',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {dpd}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {preview.agents.slice(0, 10).map(a => (
                    <span key={a.name + a.dpd_group} style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: 'var(--ok-bg)', border: '1px solid var(--ok-line)',
                      fontSize: 11, fontWeight: 500, color: 'var(--ok)',
                    }}>
                      {a.category ? `[${a.category}] ` : ''}{a.dpd_group ? `${a.dpd_group} · ` : ''}{a.name}: {a.count}
                    </span>
                  ))}
                  {preview.agents.length > 10 && (
                    <span style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
                      fontSize: 11, fontWeight: 500, color: 'var(--ink-4)',
                    }}>
                      … and {preview.agents.length - 10} more agents
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleUpload}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : `Upload ${preview.total} numbers`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Batch history */}
      <div className="card">
        <div className="card-head">
          <h3>Upload History</h3>
          {!loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{batches.length} batches</span>}
        </div>

        {loading ? (
          <div style={{ padding: '18px' }}><Skeleton variant="card" count={3} /></div>
        ) : batches.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            No uploads yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Uploaded</th>
                <th>Total Numbers</th>
                <th>Agents</th>
                <th>Used</th>
                <th>Per Agent</th>
                <th>Categories</th>
                <th>DPD Groups</th>
                <th style={{ textAlign: 'center', width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <React.Fragment key={b.batch_id}>
                  <tr>
                    <td style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--mono)' }}>
                      {formatDateShort(b.uploaded_at)}
                    </td>
                    <td className="num">{b.total}</td>
                    <td className="num">{b.agent_count}</td>
                    <td className="num" style={{ color: b.used_count > 0 ? 'var(--ok)' : 'var(--ink-3)' }}>
                      {b.used_count} / {b.total}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(b.agents || []).slice(0, 5).map(a => (
                          <span key={a.agent_name} style={{
                            fontSize: 10.5, padding: '1px 7px', borderRadius: 4,
                            background: 'var(--bg-soft)', color: 'var(--ink-2)',
                            fontFamily: 'var(--mono)',
                          }}>
                            {a.agent_name}: {a.count}
                          </span>
                        ))}
                        {(b.agents || []).length > 5 && (
                          <span style={{
                            fontSize: 10.5, padding: '1px 7px', borderRadius: 4,
                            background: 'var(--bg-soft)', color: 'var(--ink-4)',
                            fontFamily: 'var(--mono)',
                          }}>
                            … +{b.agents.length - 5} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(b.categories || []).map(c => (
                          <span key={c} style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 4,
                            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                            color: '#3b82f6', fontFamily: 'var(--mono)',
                          }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(b.dpd_groups || []).map(d => (
                          <span key={d} style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 4,
                            background: 'rgba(219,39,119,0.08)', border: '1px solid rgba(219,39,119,0.2)',
                            color: '#db2777', fontFamily: 'var(--mono)',
                          }}>
                            {d}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        <button
                          className="iconlink"
                          onClick={() => openBatchView(b.batch_id)}
                          title="View contacts"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 16 12 12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                        </button>
                        <button
                          className="iconlink"
                          onClick={() => setConfirmDeleteBatch(b)}
                          title="Delete batch"
                          style={{ color: 'var(--err)' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded batch detail row */}
                  {viewBatch === b.batch_id && (
                    <tr ref={batchViewRef}>
                      <td colSpan={8} style={{ padding: '0 18px', background: 'var(--bg-soft)' }}>
                        <div style={{ padding: '14px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                                Batch Contacts
                              </div>
                              <select
                                value={perPage}
                                onChange={e => {
                                  const newPerPage = Number(e.target.value);
                                  setPerPage(newPerPage);
                                  openBatchView(viewBatch, batchSearch, 0, newPerPage);
                                }}
                                style={{
                                  padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)',
                                  fontSize: 10, fontFamily: 'inherit', color: 'var(--ink-2)',
                                  background: 'var(--bg)', cursor: 'pointer', outline: 'none',
                                }}
                              >
                                {perPageOptions.map(n => (
                                  <option key={n} value={n}>{n} rows</option>
                                ))}
                              </select>
                            </div>
                            <button
                              className="iconlink"
                              onClick={() => setViewBatch(null)}
                              title="Close"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>

                          {/* ── Search inside batch ── */}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                              <svg style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--ink-4)' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                              </svg>
                              <input
                                type="text"
                                placeholder="Search contacts…"
                                value={batchSearch}
                                onChange={e => {
                                  setBatchSearch(e.target.value);
                                  // Debounce: wait for user to finish typing before searching
                                  if (window._batchSearchTimer) clearTimeout(window._batchSearchTimer);
                                  window._batchSearchTimer = setTimeout(() => openBatchView(viewBatch, e.target.value, 0), 300);
                                }}
                                style={{
                                  width: '100%', padding: '5px 8px 5px 28px', borderRadius: 5,
                                  border: '1px solid var(--line)', fontSize: 11, fontFamily: 'var(--mono)',
                                  color: 'var(--ink-1)', background: 'var(--bg)', outline: 'none',
                                }}
                              />
                              {batchSearch && (
                                <button onClick={() => { setBatchSearch(''); openBatchView(viewBatch, '', 0); }}
                                  style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 12, padding: '2px 4px' }}>×</button>
                              )}
                            </div>
                          </div>

                          {viewLoading ? (
                            <table style={{ width: '100%' }}><SkeletonTable cols={7} rows={4} /></table>
                          ) : batchContacts.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>{batchSearch ? 'No contacts match your search.' : 'No contacts.'}</div>
                          ) : (
                            <>
                              {/* ── Bulk action toolbar ── */}
                              {selectedContactIds.size > 0 && (
                                <div style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '6px 10px', marginBottom: 8,
                                  background: 'rgba(59,130,246,0.06)',
                                  border: '1px solid rgba(59,130,246,0.15)',
                                  borderRadius: 6,
                                  fontSize: 11,
                                }}>
                                  <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>
                                    {selectedContactIds.size} selected
                                  </span>

                                  {/* Bulk actions */}
                                  {!bulkAction ? (
                                    <>
                                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                                        onClick={() => startBulkAction('category')}>
                                        Change Category
                                      </button>
                                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                                        onClick={() => startBulkAction('agent')}>
                                        Change Agent
                                      </button>
                                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                                        onClick={() => startBulkAction('dpd')}>
                                        Change DPD
                                      </button>
                                      <div style={{ flex: 1 }} />
                                      <button className="iconlink" style={{ color: 'var(--ink-4)' }}
                                        onClick={() => setSelectedContactIds(new Set())}>
                                        Clear selection
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span style={{ color: 'var(--ink-3)' }}>
                                        {bulkAction === 'category' ? 'New category:' :
                                         bulkAction === 'agent' ? 'Assign to agent:' :
                                         'New DPD group:'}
                                      </span>
                                      {bulkAction === 'agent' ? (
                                        <select
                                          value={bulkValue}
                                          onChange={e => setBulkValue(e.target.value)}
                                          style={{
                                            padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)',
                                            fontSize: 11, fontFamily: 'inherit',
                                          }}
                                        >
                                          <option value="">Select agent...</option>
                                          {allAgents.map(a => (
                                            <option key={a.id} value={a.id}>{a.display_name}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          type="text"
                                          value={bulkValue}
                                          onChange={e => setBulkValue(e.target.value)}
                                          placeholder="Enter name..."
                                          style={{
                                            padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)',
                                            fontSize: 11, fontFamily: 'inherit', width: 120,
                                          }}
                                          onKeyDown={e => { if (e.key === 'Enter') executeBulkAction(); if (e.key === 'Escape') cancelBulkAction(); }}
                                        />
                                      )}
                                      <button className="btn-primary" style={{ fontSize: 10, padding: '2px 10px' }}
                                        disabled={!bulkValue}
                                        onClick={executeBulkAction}>
                                        Apply
                                      </button>
                                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                                        onClick={cancelBulkAction}>
                                        Cancel
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}

                              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-soft)', zIndex: 1 }}>
                                    <tr style={{ borderBottom: '1px solid var(--line-soft)' }}>
                                      <th style={{ textAlign: 'center', padding: '6px 6px', fontWeight: 600, color: 'var(--ink-3)', width: 28 }}>
                                        <input
                                          type="checkbox"
                                          checked={batchContacts.length > 0 && selectedContactIds.size === batchContacts.length}
                                          onChange={toggleSelectAllContacts}
                                          style={{ accentColor: 'var(--ink-1)', cursor: 'pointer', width: 12, height: 12 }}
                                        />
                                      </th>
                                      <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Agent</th>
                                      <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Phone Number</th>
                                      <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 80 }}>Category</th>
                                      <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 60 }}>DPD</th>
                                      <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 60 }}>Status</th>
                                      <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 36 }}></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batchContacts.map(c => {
                                      const isEditing = editingField?.id === c.id;
                                      const isUpdating = updatingIds.has(c.id);
                                      return (
                                        <tr key={c.id} style={{
                                          borderBottom: '1px solid var(--line-soft)',
                                          opacity: isUpdating ? 0.5 : 1,
                                          transition: 'opacity 0.15s',
                                          background: selectedContactIds.has(c.id) ? 'rgba(59,130,246,0.04)' : 'transparent',
                                        }}>
                                          {/* Checkbox */}
                                          <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                                            <input
                                              type="checkbox"
                                              checked={selectedContactIds.has(c.id)}
                                              onChange={() => toggleSelectContact(c.id)}
                                              style={{ accentColor: 'var(--ink-1)', cursor: 'pointer', width: 12, height: 12 }}
                                            />
                                          </td>

                                          {/* Agent — clickable to edit */}
                                          <td style={{ padding: '5px 10px', color: 'var(--ink-1)', fontWeight: 500 }}>
                                            {isEditing && editingField.field === 'agent' ? (
                                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <select
                                                  value={editingValue}
                                                  onChange={e => setEditingValue(e.target.value)}
                                                  autoFocus
                                                  style={{
                                                    padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line)',
                                                    fontSize: 11, fontFamily: 'inherit', maxWidth: 140,
                                                  }}
                                                  onBlur={() => setTimeout(saveEdit, 150)}
                                                  onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                                                >
                                                  <option value="">Select agent...</option>
                                                  {allAgents.map(a => (
                                                    <option key={a.id} value={a.id}>{a.display_name}</option>
                                                  ))}
                                                </select>
                                                <button className="iconlink" onClick={saveEdit} title="Save">✓</button>
                                                <button className="iconlink" onClick={cancelEdit} style={{ color: 'var(--err)' }} title="Cancel">✕</button>
                                              </div>
                                            ) : (
                                              <span
                                                onClick={() => !c.used && startEdit(c.id, 'agent', '')}
                                                style={{
                                                  cursor: c.used ? 'default' : 'pointer',
                                                  borderBottom: c.used ? 'none' : '1px dashed var(--ink-4)',
                                                  paddingBottom: 1,
                                                  transition: 'border-color 0.12s',
                                                }}
                                                title={c.used ? 'Cannot edit — already used' : 'Click to reassign'}
                                              >
                                                {c.agent_name}
                                                {!c.used && <span style={{ fontSize: 9, color: 'var(--ink-4)', marginLeft: 4 }}>✎</span>}
                                              </span>
                                            )}
                                          </td>

                                          <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}>
                                            {isEditing && editingField.field === 'phone' ? (
                                              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                <input
                                                  type="text"
                                                  value={editingValue}
                                                  onChange={e => setEditingValue(e.target.value)}
                                                  autoFocus
                                                  style={{
                                                    padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line)',
                                                    fontSize: 11, fontFamily: 'var(--mono)', width: 140,
                                                  }}
                                                  onBlur={() => setTimeout(saveEdit, 150)}
                                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                                />
                                                <button className="iconlink" onClick={saveEdit} title="Save">✓</button>
                                              </div>
                                            ) : (
                                              <span
                                                onClick={() => startEdit(c.id, 'phone', c.phone_number)}
                                                style={{
                                                  cursor: 'pointer',
                                                  borderBottom: '1px dashed var(--line-soft)',
                                                  paddingBottom: 1,
                                                  transition: 'border-color 0.12s',
                                                  fontFamily: 'var(--mono)',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-1)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line-soft)'; }}
                                                title="Click to edit"
                                              >
                                                {c.phone_number}
                                                <span style={{ fontSize: 9, color: 'var(--ink-4)', marginLeft: 4 }}>✎</span>
                                              </span>
                                            )}
                                          </td>

                                          {/* Category — clickable to edit */}
                                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                            {isEditing && editingField.field === 'category' ? (
                                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                                                <input
                                                  type="text"
                                                  value={editingValue}
                                                  onChange={e => setEditingValue(e.target.value)}
                                                  autoFocus
                                                  style={{
                                                    padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line)',
                                                    fontSize: 10, fontFamily: 'inherit', width: 80,
                                                  }}
                                                  onBlur={() => setTimeout(saveEdit, 150)}
                                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                                />
                                                <button className="iconlink" onClick={saveEdit} title="Save">✓</button>
                                              </div>
                                            ) : (
                                              <span
                                                onClick={() => !c.used && startEdit(c.id, 'category', c.category || '')}
                                                style={{
                                                  cursor: c.used ? 'default' : 'pointer',
                                                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                  color: c.category ? '#3b82f6' : 'var(--ink-4)',
                                                  background: c.category ? 'rgba(59,130,246,0.08)' : 'transparent',
                                                  border: c.used ? 'none' : '1px dashed transparent',
                                                  transition: 'all 0.12s',
                                                  display: 'inline-block',
                                                }}
                                                onMouseEnter={e => { if (!c.used) e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)'; }}
                                                onMouseLeave={e => { if (!c.used) e.currentTarget.style.borderColor = 'transparent'; }}
                                                title={c.used ? 'Cannot edit — already used' : 'Click to edit'}
                                              >
                                                {c.category || '—'}
                                                {!c.used && <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.5 }}>✎</span>}
                                              </span>
                                            )}
                                          </td>

                                          {/* DPD — clickable to edit */}
                                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                            {isEditing && editingField.field === 'dpd' ? (
                                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                                                <input
                                                  type="text"
                                                  value={editingValue}
                                                  onChange={e => setEditingValue(e.target.value)}
                                                  autoFocus
                                                  style={{
                                                    padding: '2px 4px', borderRadius: 4, border: '1px solid var(--line)',
                                                    fontSize: 10, fontFamily: 'inherit', width: 70,
                                                  }}
                                                  onBlur={() => setTimeout(saveEdit, 150)}
                                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                                />
                                                <button className="iconlink" onClick={saveEdit} title="Save">✓</button>
                                              </div>
                                            ) : (
                                              <span
                                                onClick={() => !c.used && startEdit(c.id, 'dpd', c.dpd_group || '')}
                                                style={{
                                                  cursor: c.used ? 'default' : 'pointer',
                                                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                  color: c.dpd_group ? '#db2777' : 'var(--ink-4)',
                                                  background: c.dpd_group ? 'rgba(219,39,119,0.08)' : 'transparent',
                                                  border: c.used ? 'none' : '1px dashed transparent',
                                                  transition: 'all 0.12s',
                                                  display: 'inline-block',
                                                }}
                                                onMouseEnter={e => { if (!c.used) e.currentTarget.style.borderColor = 'rgba(219,39,119,0.3)'; }}
                                                onMouseLeave={e => { if (!c.used) e.currentTarget.style.borderColor = 'transparent'; }}
                                                title={c.used ? 'Cannot edit — already used' : 'Click to edit'}
                                              >
                                                {c.dpd_group || '—'}
                                                {!c.used && <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.5 }}>✎</span>}
                                              </span>
                                            )}
                                          </td>

                                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                            <span style={{
                                              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                              color: c.used ? 'var(--ok)' : 'var(--ink-4)',
                                              background: c.used ? 'var(--ok-bg)' : 'var(--bg)',
                                            }}>
                                              {c.used ? 'Used' : 'Open'}
                                            </span>
                                          </td>

                                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                            <button
                                              className="iconlink"
                                              onClick={() => setDeletingContact(c)}
                                              title="Remove contact"
                                              style={{ color: 'var(--err)', fontSize: 13 }}
                                            >
                                              ✕
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                            </>
                          )}

                          {/* Per-agent tally */}
                          {Object.keys(batchByAgent).length > 0 && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                              {Object.entries(batchByAgent).map(([name, stats]) => (
                                <span key={name} style={{
                                  fontSize: 10.5, padding: '2px 8px', borderRadius: 4,
                                  background: stats.used === stats.total ? 'var(--ok-bg)' : 'var(--bg)',
                                  color: 'var(--ink-2)', fontFamily: 'var(--mono)',
                                }}>
                                  {stats.dpd_group ? `${stats.dpd_group} · ` : ''}{name}: {stats.used}/{stats.total} used
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Category rename buttons — shows ALL batch categories (not just this page) */}
                          {(() => {
                            const categories = batchAllCategories;
                            if (categories.length === 0) return null;
                            return (
                              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={{ fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 600 }}>Categories:</span>
                                {categories.map(cat =>
                                  renamingCategory?.oldName === cat && renamingCategory?.batchId === viewBatch ? (
                                    <div key={cat} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                      <input
                                        type="text"
                                        value={renameInput}
                                        onChange={e => setRenameInput(e.target.value)}
                                        autoFocus
                                        style={{
                                          padding: '2px 6px', borderRadius: 4, border: '1px solid var(--line)',
                                          fontSize: 11, fontFamily: 'inherit', width: 120,
                                        }}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') executeRenameCategory();
                                          if (e.key === 'Escape') cancelRenameCategory();
                                        }}
                                      />
                                      <button className="btn-primary" style={{ fontSize: 9, padding: '1px 8px' }}
                                        disabled={!renameInput.trim() || renameInput.trim() === cat}
                                        onClick={executeRenameCategory}>
                                        Save
                                      </button>
                                      <button className="btn-ghost" style={{ fontSize: 9, padding: '1px 8px' }}
                                        onClick={cancelRenameCategory}>
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <span key={cat} style={{
                                      padding: '2px 8px', borderRadius: 4,
                                      background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                                      fontSize: 10, fontWeight: 600, color: '#3b82f6',
                                      display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                      📄 {cat}
                                      <button
                                        className="iconlink"
                                        onClick={() => startRenameCategory(viewBatch, cat)}
                                        title="Rename category"
                                        style={{ fontSize: 10, color: 'var(--ink-4)' }}
                                      >
                                        ✎
                                      </button>
                                    </span>
                                  )
                                )}
                              </div>
                            );
                          })()}

                          {/* Pagination footer */}
                          {!viewLoading && batchTotalPages > 1 && (
                            <div style={{
                              marginTop: 12, padding: '8px 14px',
                              borderTop: '1px solid var(--line-soft)',
                              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
                            }}>
                              <span style={{ fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginRight: 8 }}>
                                Page {batchPage + 1} / {batchTotalPages}
                              </span>
                              <button
                                className="btn-ghost"
                                style={{ padding: '2px 8px', fontSize: 11 }}
                                disabled={batchPage === 0}
                                onClick={() => openBatchView(viewBatch, batchSearch, batchPage - 1)}
                              >
                                ‹ Prev
                              </button>
                              {Array.from({ length: Math.min(batchTotalPages, 5) }, (_, i) => {
                                const start = Math.max(0, Math.min(batchPage - 2, batchTotalPages - 5));
                                const pNum = start + i;
                                if (pNum >= batchTotalPages) return null;
                                return (
                                  <button
                                    key={pNum}
                                    type="button"
                                    onClick={() => openBatchView(viewBatch, batchSearch, pNum)}
                                    style={{
                                      width: 24, height: 24, borderRadius: 4,
                                      border: `1px solid ${batchPage === pNum ? 'var(--ink-1)' : 'var(--line)'}`,
                                      background: batchPage === pNum ? 'var(--ink-1)' : '#fff',
                                      color: batchPage === pNum ? '#fff' : 'var(--ink-2)',
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
                                disabled={batchPage >= batchTotalPages - 1}
                                onClick={() => openBatchView(viewBatch, batchSearch, batchPage + 1)}
                              >
                                Next ›
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm delete batch */}
      {confirmDeleteBatch && (
        <ConfirmModal
          title="Delete Batch"
          message={`Delete this batch of ${confirmDeleteBatch.total} contacts? This cannot be undone.`}
          confirmLabel="Delete Batch"
          onConfirm={() => handleDeleteBatch(confirmDeleteBatch)}
          onCancel={() => setConfirmDeleteBatch(null)}
        />
      )}

      {/* Confirm delete single contact */}
      {deletingContact && (
        <ConfirmModal
          title="Remove Contact"
          message={`Remove ${deletingContact.phone_number} from ${deletingContact.agent_name}'s list?`}
          confirmLabel="Remove"
          onConfirm={() => handleDeleteContact(deletingContact.id)}
          onCancel={() => setDeletingContact(null)}
        />
      )}
    </AdminShell>
  );
}
