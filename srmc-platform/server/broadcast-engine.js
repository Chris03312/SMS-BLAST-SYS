import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { broadcast } from './ws.js';
import { normalizePhone } from './phone.js';
import { logSend, resolveSender } from './send-logger.js';
import { trackGatewayResult } from './services/gateway-service.js';

// Map of broadcastId -> { cancel: boolean, paused: boolean, _resume: () => void }
const running = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logActivity(userId, action, detail, level = 'info', campaignId = null) {
  try {
    db.prepare('INSERT INTO activity (id, user_id, action, detail, level, campaign_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), userId, action, detail, level, campaignId);
    broadcast({ type: 'activity:new', action, detail, level, campaign_id: campaignId, created_at: new Date().toISOString() });
  } catch (e) {
    console.error('[broadcast-engine] logActivity error:', e.message);
  }
}

async function sendViaSingleGateway(gateway, toNumber, message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${gateway.url}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
      },
      body: JSON.stringify({ to: normalizePhone(toNumber), message, flash: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) return { success: true };
    const body = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: e.message || 'Network error' };
  }
}

export async function startBroadcast(broadcastId) {
  const broadcastRecord = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);
  if (!broadcastRecord) {
    console.error('[broadcast-engine] Broadcast not found:', broadcastId);
    return;
  }

  // ── Max concurrent broadcasts check ────────────────────────────────────
  const maxSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_broadcasts'").get();
  const maxConcurrent = parseInt(maxSetting?.value) || 0;
  if (maxConcurrent > 0 && running.size >= maxConcurrent) {
    db.prepare("UPDATE broadcasts SET status = 'failed', completed_at = datetime('now') WHERE id = ?")
      .run(broadcastId);
    logActivity(broadcastRecord.agent_id, 'broadcast:failed',
      `Broadcast ${broadcastId} queued but not started — at max concurrent limit (${maxConcurrent}). Cancel another broadcast first or increase the limit in Settings.`,
      'error', broadcastRecord.campaign_id);
    broadcast({ type: 'broadcast:complete', broadcastId, status: 'failed', sent: 0, failed: 0, total: broadcastRecord.total });
    return;
  }

  // Load all selected gateways (fall back to single gateway_id for older records)
  const gatewayIds = (() => {
    try {
      const ids = JSON.parse(broadcastRecord.gateway_ids || '[]');
      if (ids.length > 0) return ids;
    } catch (_) {}
    return broadcastRecord.gateway_id ? [broadcastRecord.gateway_id] : [];
  })();

  const gateways = gatewayIds
    .map(id => db.prepare('SELECT * FROM gateways WHERE id = ? AND active = 1').get(id))
    .filter(Boolean);

  if (gateways.length === 0) {
    db.prepare("UPDATE broadcasts SET status = 'failed', completed_at = datetime('now') WHERE id = ?").run(broadcastId);
    logActivity(broadcastRecord.agent_id, 'broadcast:failed', `No active gateways available for broadcast ${broadcastId}`, 'error', broadcastRecord.campaign_id);
    return;
  }

  const recipients = JSON.parse(broadcastRecord.recipients);
  const state = { cancel: false };
  running.set(broadcastId, state);

  db.prepare("UPDATE broadcasts SET status = 'sending', started_at = datetime('now') WHERE id = ?").run(broadcastId);

  let sent = 0;
  let failed = 0;
  const total = broadcastRecord.total;

  broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending',
    gateways: gateways.map(g => ({ id: g.id, name: g.name })) });

  const distMode = broadcastRecord.distribution || 'round-robin';
  logActivity(
    broadcastRecord.agent_id,
    'broadcast:start',
    `Broadcast ${broadcastId} started — ${total} recipients, ${gateways.length} gateway(s) [${distMode}]: ${gateways.map(g => g.name).join(', ')}`,
    'info',
    broadcastRecord.campaign_id
  );

  // Build a quick lookup so the engine can find a gateway by ID
  const gatewayMap = Object.fromEntries(gateways.map(g => [g.id, g]));

  // ── Admin configuration checks ──────────────────────────────────────
  // Read time window and daily cap from settings (re-read each loop iteration
  // so live changes take effect without a restart).
  function readConfig() {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('window_start', 'window_end', 'daily_cap')").all();
    const cfg = { window_start: '09:00', window_end: '20:00', daily_cap: 10000 };
    for (const r of rows) {
      if (r.key === 'daily_cap') cfg.daily_cap = parseInt(r.value) || 10000;
      else cfg[r.key] = r.value;
    }
    return cfg;
  }

  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  let config = readConfig();

  for (const number of recipients) {
    if (state.cancel) {
      db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = datetime('now'), sent = ?, failed = ? WHERE id = ?")
        .run(sent, failed, broadcastId);
      broadcast({ type: 'broadcast:complete', broadcastId, status: 'cancelled', sent, failed, total });
      logActivity(broadcastRecord.agent_id, 'broadcast:cancel', `Broadcast ${broadcastId} cancelled — ${sent}/${total} sent`, 'warn', broadcastRecord.campaign_id);
      running.delete(broadcastId);
      return;
    }

    // ── Time window check ────────────────────────────────────────────
    // If outside the configured sending window, pause and wait until
    // the window opens (checked every 60s).
    while (true) {
      config = readConfig();
      const now = nowHHMM();
      if (now >= config.window_start && now <= config.window_end) break;
      if (state.cancel) break;
      logActivity(broadcastRecord.agent_id, 'broadcast:paused',
        `Broadcast paused — outside sending window (${config.window_start}–${config.window_end}). Current time: ${now}`,
        'info', broadcastRecord.campaign_id);
      await sleep(60000);
    }
    if (state.cancel) continue;

    // ── Pause check ────────────────────────────────────────────────────
    if (state.paused) {
      db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
      broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'paused' });
      // Wait until resumed
      await new Promise((resolve) => {
        state._resume = resolve;
      });
      db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcastId);
      broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending' });
    }

    // ── Daily cap check ───────────────────────────────────────────────
    // Reset sent_today counters at the start of each new day so the daily
    // cap refreshes automatically at midnight.
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const lastReset = db.prepare("SELECT value FROM settings WHERE key = 'sent_today_date'").get();
    if (!lastReset || lastReset.value !== todayStr) {
      db.prepare('UPDATE gateways SET sent_today = 0').run();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sent_today_date', ?)").run(todayStr);
    }
    // Sum sent_today across all gateways and compare to the configured cap.
    while (true) {
      config = readConfig();
      const sentToday = db.prepare("SELECT COALESCE(SUM(sent_today), 0) AS c FROM gateways").get();
      if (!sentToday || sentToday.c < config.daily_cap) break;
      if (state.cancel) break;
      logActivity(broadcastRecord.agent_id, 'broadcast:paused',
        `Broadcast paused — daily cap of ${config.daily_cap} messages reached. Waiting for reset…`,
        'warn', broadcastRecord.campaign_id);
      await sleep(60000);
    }
    if (state.cancel) continue;

    // Use the gateway pre-assigned to this message by the route.
    // Messages inserted fresh (since the 'queued' default) start as 'queued'.
    // Legacy messages from before the change may already be 'pending'.
    const msgRecord = db.prepare("SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')")
      .get(broadcastId, number);
    if (!msgRecord) continue;

    // Resolve gateway: use the one assigned to the message, fall back to first available
    const gateway = gatewayMap[msgRecord.gateway_id] || gateways[0];

    // ── Pre-send delay ────────────────────────────────────────────────
    // Wait the configured interval BEFORE dispatching each message so the
    // pacing is "delay → send". Re-check cancel after waking so a cancel
    // issued during the wait stops the broadcast before it sends.
    await sleep(broadcastRecord.delay_ms);
    if (state.cancel) continue;

    if (gateway.mode === 'push' && gateway.url) {
      // ── PUSH gateway: server sends SMS directly via HTTP ──────────
      const { success, error: errorText } = await sendViaSingleGateway(gateway, number, broadcastRecord.message);
      const sender = resolveSender(gateway);

      if (success) {
        sent++;
        db.prepare("UPDATE messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(msgRecord.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gateway.id);
        trackGatewayResult(gateway.id, true, gateway.name, broadcastRecord.agent_id);
        logActivity(broadcastRecord.agent_id, 'sms:sent', `Sent from ${sender} to ${number} via ${gateway.name}`, 'info', broadcastRecord.campaign_id);
        logSend({ name: gateway.name, sender, receiver: number, status: 'sent' });
      } else {
        failed++;
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(errorText, msgRecord.id);
        trackGatewayResult(gateway.id, false, gateway.name, broadcastRecord.agent_id);
        logActivity(broadcastRecord.agent_id, 'sms:failed', `Failed from ${sender} to ${number} via ${gateway.name}: ${errorText}`, 'error', broadcastRecord.campaign_id);
        logSend({ name: gateway.name, sender, receiver: number, status: 'failed' });
      }

      db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, broadcastId);
      broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending' });
    } else {
      // ── PULL gateway (Android phone): release at the configured delay rate ──
      // Change from 'queued' → 'pending' so the phone can claim it.
      // The delay below paces how fast messages become available.
      db.prepare("UPDATE messages SET status = 'pending' WHERE id = ? AND status IN ('queued', 'pending')").run(msgRecord.id);
    }
  }

  running.delete(broadcastId);

  // Settle completion from actual message state. For PUSH-only broadcasts this
  // marks 'done' immediately. For PULL broadcasts, messages are still 'pending'
  // for the remote phones — completion happens later as ACKs arrive.
  const queued = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE broadcast_id = ? AND status IN ('queued','pending','sending')"
  ).get(broadcastId);
  if (queued && queued.c > 0) {
    logActivity(broadcastRecord.agent_id, 'broadcast:queued',
      `Broadcast ${broadcastId} — ${queued.c} message(s) queued for remote gateway(s) to deliver`, 'info', broadcastRecord.campaign_id);
  }
  onMessageAcked(broadcastId);
}

