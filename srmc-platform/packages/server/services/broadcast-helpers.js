/**
 * broadcast-helpers.js — Shared helpers for the broadcast engine.
 *
 * Extracts common configuration reading, time formatting, progress updates,
 * push-sending, and daily-cap reset logic so the turbo and normal mode
 * paths in broadcast-engine.js don't duplicate them.
 */

import fetch from 'node-fetch';
import db from '../database/db.js';
import { broadcast } from './ws.js';
import { logActivity } from './activity.js';
import { getTimezone } from './timezone.js';
import { getSetting } from './config-service.js';

export { logActivity };

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Time / Config helpers ──────────────────────────────────────────────────

/**
 * Return the current time in the configured timezone as "HH:MM" (24-hour).
 * Fixes "24:xx" → "00:xx" for midnight.
 */
export function nowHHMM() {
  const tz = getTimezone();
  const d = new Date();
  const time = d.toLocaleString('en-PH', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return time.replace(/^24:/, '00:');
}

/**
 * Read window_start, window_end, and daily_cap from the database settings.
 * All defaults flow from config-service.js — never hardcode values here.
 */
export function readConfig() {
  return {
    window_start: getSetting('window_start') || '00:00',
    window_end:   getSetting('window_end')   || '23:59',
    daily_cap:    parseInt(getSetting('daily_cap'), 10) || 0,
  };
}

// ── Progress / Completion helpers ──────────────────────────────────────────

// ── Batched saveProgress ──────────────────────────────────────────
// Instead of writing to DB after EVERY message, we buffer updates and
// write every BATCH_INTERVAL messages. This reduces DB writes by ~90%
// with no perceptible impact on the UI (WebSocket emits still happen).
// With better-sqlite3 the writes are fast, but batching still helps
// during turbo mode where 10+ messages finish at the same time.

const PROGRESS_BATCH_SIZE = 10;
const PROGRESS_FLUSH_INTERVAL = 500; // ms — max delay before forced write
const _progressBuffer = new Map(); // broadcastId -> { sent, failed, lastWrite, pendingCount }

/**
 * Persist sent/failed counts to the DB. Batches writes to reduce DB load.
 * Falls through to immediate write every 500ms even if batch isn't full,
 * so progress never goes stale for more than 500ms.
 */
export function saveProgress(broadcastId, sent, failed) {
  const now = Date.now();
  let entry = _progressBuffer.get(broadcastId);

  if (entry) {
    entry.sent = Math.max(entry.sent, sent);
    entry.failed = Math.max(entry.failed, failed);
    entry.pendingCount++;
  } else {
    entry = { sent, failed, lastWrite: now, pendingCount: 1 };
    _progressBuffer.set(broadcastId, entry);
  }

  const timeSinceLastWrite = now - entry.lastWrite;

  // Write to DB if: batch is full OR flush interval has passed
  if (entry.pendingCount >= PROGRESS_BATCH_SIZE || timeSinceLastWrite >= PROGRESS_FLUSH_INTERVAL) {
    try {
      db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(entry.sent, entry.failed, broadcastId);
    } catch (_) {}
    entry.lastWrite = now;
    entry.pendingCount = 0;
  }
}

/**
 * Force-flush any pending progress for a broadcast (used when broadcast completes).
 */
export function flushProgress(broadcastId) {
  const entry = _progressBuffer.get(broadcastId);
  if (entry && entry.pendingCount > 0) {
    try {
      db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(entry.sent, entry.failed, broadcastId);
    } catch (_) {}
  }
  _progressBuffer.delete(broadcastId);
}

/** Broadcast real-time progress via WebSocket. */
export function emitProgress(broadcastId, sent, failed, total, status, agentId, startedAt) {
  broadcast({
    type: 'broadcast:progress',
    broadcastId,
    sent,
    failed,
    total,
    status,
    ...(startedAt ? { started_at: startedAt } : {}),
    agent_id: agentId,
  });
}

/** Broadcast broadcast-complete via WebSocket. */
export function emitComplete(broadcastId, status, sent, failed, total, agentId) {
  broadcast({
    type: 'broadcast:complete',
    broadcastId,
    status,
    sent,
    failed,
    total,
    completed_at: new Date().toISOString(),
    agent_id: agentId,
  });
}

// ── PUSH send helper ────────────────────────────────────────────────────────

/**
 * Send a single SMS through a PUSH gateway (gateway.url + POST /send).
 * Does NOT update the messages table — the caller is responsible for that.
 *
 * @returns {{ ok: boolean, error: string|null }}
 *   - { ok: true, error: null }  on success
 *   - { ok: false, error: '...' } on failure (HTTP status or network error)
 */
export async function pushSend(gateway, toNumber, message, simMode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${gateway.url}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
      },
      body: JSON.stringify({ to: toNumber, message, sim_mode: simMode }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) return { ok: true, error: null };
    return { ok: false, error: `Gateway returned HTTP ${response.status}` };
  } catch (pushErr) {
    clearTimeout(timeout);
    return { ok: false, error: `Push failed: ${pushErr.message || 'timeout'}` };
  }
}

