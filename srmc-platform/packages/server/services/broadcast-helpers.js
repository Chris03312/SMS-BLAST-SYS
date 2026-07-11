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

export { logActivity };

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Time / Config helpers ──────────────────────────────────────────────────

/** Read the configurable timezone from settings. */
export function getTimezone() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
  return (row && row.value) || 'Asia/Manila';
}

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
 * Read window_start, window_end, and daily_cap from settings.
 * Returns an object with sensible defaults.
 */
export function readConfig() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('window_start', 'window_end', 'daily_cap')"
  ).all();
  const cfg = { window_start: '00:00', window_end: '23:59', daily_cap: 10000 };
  for (const r of rows) {
    if (r.key === 'daily_cap') {
      cfg.daily_cap = parseInt(r.value) || 10000;
    } else {
      cfg[r.key] = (r.value && r.value !== '00:00') ? r.value : cfg[r.key];
    }
  }
  return cfg;
}

// ── Progress / Completion helpers ──────────────────────────────────────────

/** Persist sent/failed counts to the DB (used so page refreshes preserve counts). */
export function saveProgress(broadcastId, sent, failed) {
  try {
    db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, broadcastId);
  } catch (_) {}
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
