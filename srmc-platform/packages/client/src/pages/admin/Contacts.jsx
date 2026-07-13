import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import AdminShell from '../../components/AdminShell.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDateShort } from '../../lib/format.js';

export default function AdminContacts() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [parsedAgents, setParsedAgents] = useState([]);
  const [viewBatch, setViewBatch] = useState(null);     // batchId being viewed
  const [batchContacts, setBatchContacts] = useState([]);
  const [batchByAgent, setBatchByAgent] = useState({});
  const [viewLoading, setViewLoading] = useState(false);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(null);
  const [deletingContact, setDeletingContact] = useState(null);
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
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

      if (!rows || rows.length < 3) {
        toast('File must have category, DPD, and agent name header rows, plus at least one data row.', 'warning');
        return;
      }

      // Row 0 = Category headers (e.g. "PRIORITY", "INSUFFICIENT", ...)
      // Row 1 = DPD group headers (e.g. "DPD 1", "DPD 2", ...)
      // Row 2 = Agent names (e.g. "Christian Catalan", "Maria Santos", ...)
      // Row 3+ = Phone numbers
      const categoryRow = rows[0];
      const dpdRow = rows[1];
      const nameRow = rows[2];
      if (!nameRow || nameRow.filter(Boolean).length === 0) {
        toast('Row 3 must contain agent display names.', 'warning');
        return;
      }

      const agentNames = nameRow.map(cell => cell ? String(cell).trim() : '');
      const dpdGroups = dpdRow.map(cell => cell ? String(cell).trim() : '');
      const categoryLabels = categoryRow.map(cell => cell ? String(cell).trim() : '');
      const validCols = agentNames.filter(Boolean).length;

      if (validCols === 0) {
        toast('No agent names found in row 3.', 'warning');
        return;
      }

      // Build agent data with categories and DPD groups — carry forward labels across merged cells
      let currentCategory = '';
      let currentDpd = '';
      const agentsData = agentNames.map((name, i) => {
        if (categoryLabels[i]) currentCategory = categoryLabels[i];
        if (dpdGroups[i]) currentDpd = dpdGroups[i];
        if (!name) return null;
        return { name, numbers: [], dpd_group: currentDpd, category: currentCategory };
      }).filter(Boolean);

      let total = 0;
      const maxCols = Math.max(agentNames.length, ...rows.slice(3).map(r => Array.isArray(r) ? r.length : 0));
      for (let r = 3; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        let agentIdx = 0;
        for (let c = 0; c < maxCols; c++) {
          const cell = row[c];
          if (!agentNames[c]) continue;
          if (cell === undefined || cell === null) continue;
          const str = String(cell).trim();
          const cleaned = str.replace(/[\s\-().]/g, '');
          if (cleaned.length >= 7 && /^\+?\d{7,15}$/.test(cleaned)) {
            agentsData[agentIdx].numbers.push(str);
            total++;
          }
          agentIdx++;
        }
      }

      if (total === 0) {
        toast('No phone numbers found in the file.', 'warning');
        return;
      }

      setParsedAgents(agentsData);
      setPreview({
        fileName: file.name,
        agents: agentsData.map(a => ({ name: a.name, count: a.numbers.length, dpd_group: a.dpd_group, category: a.category })),
        total,
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
      toast(`Uploaded ${result.total} numbers to ${result.agents} agents`, 'success');
      setPreview(null);
      setParsedAgents([]);
      loadBatches();
    } catch (e) {
      toast(e.message, 'error');
    }
    setUploading(false);
  }

  function downloadSample() {
    // Merged-cell style: Category row above DPD row above agent names row
    const sampleData = [
      ['PRIORITY', 'PRIORITY', 'PRIORITY', 'INSUFFICIENT', 'INSUFFICIENT'],
      ['DPD 1', 'DPD 1', 'DPD 2', 'DPD 1', 'DPD 2'],
      ['Christian Catalan', 'Maria Santos', 'Jose Rizal', 'Ana Lopez', 'Pedro Gomez'],
      ['09171234567', '09179876543', '09195551234', '09172223333', '09174445555'],
      ['09177654321', '09193332211', '09194447777', '09178889999', '09176667777'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];

    // Merge category and DPD header cells to show visual groupings
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, // PRIORITY spans cols A-C
      { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } }, // INSUFFICIENT spans cols D-E
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }, // DPD 1 under PRIORITY spans cols A-B
      { s: { r: 1, c: 2 }, e: { r: 1, c: 2 } }, // DPD 2 under PRIORITY single col C
      { s: { r: 1, c: 3 }, e: { r: 1, c: 3 } }, // DPD 1 under INSUFFICIENT single col D
      { s: { r: 1, c: 4 }, e: { r: 1, c: 4 } }, // DPD 2 under INSUFFICIENT single col E
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'contact_template.xlsx');
  }

  // ── Batch view ──────────────────────────────────────────────────────

  async function openBatchView(batchId) {
    setViewBatch(batchId);
    setViewLoading(true);
    setBatchContacts([]);
    setBatchByAgent({});
    try {
      const data = await api.get(`/admin/contacts/batch/${batchId}`);
      setBatchContacts(data.contacts || []);
      setBatchByAgent(data.by_agent || {});
    } catch (e) {
      toast(e.message, 'error');
    }
    setViewLoading(false);
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
            Upload an Excel file (.xlsx) with 3 header rows: <strong>Category</strong> (row 1), <strong>DPD</strong> (row 2), <strong>Agent name</strong> (row 3).
            <br />Use merged cells to group agents. Numbers below each agent column are assigned to that agent.
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
                {/* Category badges */}
                {preview.agents.some(a => a.category) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                    {[...new Set(preview.agents.filter(a => a.category).map(a => a.category))].map(cat => (
                      <span key={cat} style={{
                        padding: '3px 10px', borderRadius: 6,
                        background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                        fontSize: 10, fontWeight: 600, color: '#3b82f6',
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>
                        {cat}
                      </span>
                    ))}
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
                  {preview.agents.map(a => (
                    <span key={a.name + a.dpd_group} style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: 'var(--ok-bg)', border: '1px solid var(--ok-line)',
                      fontSize: 11, fontWeight: 500, color: 'var(--ok)',
                    }}>
                      {a.category ? `[${a.category}] ` : ''}{a.dpd_group ? `${a.dpd_group} · ` : ''}{a.name}: {a.count}
                    </span>
                  ))}
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
          <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading...</div>
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
                        {(b.agents || []).map(a => (
                          <span key={a.agent_name} style={{
                            fontSize: 10.5, padding: '1px 7px', borderRadius: 4,
                            background: 'var(--bg-soft)', color: 'var(--ink-2)',
                            fontFamily: 'var(--mono)',
                          }}>
                            {a.agent_name}: {a.count}
                          </span>
                        ))}
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
                    <tr>
                      <td colSpan={8} style={{ padding: '0 18px', background: 'var(--bg-soft)' }}>
                        <div style={{ padding: '14px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>
                              Batch Contacts
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

                          {viewLoading ? (
                            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>Loading...</div>
                          ) : batchContacts.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>No contacts.</div>
                          ) : (
                            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-soft)', zIndex: 1 }}>
                                  <tr style={{ borderBottom: '1px solid var(--line-soft)' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Agent</th>
                                    <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)' }}>Phone Number</th>
                                    <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 80 }}>Category</th>
                                    <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 60 }}>DPD</th>
                                    <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 60 }}>Status</th>
                                    <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, color: 'var(--ink-3)', width: 36 }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batchContacts.map(c => (
                                    <tr key={c.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                                      <td style={{ padding: '5px 10px', color: 'var(--ink-1)', fontWeight: 500 }}>{c.agent_name}</td>
                                      <td style={{ padding: '5px 10px', fontFamily: 'var(--mono)', color: 'var(--ink-1)' }}>{c.phone_number}</td>
                                      <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                        {c.category ? (
                                          <span style={{
                                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                            color: '#3b82f6',
                                            background: 'rgba(59,130,246,0.08)',
                                          }}>
                                            {c.category}
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>—</span>
                                        )}
                                      </td>
                                      <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                        {c.dpd_group ? (
                                          <span style={{
                                            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                            color: '#db2777',
                                            background: 'rgba(219,39,119,0.08)',
                                          }}>
                                            {c.dpd_group}
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>—</span>
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
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Per-agent tally */}
                          {Object.keys(batchByAgent).length > 0 && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
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
