/**
 * stats-reporter.js — Periodically reports local platform stats to the central
 * monitoring server (if configured).
 *
 * The central server URL is stored in settings as 'central_server_url'.
 * This service runs every 5 minutes and pushes:
 *   - Installation ID (unique per device)
 *   - Messages sent (today / total)
 *   - Gateways connected
 *   - Uptime / version
 *   - System info
 */

import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import db from './db.js';
import { getNgrokStatus } from './ngrok-tunnel.js';

const REPORT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INSTALL_ID_KEY     = 'install_id';
const CENTRAL_URL_KEY    = 'central_server_url';

let intervalHandle = null;
let startTime      = Date.now();

/**
 * Get or create a unique installation ID.
 */
function getInstallId() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(INSTALL_ID_KEY);
  if (!row) {
    const newId = uuidv4();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(INSTALL_ID_KEY, newId);
    return newId;
  }
  return row.value;
}

/**
 * Get the central server URL from settings.
 */
function getCentralUrl() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CENTRAL_URL_KEY);
  return row ? row.value : '';
}

/**
 * Collect current stats from the local database.
 */
function collectStats() {
  const now = new Date().toISOString();

  // Messages stats
  const totalSent   = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'sent'").get();
  const todaySent   = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'sent' AND date(sent_at) = date('now')").get();
  const totalFailed = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status = 'failed'").get();
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM messages WHERE status IN ('pending', 'queued')").get();

  // Gateway stats
  const onlineGateways  = db.prepare("SELECT COUNT(*) as c FROM gateways WHERE status = 'online'").get();
  const totalGateways   = db.prepare("SELECT COUNT(*) as c FROM gateways").get();

  // User stats
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get();

  // Broadcast stats
  const activeBroadcasts = db.prepare("SELECT COUNT(*) as c FROM broadcasts WHERE status = 'active'").get();
  const totalBroadcasts  = db.prepare("SELECT COUNT(*) as c FROM broadcasts").get();

  // Inbound stats
  const totalInbound    = db.prepare("SELECT COUNT(*) as c FROM inbound").get();
  const unreadInbound   = db.prepare("SELECT COUNT(*) as c FROM inbound WHERE read_at IS NULL").get();

  // Org name
  const orgName = db.prepare('SELECT value FROM settings WHERE key = ?').get('org_name');

  // Ngrok status
  const ngrokStatus = getNgrokStatus();

  // System info
  const uptimeMs = Date.now() - startTime;
  const uptimeHours = Math.floor(uptimeMs / 3600000);
  const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);

  return {
    install_id:     getInstallId(),
    org_name:       orgName ? orgName.value : 'Unknown',
    timestamp:      now,
    uptime:         `${uptimeHours}h ${uptimeMinutes}m`,
    uptime_ms:      uptimeMs,

    // Messages
    messages_sent_today:  todaySent ? todaySent.c : 0,
    messages_sent_total:  totalSent ? totalSent.c : 0,
    messages_failed:      totalFailed ? totalFailed.c : 0,
    messages_pending:     pendingCount ? pendingCount.c : 0,

    // Gateways
    gateways_online: onlineGateways ? onlineGateways.c : 0,
    gateways_total:  totalGateways ? totalGateways.c : 0,

    // Users
    users_total: totalUsers ? totalUsers.c : 0,

    // Broadcasts
    broadcasts_active: activeBroadcasts ? activeBroadcasts.c : 0,
    broadcasts_total:  totalBroadcasts ? totalBroadcasts.c : 0,

    // Inbound
    inbound_total:  totalInbound ? totalInbound.c : 0,
    inbound_unread: unreadInbound ? unreadInbound.c : 0,

    // Network
    ngrok_running: ngrokStatus.running,
    ngrok_url:     ngrokStatus.url || '',

    // System
    hostname:  os.hostname(),
    platform:  os.platform(),
    arch:      os.arch(),
    cpus:      os.cpus().length,
    total_mem: Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10 + 'GB',
    node_ver:  process.version,
    app_ver:   process.env.npm_package_version || '1.0.0',
  };
}

/**
 * Send stats report to the central server.
 */
async function sendReport() {
  const centralUrl = getCentralUrl();
  if (!centralUrl) {
    return; // Not configured — skip
  }

  try {
    const stats = collectStats();
    const url = `${centralUrl.replace(/\/+$/, '')}/api/stats/report`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats),
      timeout: 10000,
    });

    if (response.ok) {
      console.log('[stats-reporter] ✅ Report sent to', centralUrl);
    } else {
      console.warn('[stats-reporter] ⚠️  Report failed:', response.status, await response.text().catch(() => ''));
    }
  } catch (err) {
    // Silently fail — network might be down, that's OK
    console.warn('[stats-reporter] ⚠️  Could not send report:', err.message);
  }
}

/**
 * Start the periodic stats reporter.
 */
export function startStatsReporter() {
  const centralUrl = getCentralUrl();
  if (!centralUrl) {
    console.log('[stats-reporter] No central server configured — stats reporting disabled');
    console.log('[stats-reporter] Set "central_server_url" in Settings to enable');
    return;
  }

  console.log(`[stats-reporter] Starting — will report every ${REPORT_INTERVAL_MS / 60000} min to ${centralUrl}`);

  // Send immediately, then on interval
  sendReport();
  intervalHandle = setInterval(sendReport, REPORT_INTERVAL_MS);
}

/**
 * Stop the stats reporter.
 */
export function stopStatsReporter() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[stats-reporter] Stopped');
  }
}

/**
 * Force an immediate report (useful for testing or on-demand).
 */
export async function reportNow() {
  return sendReport();
}

/**
 * Update the central server URL and restart the reporter.
 */
export function setCentralUrl(url) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('central_server_url', ?)")
    .run(url || '');
  stopStatsReporter();
  if (url) {
    startStatsReporter();
  }
}