/**
 * Recompute a broadcast's progress from its message rows and emit live updates.
 * Marks the broadcast 'done' once nothing is left pending/sending. Called both
 * at the end of startBroadcast and whenever a pull gateway ACKs results.
 */
export function onMessageAcked(broadcastId) {
  const b = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);
  if (!b) return;
  if (b.status === 'done' || b.status === 'cancelled') return;

  const counts = db.prepare(
    "SELECT status, COUNT(*) AS c FROM messages WHERE broadcast_id = ? GROUP BY status"
  ).all(broadcastId);

  let sent = 0, failed = 0, open = 0;
  for (const row of counts) {
    if (row.status === 'sent') sent = row.c;
    else if (row.status === 'failed') failed = row.c;
    else if (row.status === 'queued' || row.status === 'pending' || row.status === 'sending') open += row.c;
  }
  const total = b.total;

  db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, broadcastId);
  broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: b.status });

  if (open === 0) {
    db.prepare("UPDATE broadcasts SET status = 'done', completed_at = datetime('now'), sent = ?, failed = ? WHERE id = ?")
      .run(sent, failed, broadcastId);
    broadcast({ type: 'broadcast:complete', broadcastId, status: 'done', sent, failed, total });
    logActivity(b.agent_id, 'broadcast:done',
      `Broadcast ${broadcastId} done — ${sent}/${total} sent, ${failed} failed`, 'info', b.campaign_id);
  }
}

