import db from '../database/db.js';
import { broadcast } from './ws.js';
import {
  logActivity,
  saveProgress,
  flushProgress,
  emitProgress,
  emitComplete,
  pushSend,
  resetDailyCaps,
  checkGlobalPause,
  waitForResume,
  checkMaxDuration,
  waitForTimeWindow,
  waitForDailyCap,
  sleep,
} from './broadcast-helpers.js';
import { computeSimMode } from './sim-utils.js';
import { getSetting } from './config-service.js';


// Map of broadcastId -> { cancel: boolean, paused: boolean, _resume: () => void }
const running = new Map();

/**
 * Mark a contact as 'used' in the agent_contacts table when a message
 * is successfully sent. Only marks if the contact exists and hasn't
 * been marked used before.
 */
export function markContactAsUsed(toNumber, agentId, broadcastId) {
  if (!toNumber || !agentId) return;
  try {
    // Generate phone number format variants to match against stored contacts.
    // Contacts store numbers as-is from Excel (e.g. "09918933458;"), but
    // the broadcast engine normalizes to E.164 (+63918933458). We try
    // both formats AND strip semicolons so the "used" marking works.
    const variants = [toNumber];
    const clean = toNumber.replace(/[\s\-().;]/g, '');
    if (clean.startsWith('+63')) {
      variants.push('0' + clean.slice(3));
    }
    if (clean.startsWith('0')) {
      variants.push('+63' + clean.slice(1));
    }

    const unique = [...new Set(variants)];
    const placeholders = unique.map(() => '?').join(',');

    // Also strip semicolons from stored phone_number so "09918933458;" matches variant "09918933458"
    db.prepare(
      `UPDATE agent_contacts SET used = 1, broadcast_id = ?
       WHERE agent_id = ? AND REPLACE(phone_number, ';', '') IN (${placeholders}) AND used = 0`
    ).run(broadcastId || null, agentId, ...unique);
  } catch (_) {
    // Silently ignore — agent_contacts might not exist or table not set up
  }
}

