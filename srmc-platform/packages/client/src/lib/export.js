/**
 * export.js — Data export utilities (XLSX multi-sheet download).
 */

import * as XLSX from 'xlsx-js-style';
import { api } from './api.js';

/**
 * Trigger a browser download of a blob/file.
 * @param {Blob} blob     - File blob
 * @param {string} filename - e.g. "sms-analytics-2026-06-25.xlsx"
 */
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build and download a multi-sheet XLSX export of all analytics data.
 *
 * Each data section becomes its own sheet:
 *   - Period Breakdown
 *   - By Campaign
 *   - By Agent
 *   - By Gateway
 *
 * @param {object} data - The full analytics response (series, by_user, by_gateway, by_campaign)
 * @param {string} periodLabel - e.g. "Daily", "Weekly"
 */
export function exportAnalyticsXlsx(data, periodLabel) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // ── 1. Period Breakdown sheet ────────────────────────────────────────
  if (data.series?.length) {
    const ws = XLSX.utils.json_to_sheet(data.series.map(s => ({
      [periodLabel]: s.date,
      Sent: s.sent,
      Failed: s.failed,
    })));
    XLSX.utils.book_append_sheet(wb, ws, 'Period Breakdown');
  }

  // ── 2. By Campaign sheet ─────────────────────────────────────────────
  if (data.by_campaign?.length) {
    const ws = XLSX.utils.json_to_sheet(data.by_campaign.map(c => ({
      Campaign: c.campaign_name,
      Sent: c.sent,
      Failed: c.failed,
    })));
    XLSX.utils.book_append_sheet(wb, ws, 'By Campaign');
  }

  // ── 3. By Agent sheet ────────────────────────────────────────────────
  if (data.by_user?.length) {
    const ws = XLSX.utils.json_to_sheet(data.by_user.map(u => ({
      Agent: u.display_name || u.username,
      Username: u.username,
      Sent: u.sent,
      Failed: u.failed,
    })));
    XLSX.utils.book_append_sheet(wb, ws, 'By Agent');
  }

  // ── 4. By Gateway sheet ──────────────────────────────────────────────
  if (data.by_gateway?.length) {
    const ws = XLSX.utils.json_to_sheet(data.by_gateway.map(g => ({
      Gateway: g.gateway_name,
      'SIM 1': g.number || '',
      'SIM 2': g.number2 || '',
      Sent: g.sent,
      Failed: g.failed,
    })));
    XLSX.utils.book_append_sheet(wb, ws, 'By Gateway');
  }

  // If there's at least one sheet, write and download
  if (wb.SheetNames.length > 0) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadFile(blob, `sms-analytics-${dateStr}.xlsx`);
  }
}

/**
 * Build and download an XLSX export of gateways.
 *
 * @param {Array} gateways - Array of gateway objects from the API
 */
export function exportGatewaysXlsx(gateways) {
  if (!gateways?.length) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  const rows = gateways.map(g => ({
    Name: g.name,
    'Device ID': g.id,
    URL: g.url,
    'SIM Carrier': g.sim_carrier || '—',
    'SIM 1 Number': g.number || '—',
    'SIM 2 Number': g.number2 || '—',
    Status: g.status || 'unknown',
    'Last Beat': g.last_beat || 'Never',
    'Sent Today': g.sent_today || 0,
    'Consecutive Fails': g.consecutive_fails || 0,
    'Last Error': g.last_error || '',
    Active: g.active ? 'Yes' : 'No',
    'In Use': g.in_use ? 'Yes' : 'No',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Gateways');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadFile(blob, `gateways-${dateStr}.xlsx`);
}

/**
 * Build and download an XLSX export of the activity log.
 *
 * Fetches all activity entries from the API (up to 10 000),
 * then writes them to a single-sheet workbook.
 *
 * @param {object} filters - { level?, limit? } to pass to the API
 */
export async function exportActivityXlsx(filters = {}) {
  const params = new URLSearchParams({ limit: 10000, ...(filters.level && filters.level !== 'all' ? { level: filters.level } : {}) });
  const data = await api.get(`/activity?${params}`);
  const activities = data.activities || [];

  if (activities.length === 0) return;

  const dateStr = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  const rows = activities.map(a => ({
    Timestamp: a.created_at || '',
    User: a.user_name || '—',
    Campaign: a.campaign_name || '—',
    Action: a.action || '',
    Detail: a.detail || '',
    Level: a.level || 'info',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Activity Log');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadFile(blob, `sms-activity-log-${dateStr}.xlsx`);
}

