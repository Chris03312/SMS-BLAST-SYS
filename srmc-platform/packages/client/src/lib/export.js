/**
 * export.js — Data export utilities (CSV download).
 */

/**
 * Escape a CSV value (wrap in quotes if contains comma, quote, or newline).
 */
function esc(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV string from an array of objects.
 * @param {object[]} rows
 * @param {{ key: string, label: string }[]} columns
 * @returns {string} CSV content
 */
export function toCsv(rows, columns) {
  const header = columns.map(c => esc(c.label)).join(',');
  const body = rows.map(row =>
    columns.map(c => esc(row[c.key])).join(',')
  ).join('\n');
  return header + '\n' + body;
}

/**
 * Trigger a browser download of a CSV file.
 * @param {string} csv     - CSV content
 * @param {string} filename - e.g. "analytics-2026-06-25.csv"
 */
export function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
 * Build and download a combined CSV export of all analytics data.
 *
 * @param {object} data - The full analytics response (series, by_user, by_gateway, by_campaign)
 * @param {string} periodLabel - e.g. "Daily", "Weekly"
 */
export function exportAnalyticsCsv(data, periodLabel) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const parts = [];

  // ── 1. Period breakdown ────────────────────────────────────────────
  if (data.series?.length) {
    parts.push('--- Period Breakdown ---');
    parts.push(toCsv(data.series, [
      { key: 'date', label: periodLabel },
      { key: 'sent', label: 'Sent' },
      { key: 'failed', label: 'Failed' },
    ]));
    parts.push('');
  }

  // ── 2. By Campaign ─────────────────────────────────────────────────
  if (data.by_campaign?.length) {
    parts.push('--- By Campaign ---');
    parts.push(toCsv(data.by_campaign, [
      { key: 'campaign_name', label: 'Campaign' },
      { key: 'sent', label: 'Sent' },
      { key: 'failed', label: 'Failed' },
    ]));
    parts.push('');
  }

  // ── 3. By Agent ────────────────────────────────────────────────────
  if (data.by_user?.length) {
    parts.push('--- By Agent ---');
    parts.push(toCsv(data.by_user, [
      { key: 'display_name', label: 'Agent' },
      { key: 'username', label: 'Username' },
      { key: 'sent', label: 'Sent' },
      { key: 'failed', label: 'Failed' },
    ]));
    parts.push('');
  }

  // ── 4. By Gateway ──────────────────────────────────────────────────
  if (data.by_gateway?.length) {
    parts.push('--- By Gateway ---');
    parts.push(toCsv(data.by_gateway, [
      { key: 'gateway_name', label: 'Gateway' },
      { key: 'number', label: 'Number' },
      { key: 'sent', label: 'Sent' },
      { key: 'failed', label: 'Failed' },
    ]));
    parts.push('');
  }

  const csv = parts.join('\n');
  downloadCsv(csv, `srmc-analytics-${dateStr}.csv`);
}