export function cancelBroadcast(broadcastId) {
  const state = running.get(broadcastId);
  if (state) { state.cancel = true; if (state._resume) state._resume(); return true; }
  return false;
}

export function pauseBroadcast(broadcastId) {
  const state = running.get(broadcastId);
  if (!state) return false;
  state.paused = true;
  db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
  broadcast({ type: 'broadcast:paused', broadcastId });
  logActivity(
    db.prepare('SELECT agent_id, campaign_id FROM broadcasts WHERE id = ?').get(broadcastId)?.agent_id || null,
    'broadcast:paused',
    `Broadcast ${broadcastId} paused by user`,
    'info'
  );
  return true;
}

export function resumeBroadcast(broadcastId) {
  const state = running.get(broadcastId);
  if (!state || !state.paused) return false;
  state.paused = false;
  if (state._resume) { state._resume(); state._resume = null; }
  db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcastId);
  broadcast({ type: 'broadcast:resumed', broadcastId });
  logActivity(
    db.prepare('SELECT agent_id, campaign_id FROM broadcasts WHERE id = ?').get(broadcastId)?.agent_id || null,
    'broadcast:resumed',
    `Broadcast ${broadcastId} resumed by user`,
    'info'
  );
  return true;
}

export function isBroadcastRunning(broadcastId) {
  return running.has(broadcastId);
}

export function getRunningBroadcasts() {
  const ids = [];
  for (const [id, state] of running) {
    ids.push({ id, paused: !!state.paused });
  }
  return ids;
}

export function getRunningCount() {
  return running.size;
}