export async function startBroadcast(broadcastId) {
  const broadcastRecord = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);
  if (!broadcastRecord) {
    console.error('[broadcast-engine] Broadcast not found:', broadcastId);
    return;
  }

  const agentId = broadcastRecord.agent_id;
  const campaignId = broadcastRecord.campaign_id;

  // ── Max concurrent broadcasts check ────────────────────────────────────
  const maxSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_broadcasts'").get();
  const maxConcurrent = parseInt(maxSetting?.value) || 0;
  if (maxConcurrent > 0 && running.size >= maxConcurrent) {
    db.prepare("UPDATE broadcasts SET status = 'failed', completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), broadcastId);
    logActivity(agentId, 'broadcast:failed',
      `Broadcast ${broadcastId} queued but not started — at max concurrent limit (${maxConcurrent}). Cancel another broadcast first or increase the limit in Settings.`,
      'error', campaignId);
    emitComplete(broadcastId, 'failed', 0, 0, broadcastRecord.total, agentId);
    return;
  }

  // Load all selected gateways (fall back to single gateway_id for older records)
  const gatewayIds = (() => {
    try {
      const ids = JSON.parse(broadcastRecord.gateway_ids || '[]');
      if (ids.length > 0) return ids;
    } catch (_) { }
    return broadcastRecord.gateway_id ? [broadcastRecord.gateway_id] : [];
  })();

  const gateways = gatewayIds
    .map(id => db.prepare('SELECT * FROM gateways WHERE id = ? AND active = 1').get(id))
    .filter(Boolean);

  if (gateways.length === 0) {
    db.prepare("UPDATE broadcasts SET status = 'failed', completed_at = ? WHERE id = ?").run(new Date().toISOString(), broadcastId);
    logActivity(agentId, 'broadcast:failed', `No active gateways available for broadcast ${broadcastId}`, 'error', campaignId);
    emitComplete(broadcastId, 'failed', 0, 0, broadcastRecord.total, agentId);
    return;
  }

  const recipients = JSON.parse(broadcastRecord.recipients);
  const state = { cancel: false, paused: false };
  running.set(broadcastId, state);

  const startedAt = new Date().toISOString();
  db.prepare("UPDATE broadcasts SET status = 'sending', started_at = ? WHERE id = ?").run(startedAt, broadcastId);

  // ── Read global settings from DB (defaults come from config-service) ──
  const maxDurationMin = parseInt(getSetting('max_broadcast_duration_minutes'), 10) || 0;
  const TURBO_BATCH = parseInt(getSetting('turbo_batch_size'), 10) || 10;
  const startedMs = Date.parse(startedAt);

  // Seed counters from the DB record so recovery shows continuous progress.
  // E.g. if 9000/10000 were sent before crash, sent starts at 9000.
  let sent = broadcastRecord.sent || 0;
  let failed = broadcastRecord.failed || 0;
  const total = broadcastRecord.total;

  emitProgress(broadcastId, sent, failed, total, 'sending', agentId, startedAt);

  const distMode = broadcastRecord.distribution || 'round-robin';
  logActivity(
    agentId,
    'broadcast:start',
    `Broadcast ${broadcastId} started — ${total} recipients, ${gateways.length} gateway(s) [${distMode}]: ${gateways.map(g => g.name).join(', ')}`,
    'info',
    campaignId
  );

  // Build a quick lookup so the engine can find a gateway by ID
  const gatewayMap = Object.fromEntries(gateways.map(g => [g.id, g]));

  // Pre-compute per-gateway message counts (for parallel SIM split)
  const gatewayMsgCounts = {};
  const msgCounts = db.prepare(
    'SELECT gateway_id, COUNT(*) as cnt FROM messages WHERE broadcast_id = ? GROUP BY gateway_id'
  ).all(broadcastId);
  for (const row of msgCounts) {
    gatewayMsgCounts[row.gateway_id] = row.cnt;
  }

  // ── Per-broadcast scheduled time window (optional) ─────────────────
  const scheduleStart = broadcastRecord.send_start_at;
  const scheduleEnd = broadcastRecord.send_end_at;

  // ── Determine mode ────────────────────────────────────────────────
  const isTurbo = broadcastRecord.delay_ms <= 200;

  // Daily cap sent_today reset
  resetDailyCaps();

  // ── Shared per-iteration checks ────────────────────────────────────
  // Returns false if the iteration should break (cancelled).
  async function iterationChecks() {
    // 1. Global pause auto-detect
    if (!state.paused) {
      checkGlobalPause(broadcastId, state, agentId, campaignId);
    }
    // 2. Max duration
    if (checkMaxDuration(startedMs, maxDurationMin, state, agentId, campaignId)) {
      return false;
    }
    // 3. Wait if paused
    await waitForResume(broadcastId, state, agentId);
    // 4. Time window
    if (!(await waitForTimeWindow(broadcastId, scheduleStart, scheduleEnd, state, agentId, campaignId))) {
      return false;
    }
    // 5. Daily cap
    resetDailyCaps();
    if (!(await waitForDailyCap(state, agentId, campaignId))) {
      return false;
    }
    return !state.cancel;
  }

  // ── Shared message send logic ───────────────────────────────────────
  // Processes one message: either sends via PUSH or releases to PULL.
  // Mutates sent/failed/counters and broadcasts progress.
  async function sendMessage(number, msgRecord, gateway, simMode, idx, perGwIdx, combinedPos) {
    const isPush = gateway && gateway.url;
    const gid = gateway.id;

    // Compute SIM mode (use index within this gateway's batch)
    const resolvedSimMode = simMode || computeSimMode(
      broadcastRecord, gid, perGwIdx, gatewayMsgCounts,
      total, gateways.length, distMode, combinedPos,
    );

    if (isPush) {
      const result = await pushSend(gateway, number, msgRecord.message, resolvedSimMode);
      if (result.ok) {
        db.prepare("UPDATE messages SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), msgRecord.id);
        markContactAsUsed(number, agentId, broadcastId);
        sent++;
        logActivity(agentId, 'broadcast:queued', `Message sent to ${number}`, 'info', campaignId);
      } else {
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
          result.error || 'Gateway send failed', msgRecord.id
        );
        failed++;
        logActivity(agentId, 'broadcast:queued', `Message failed for ${number}`, 'warn', campaignId);
      }
    } else {
      db.prepare("UPDATE messages SET status = 'pending' WHERE id = ? AND status IN ('queued', 'pending')").run(msgRecord.id);
      logActivity(agentId, 'broadcast:queued', `Message queued for ${number}`, 'info', campaignId);
    }

    saveProgress(broadcastId, sent, failed);
    emitProgress(broadcastId, sent, failed, total, 'sending', agentId, startedAt);
  }

  // ── Execution ───────────────────────────────────────────────────────
  let wasCancelled = false;

  try {
    if (isTurbo) {
      // ── Turbo mode: concurrent batches ─────────────────────────────
      let msgIndex = 0;
      const perGwCounters = {};  // track message index per gateway
      let combinedPos = 0;

      while (msgIndex < recipients.length && !state.cancel) {
        if (!(await iterationChecks())) break;

        // Build a batch of messages
        const batchSize = Math.min(TURBO_BATCH, recipients.length - msgIndex);
        const batch = [];
        for (let j = 0; j < batchSize; j++) {
          const num = recipients[msgIndex + j];
          const msgRecord = db.prepare(
            "SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')"
          ).get(broadcastId, num);
          if (!msgRecord) continue;
          const gateway = gatewayMap[msgRecord.gateway_id] || gateways[0];
          batch.push({ num, msgRecord, gateway });
        }
        msgIndex += batchSize;
        if (batch.length === 0) continue;

        // Separate PUSH and PULL
        // combinedPos tracks global message position for combined gateway×SIM
        // round-robin. It MUST increment for ALL messages (not just push) so
        // the SIM alternation pattern stays correct across batch boundaries.
        const isCombined = distMode === 'round-robin' && gateways.length > 1 && broadcastRecord.sim_mode === 'round-robin';
        const pushItems = [];
        const pullItems = [];
        for (const item of batch) {
          const isPush = item.gateway && item.gateway.url;
          if (isPush) {
            if (perGwCounters[item.gateway.id] === undefined) perGwCounters[item.gateway.id] = 0;
            const gwIdx = perGwCounters[item.gateway.id]++;
            const simMode = computeSimMode(
              broadcastRecord, item.gateway.id, gwIdx, gatewayMsgCounts,
              total, gateways.length, distMode,
              isCombined ? combinedPos : null,
            );
            pushItems.push({ ...item, simMode });
          } else {
            pullItems.push(item);
          }
          // Increment for ALL messages to keep the SIM alternation correct
          if (isCombined) combinedPos++;
        }

        // PULL: release to 'pending' immediately
        for (const { num, msgRecord } of pullItems) {
          db.prepare("UPDATE messages SET status = 'pending' WHERE id = ? AND status IN ('queued', 'pending')").run(msgRecord.id);
          logActivity(agentId, 'broadcast:queued', `Message queued for ${num} [Turbo]`, 'info', campaignId);
          saveProgress(broadcastId, sent, failed);
          emitProgress(broadcastId, sent, failed, total, 'sending', agentId, startedAt);
        }

        // PUSH: send ALL in parallel
        if (pushItems.length > 0) {
          const pushResults = await Promise.allSettled(
            pushItems.map(async ({ num, msgRecord, gateway, simMode }) => {
              const result = await pushSend(gateway, num, msgRecord.message, simMode);
              if (result.ok) {
                db.prepare("UPDATE messages SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), msgRecord.id);
                markContactAsUsed(num, agentId, broadcastId);
                return { success: true, num };
              } else {
                db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
                  result.error || 'Gateway returned HTTP error', msgRecord.id
                );
                return { success: false, num };
              }
            })
          );

          for (const result of pushResults) {
            if (result.status === 'fulfilled') {
              const r = result.value;
              if (r.success) {
                sent++;
                logActivity(agentId, 'broadcast:queued', `Message sent to ${r.num} [Turbo]`, 'info', campaignId);
              } else {
                failed++;
                logActivity(agentId, 'broadcast:queued', `Message failed for ${r.num} [Turbo]`, 'warn', campaignId);
              }
            } else {
              failed++;
            }
            saveProgress(broadcastId, sent, failed);
            emitProgress(broadcastId, sent, failed, total, 'sending', agentId, startedAt);
          }
        }

        saveProgress(broadcastId, sent, failed);
        emitProgress(broadcastId, sent, failed, total, 'sending', agentId, startedAt);
      }
    } else {
      // ── Normal mode: one-at-a-time with delay ─────────────────────
      const perGwCounters = {};
      let combinedPos = 0;

      for (const number of recipients) {
        if (state.cancel) break;
        if (!(await iterationChecks())) break;

        // ── Pre-send delay (ALWAYS applied, even if message is skipped) ──
        await sleep(broadcastRecord.delay_ms);
        if (state.cancel) break;

        const msgRecord = db.prepare(
          "SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')"
        ).get(broadcastId, number);
        if (!msgRecord) continue;

        const gateway = gatewayMap[msgRecord.gateway_id] || gateways[0];

        // Track per-gateway message index
        const gid = gateway.id;
        if (perGwCounters[gid] === undefined) perGwCounters[gid] = 0;
        const gwIdx = perGwCounters[gid]++;

        // Combined position tracking — increment for ALL messages
        const useCombined = distMode === 'round-robin' && gateways.length > 1 && broadcastRecord.sim_mode === 'round-robin';
        const pos = useCombined ? combinedPos++ : null;

        await sendMessage(number, msgRecord, gateway, null, 0, gwIdx, pos);
      }
    }
  } catch (e) {
    console.error('[broadcast-engine] Error:', e);
    wasCancelled = true;
  }

  wasCancelled = wasCancelled || state.cancel;
  if (wasCancelled) {
    const label = isTurbo ? ' [Turbo]' : '';
    db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = ?, sent = ?, failed = ? WHERE id = ?")
      .run(new Date().toISOString(), sent, failed, broadcastId);
    emitComplete(broadcastId, 'cancelled', sent, failed, total, agentId);
    logActivity(agentId, 'broadcast:cancel',
      `Broadcast ${broadcastId} cancelled — ${sent}/${total} sent${label}`,
      'warn', campaignId);
    flushProgress(broadcastId);
    running.delete(broadcastId);
    onMessageAcked(broadcastId);
    return;
  }

  flushProgress(broadcastId);
  running.delete(broadcastId);

  // Settle completion from actual message state. Messages are 'pending'
  // for the remote phones — completion happens later as ACKs arrive.
  const queued = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE broadcast_id = ? AND status IN ('queued','pending','sending')"
  ).get(broadcastId);
  if (queued && queued.c > 0) {
    logActivity(agentId, 'broadcast:queued',
      `Broadcast ${broadcastId} — ${queued.c} message(s) queued for remote gateway(s) to deliver`, 'info', campaignId);
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
    if (row.status === 'sent' || row.status === 'delivered') sent += row.c;
    else if (row.status === 'failed') failed = row.c;
    else if (row.status === 'queued' || row.status === 'pending' || row.status === 'sending') open += row.c;
  }
  const total = b.total;

  db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, broadcastId);
  broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: b.status, agent_id: b.agent_id });

  if (open === 0) {
    const completedAt = new Date().toISOString();
    db.prepare("UPDATE broadcasts SET status = 'done', completed_at = ?, sent = ?, failed = ? WHERE id = ?")
      .run(completedAt, sent, failed, broadcastId);
    broadcast({ type: 'broadcast:complete', broadcastId, status: 'done', sent, failed, total, completed_at: completedAt, agent_id: b.agent_id });
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
  const pauseBcast = db.prepare('SELECT agent_id, campaign_id FROM broadcasts WHERE id = ?').get(broadcastId);
  broadcast({ type: 'broadcast:paused', broadcastId, agent_id: pauseBcast?.agent_id || null });
  logActivity(
    pauseBcast?.agent_id || null,
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
  const resumeBcast = db.prepare('SELECT agent_id, campaign_id FROM broadcasts WHERE id = ?').get(broadcastId);
  broadcast({ type: 'broadcast:resumed', broadcastId, agent_id: resumeBcast?.agent_id || null });
  logActivity(
    resumeBcast?.agent_id || null,
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

// ── Stuck message recovery ─────────────────────────────────────────────
// Sometimes a phone claims a message (marks it 'sending') but then crashes
// or loses network before ACKing it back. Without recovery, that message
// stays 'sending' forever — the phone never comes back to release it.
//
// This function re-releases messages stuck in 'sending' for longer than
// CLAIM_TIMEOUT_S (120s), setting them back to 'pending' so they can be
// claimed by another poll or the engine.
//
// Runs every 60 seconds during normal operation.

const STUCK_SENDING_TIMEOUT_S = 150; // slightly > CLAIM_TIMEOUT_S (120)

export function recoverStuckMessages() {
  try {
    // First, find which broadcasts have stuck messages (before UPDATE resets them)
    const stuck = db.prepare(
      `SELECT DISTINCT broadcast_id FROM messages
       WHERE status = 'sending' AND broadcast_id IS NOT NULL
         AND sent_at IS NOT NULL
         AND sent_at < datetime('now', ?)`
    ).all(`-${STUCK_SENDING_TIMEOUT_S} seconds`);

    const result = db.prepare(
      `UPDATE messages SET status = 'pending', sent_at = NULL
       WHERE status = 'sending'
         AND sent_at IS NOT NULL
         AND sent_at < datetime('now', ?)`
    ).run(`-${STUCK_SENDING_TIMEOUT_S} seconds`);

    if (result.changes > 0) {
      console.log(`[broadcast-engine] Released ${result.changes} stuck message(s) back to pending`);

      // Recompute progress for all affected broadcasts
      const seen = new Set();
      for (const row of stuck) {
        if (row.broadcast_id && !seen.has(row.broadcast_id)) {
          seen.add(row.broadcast_id);
          onMessageAcked(row.broadcast_id);
        }
      }
    }
  } catch (e) {
    console.error('[broadcast-engine] Stuck message recovery error:', e.message);
  }
}

// Start periodic recovery (runs every 60 seconds)
export function startStuckMessageRecovery() {
  recoverStuckMessages(); // Run once immediately
  setInterval(() => recoverStuckMessages(), 60_000);
  console.log('[broadcast-engine] Stuck message recovery started (every 60s)');
}

/**
 * Recover orphaned broadcasts after a server crash/restart.
 *
 * Finds all broadcasts stuck in 'sending' or 'paused' status, recalculates
 * progress from the messages table, and restarts the engine for those that
 * still have pending messages. Already-sent messages are automatically
 * skipped because startBroadcast only processes 'queued'/'pending' rows.
 *
 * Call this once during server startup — never during normal operation.
 */
export async function recoverBroadcasts() {
  const orphans = db.prepare(
    "SELECT * FROM broadcasts WHERE status IN ('sending', 'paused') ORDER BY created_at ASC"
  ).all();

  if (orphans.length === 0) {
    console.log('[broadcast-engine] ✓ No orphaned broadcasts to recover');
    return;
  }

  console.log(`[broadcast-engine] ♻ Recovering ${orphans.length} orphaned broadcast(s)...`);

  for (const bcast of orphans) {
    // Recalculate progress from actual message states
    const counts = db.prepare(
      "SELECT status, COUNT(*) AS c FROM messages WHERE broadcast_id = ? GROUP BY status"
    ).all(bcast.id);

    let sent = 0, failed = 0, open = 0;
    for (const row of counts) {
      if (row.status === 'sent' || row.status === 'delivered') sent += row.c;
      else if (row.status === 'failed') failed = row.c;
      else if (['queued', 'pending', 'sending'].includes(row.status)) open += row.c;
    }

    db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, bcast.id);

    if (open === 0) {
      // Nothing left to send — mark as done
      db.prepare("UPDATE broadcasts SET status = 'done', completed_at = ? WHERE id = ?")
        .run(new Date().toISOString(), bcast.id);
      console.log(`[broadcast-engine] ✓ Broadcast ${bcast.id.slice(0, 8)}… — all ${bcast.total} messages resolved, marked done`);
      continue;
    }

    // Get only the unsent messages (preserves original order via rowid)
    const unsent = db.prepare(
      "SELECT to_number FROM messages WHERE broadcast_id = ? AND status IN ('queued', 'pending', 'sending') ORDER BY rowid ASC"
    ).all(bcast.id);
    const remainingRecipients = unsent.map(m => m.to_number);

    // Update broadcast with filtered recipients so startBroadcast only
    // iterates through the messages that actually need sending — no wasted
    // loops through already-sent numbers.
    // Don't change total here — startBroadcast reads initial sent/failed
    // from the DB record (which we already updated above) so progress
    // shows continuous numbers (e.g. 9000/10000 → 10000/10000).
    db.prepare("UPDATE broadcasts SET recipients = ?, status = 'pending' WHERE id = ?")
      .run(JSON.stringify(remainingRecipients), bcast.id);

    logActivity(
      bcast.agent_id || null,
      'broadcast:resumed',
      `Broadcast ${bcast.id.slice(0, 8)}… auto-recovered after server restart — ${open}/${bcast.total} messages remaining`,
      'info',
      bcast.campaign_id || null
    );

    // Fire-and-forget to avoid blocking startup on long broadcasts.
    // A small delay between each prevents max-concurrent limit issues.
    setImmediate(() => {
      startBroadcast(bcast.id).catch(err =>
        console.error(`[broadcast-engine] ❌ Failed to recover broadcast ${bcast.id}:`, err.message)
      );
    });
    await new Promise(r => setTimeout(r, 100));
  }
}
