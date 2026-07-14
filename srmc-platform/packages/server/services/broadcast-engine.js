import db from '../database/db.js';
import { broadcast } from './ws.js';
import {
  logActivity,
  saveProgress,
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
    db.prepare(
      `UPDATE agent_contacts SET used = 1, broadcast_id = ?
       WHERE agent_id = ? AND phone_number = ? AND used = 0`
    ).run(broadcastId || null, agentId, toNumber);
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

  let sent = 0;
  let failed = 0;
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
    const isPush = gateway && gateway.url && gateway.mode !== 'pull';
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
          const isPush = item.gateway && item.gateway.url && item.gateway.mode !== 'pull';
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

        const msgRecord = db.prepare(
          "SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')"
        ).get(broadcastId, number);
        if (!msgRecord) continue;

        const gateway = gatewayMap[msgRecord.gateway_id] || gateways[0];

        // ── Pre-send delay ────────────────────────────────────────────
        await sleep(broadcastRecord.delay_ms);
        if (state.cancel) break;

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
    running.delete(broadcastId);
    onMessageAcked(broadcastId);
    return;
  }

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
