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

      if (!rows || rows.length < 2) {
        toast('File must have a header row (agent names) and at least one data row.', 'warning');
        return;
      }

      const headerRow = rows[0];
      const agentNames = headerRow.filter(Boolean).map(String);
      if (agentNames.length === 0) {
        toast('Header row is empty.', 'warning');
        return;
      }

      const agentsData = agentNames.map(name => ({ name, numbers: [] }));
      let total = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < agentNames.length; c++) {
          const cell = row[c];
          if (cell === undefined || cell === null) continue;
          const str = String(cell).trim();
          const cleaned = str.replace(/[\s\-().]/g, '');
          if (cleaned.length >= 7 && /^\+?\d{7,15}$/.test(cleaned)) {
            agentsData[c].numbers.push(str);
            total++;
          }
        }
      }

      if (total === 0) {
        toast('No phone numbers found in the file.', 'warning');
        return;
      }

      setParsedAgents(agentsData);
      setPreview({
        fileName: file.name,
        agents: agentsData.map(a => ({ name: a.name, count: a.numbers.length })),
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
      const result = await api.post('/admin/contacts/upload', {
        agents: parsedAgents,
        fileName: preview.fileName,
      });
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
    const sampleData = [
      ['Maria', 'Jose', 'Carlo'],
      ['09171234567', '09179876543', '09195551234'],
      ['09177654321', '09193332211', '09194447777'],
      ['09178889999', '', '09196665555'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }];
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
            Upload an Excel file (.xlsx) where <strong>column headers are agent display names</strong> and <strong>cells contain phone numbers</strong>.
            <br />The system will assign each number to the agent in its column.
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {preview.agents.map(a => (
                    <span key={a.name} style={{
                      padding: '3px 10px', borderRadius: 6,
                      background: 'var(--ok-bg)', border: '1px solid var(--ok-line)',
                      fontSize: 11, fontWeight: 500, color: 'var(--ok)',
                    }}>
                      {a.name}: {a.count}
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
                      <td colSpan={6} style={{ padding: '0 18px', background: 'var(--bg-soft)' }}>
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
                                  {name}: {stats.used}/{stats.total} used
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