// ── Daily cap reset ──────────────────────────────────────────────────────────

/**
 * Reset sent_today counters on all gateways if the date has changed.
 * Idempotent — safe to call on every iteration.
 */
export function resetDailyCaps() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastReset = db.prepare("SELECT value FROM settings WHERE key = 'sent_today_date'").get();
  if (!lastReset || lastReset.value !== todayStr) {
    db.prepare('UPDATE gateways SET sent_today = 0').run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sent_today_date', ?)").run(todayStr);
  }
}

// ── Pause helpers ────────────────────────────────────────────────────────────

/**
 * Check whether the global pause is active. If so, mark the broadcast as
 * paused and set state.paused. Returns true if the broadcast was just paused.
 */
export function checkGlobalPause(broadcastId, state, agentId, campaignId) {
  const gpRow = db.prepare("SELECT value FROM settings WHERE key = 'broadcasts_globally_paused'").get();
  if (gpRow && gpRow.value === 'true') {
    state.paused = true;
    db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
    broadcast({ type: 'broadcast:progress', broadcastId, sent: 0, failed: 0, total: 0, status: 'paused', agent_id: agentId });
    logActivity(agentId, 'broadcast:paused', 'Broadcast paused — globally paused by admin.', 'warn', campaignId);
    return true;
  }
  return false;
}

/**
 * Wait for the broadcast to be resumed if it is currently paused.
 * Returns when state.paused becomes false.
 */
export async function waitForResume(broadcastId, state, agentId) {
  if (!state.paused) return;
  db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
  broadcast({ type: 'broadcast:progress', broadcastId, sent: 0, failed: 0, total: 0, status: 'paused', agent_id: agentId });
  await new Promise((resolve) => { state._resume = resolve; });
  db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcastId);
  broadcast({ type: 'broadcast:progress', broadcastId, sent: 0, failed: 0, total: 0, status: 'sending', agent_id: agentId });
}

/**
 * Check if the broadcast has exceeded the max duration limit.
 * If so, sets state.cancel and returns true.
 */
export function checkMaxDuration(startedMs, maxDurationMin, state, agentId, campaignId) {
  if (maxDurationMin <= 0) return false;
  const elapsed = (Date.now() - startedMs) / 60000;
  if (elapsed >= maxDurationMin) {
    state.cancel = true;
    logActivity(
      agentId,
      'broadcast:cancel',
      `Broadcast auto-cancelled — exceeded max duration of ${maxDurationMin} minutes.`,
      'warn',
      campaignId,
    );
    return true;
  }
  return false;
}

/**
 * Wait until we are inside the configured sending time window.
 * Re-checks every 60 seconds. Returns immediately if state.cancel is set.
 * Returns true if the loop should continue, false if cancelled.
 */
export async function waitForTimeWindow(broadcastId, scheduleStart, scheduleEnd, state, agentId, campaignId) {
  while (!state.cancel) {
    const config = readConfig();
    const now = nowHHMM();
    const withinGlobal = now >= config.window_start && now <= config.window_end;
    const withinSchedule =
      (!scheduleStart || now >= scheduleStart) &&
      (!scheduleEnd || now <= scheduleEnd);
    if (withinGlobal && withinSchedule) return true;

    const phTimeDisplay = new Date().toLocaleTimeString('en-PH', {
      timeZone: getTimezone(),
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const windowLabel = scheduleStart
      ? `${scheduleStart}–${scheduleEnd || config.window_end} (scheduled)`
      : `${config.window_start}–${config.window_end}`;
    logActivity(
      agentId,
      'broadcast:paused',
      `Broadcast paused — outside sending window (${windowLabel}). Current time: ${phTimeDisplay}`,
      'info',
      campaignId,
    );
    await new Promise((r) => setTimeout(r, 60000));
  }
  return false;
}

/**
 * Wait until we are below the daily cap.
 * Re-checks every 60 seconds. Returns immediately if state.cancel is set.
 * Returns true if the loop should continue, false if cancelled.
 */
export async function waitForDailyCap(state, agentId, campaignId) {
  while (!state.cancel) {
    const config = readConfig();
    const sentToday = db.prepare("SELECT COALESCE(SUM(sent_today), 0) AS c FROM gateways").get();
    if (!sentToday || sentToday.c < config.daily_cap) return true;

    logActivity(
      agentId,
      'broadcast:paused',
      `Broadcast paused — daily cap of ${config.daily_cap} messages reached. Waiting for reset…`,
      'warn',
      campaignId,
    );
    await new Promise((r) => setTimeout(r, 60000));
  }
  return false;
}
