import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import db from './db.js';
import { broadcast } from './ws.js';


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
    db.prepare("UPDATE broadcasts SET status = 'failed', completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), broadcastId);
    logActivity(broadcastRecord.agent_id, 'broadcast:failed',
      `Broadcast ${broadcastId} queued but not started — at max concurrent limit (${maxConcurrent}). Cancel another broadcast first or increase the limit in Settings.`,
      'error', broadcastRecord.campaign_id);
    broadcast({ type: 'broadcast:complete', broadcastId, status: 'failed', sent: 0, failed: 0, total: broadcastRecord.total, completed_at: new Date().toISOString() });
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
    logActivity(broadcastRecord.agent_id, 'broadcast:failed', `No active gateways available for broadcast ${broadcastId}`, 'error', broadcastRecord.campaign_id);
    return;
  }

  const recipients = JSON.parse(broadcastRecord.recipients);
  const state = { cancel: false };
  running.set(broadcastId, state);

  const startedAt = new Date().toISOString();
  db.prepare("UPDATE broadcasts SET status = 'sending', started_at = ? WHERE id = ?").run(startedAt, broadcastId);

  // ── Read global settings once at the start ────────────────────────────
  const allSettings = db.prepare("SELECT key, value FROM settings WHERE key IN ('broadcasts_globally_paused', 'max_broadcast_duration_minutes')").all();
  const settingsMap = {};
  for (const r of allSettings) settingsMap[r.key] = r.value;
  const globallyPaused = settingsMap['broadcasts_globally_paused'] === 'true';
  const maxDurationMin = parseInt(settingsMap['max_broadcast_duration_minutes']) || 0;
  const startedMs = Date.parse(startedAt);

  let sent = 0;
  let failed = 0;
  const total = broadcastRecord.total;

  broadcast({
    type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending', started_at: startedAt,
    gateways: gateways.map(g => ({ id: g.id, name: g.name }))
  });

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

  // Pre-compute per-gateway message counts (for parallel SIM split)
  const gatewayMsgCounts = {};
  const msgCounts = db.prepare('SELECT gateway_id, COUNT(*) as cnt FROM messages WHERE broadcast_id = ? GROUP BY gateway_id').all(broadcastId);
  for (const row of msgCounts) {
    gatewayMsgCounts[row.gateway_id] = row.cnt;
  }

  // ── Admin configuration checks ──────────────────────────────────────
  function readConfig() {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('window_start', 'window_end', 'daily_cap')").all();
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

  function getTimezone() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
    return (row && row.value) || 'Asia/Manila';
  }

  function nowHHMM() {
    const tz = getTimezone();
    const d = new Date();
    const time = d.toLocaleString('en-PH', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    // Fix: some locales return "24:xx" for midnight (00:xx-00:xx)
    return time.replace(/^24:/, '00:');
  }

  // ── Per-broadcast scheduled time window (optional) ─────────────────
  // These are stored as HH:MM (e.g. '14:30') in Asia/Manila timezone
  const scheduleStart = broadcastRecord.send_start_at;
  const scheduleEnd = broadcastRecord.send_end_at;

  let config = readConfig();

  // ── Determine if turbo mode is active ─────────────────────────────
  // Turbo mode: delay_ms <= 200ms, releases messages to 'pending' faster.
  // For PULL gateways (Android phones), messages are released at high speed.
  // The phone picks them up on its next poll cycle and sends them.
  const turboBatchSetting = db.prepare("SELECT value FROM settings WHERE key = 'turbo_batch_size'").get();
  const TURBO_BATCH = parseInt(turboBatchSetting?.value) || 5;

  const isTurbo = broadcastRecord.delay_ms <= 200;

  // Daily cap sent_today reset
  const capTodayStr = new Date().toISOString().slice(0, 10);
  const lastReset = db.prepare("SELECT value FROM settings WHERE key = 'sent_today_date'").get();
  if (!lastReset || lastReset.value !== capTodayStr) {
    db.prepare('UPDATE gateways SET sent_today = 0').run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sent_today_date', ?)").run(capTodayStr);
  }

  // ── Turbo: release messages in concurrent batches ─────────────────
  if (isTurbo) {
    let i = 0;
    let wasCancelled = false;
    const roundSimIdxMap = {}; // track SIM position per-gateway for round-robin alternation
    let combinedSimPos = 0;       // global SIM position for combined gateway×SIM round-robin

    try {
      while (i < recipients.length && !state.cancel) {
        // ── Global pause check ────────────────────────────────────
        if (!state.paused) {
          const gpRow = db.prepare("SELECT value FROM settings WHERE key = 'broadcasts_globally_paused'").get();
          if (gpRow && gpRow.value === 'true') {
            state.paused = true;
            db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
            broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'paused' });
            logActivity(broadcastRecord.agent_id, 'broadcast:paused',
              `Broadcast paused — globally paused by admin.`,
              'warn', broadcastRecord.campaign_id);
          }
        }

        // ── Max duration check ────────────────────────────────────
        if (maxDurationMin > 0) {
          const elapsed = (Date.now() - startedMs) / 60000;
          if (elapsed >= maxDurationMin) {
            state.cancel = true;
            logActivity(broadcastRecord.agent_id, 'broadcast:cancel',
              `Broadcast auto-cancelled — exceeded max duration of ${maxDurationMin} minutes.`,
              'warn', broadcastRecord.campaign_id);
            break;
          }
        }

        // Check pause
        if (state.paused) {
          db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
          broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'paused' });
          await new Promise((resolve) => { state._resume = resolve; });
          db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcastId);
          broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending' });
        }

        // ── Time window check (global admin window + per-broadcast schedule) ──
        while (true) {
          config = readConfig();
          const now = nowHHMM();
          const withinGlobal = now >= config.window_start && now <= config.window_end;
          const withinSchedule = (!scheduleStart || now >= scheduleStart) && (!scheduleEnd || now <= scheduleEnd);
          if (withinGlobal && withinSchedule) break;
          if (state.cancel) break;
          const phTimeDisplay = new Date().toLocaleTimeString('en-PH', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hour12: true });
          const windowLabel = scheduleStart
            ? `${scheduleStart}–${scheduleEnd || config.window_end} (scheduled)`
            : `${config.window_start}–${config.window_end}`;
          logActivity(broadcastRecord.agent_id, 'broadcast:paused',
            `Broadcast paused — outside sending window (${windowLabel}). Current time: ${phTimeDisplay}`,
            'info', broadcastRecord.campaign_id);
          await sleep(60000);
        }
        if (state.cancel) break;

        // Daily cap check
        while (true) {
          config = readConfig();
          const sentToday = db.prepare("SELECT COALESCE(SUM(sent_today), 0) AS c FROM gateways").get();
          if (!sentToday || sentToday.c < config.daily_cap) break;
          if (state.cancel) break;
          await sleep(60000);
        }
        if (state.cancel) break;

        // Build a batch of messages
        const batch = [];
        const batchSize = Math.min(TURBO_BATCH, recipients.length - i);
        for (let j = 0; j < batchSize; j++) {
          const num = recipients[i + j];
          const msgRecord = db.prepare("SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')")
            .get(broadcastId, num);
          if (!msgRecord) continue;
          const gw = gatewayMap[msgRecord.gateway_id] || gateways[0];
          batch.push({ num, msgRecord, gateway: gw });
        }
        i += batchSize;

        if (batch.length === 0) continue;

        // ── Release messages: PUSH goes directly, PULL goes to 'pending' ─
        const isRoundRobin = broadcastRecord.sim_mode === 'round-robin';
        const isParallel = broadcastRecord.sim_mode === 'parallel';

        // Pre-compute sim_mode for each message in the batch (per-gateway)
        const batchItems = batch.map(({ num, msgRecord, gateway }) => {
          const isPush = gateway && gateway.url && gateway.mode !== 'pull';
          const gid = gateway.id;
          let simMode;
          if (isRoundRobin) {
            if (distMode === 'round-robin' && gateways.length > 1) {
              // Combined gateway×SIM round-robin:
              //    GW1→SIM1 → GW1→SIM2 → GW2→SIM1 → GW2→SIM2 → ...
              const roundStartSim = broadcastRecord.sim_round_start || 'sim1';
              const numGateways = gateways.length;
              const simCycleIdx = Math.floor(combinedSimPos / numGateways) % 2;
              simMode = roundStartSim === 'sim2'
                ? (simCycleIdx === 0 ? 'sim2' : 'sim1')
                : (simCycleIdx === 0 ? 'sim1' : 'sim2');
              combinedSimPos++;
            } else {
              if (roundSimIdxMap[gid] === undefined) roundSimIdxMap[gid] = 0;
              const roundStartSim = broadcastRecord.sim_round_start || 'sim1';
              simMode = roundStartSim === 'sim2'
                ? (roundSimIdxMap[gid] % 2 === 0 ? 'sim2' : 'sim1')
                : (roundSimIdxMap[gid] % 2 === 0 ? 'sim1' : 'sim2');
              roundSimIdxMap[gid]++;
            }
          } else if (isParallel) {
            if (roundSimIdxMap[gid] === undefined) roundSimIdxMap[gid] = 0;
            const startSim = broadcastRecord.sim_round_start || 'sim1';
            const gwMid = Math.floor((gatewayMsgCounts[gid] || broadcastRecord.total) / 2);
            simMode = roundSimIdxMap[gid] < gwMid ? startSim : (startSim === 'sim1' ? 'sim2' : 'sim1');
            roundSimIdxMap[gid]++;
          } else {
            simMode = broadcastRecord.sim_mode || 'sim1';
          }
          return { num, msgRecord, gateway, isPush, simMode };
        });

        // Separate PUSH and PULL to send PUSH in parallel
        const pushItems = batchItems.filter(item => item.isPush);
        const pullItems = batchItems.filter(item => !item.isPush);

        // ── PULL gateways: release to 'pending' immediately ─
        for (const { num, msgRecord } of pullItems) {
          db.prepare("UPDATE messages SET status = 'pending' WHERE id = ? AND status IN ('queued', 'pending')").run(msgRecord.id);
          logActivity(broadcastRecord.agent_id, 'broadcast:queued', `Message queued for ${num} [Turbo]`, 'info', broadcastRecord.campaign_id);
        }

        // ── PUSH gateways: send ALL in parallel ─
        if (pushItems.length > 0) {
          const pushResults = await Promise.allSettled(
            pushItems.map(async ({ num, msgRecord, gateway, simMode }) => {
              const controller = new AbortController();
              const t = setTimeout(() => controller.abort(), 30000);
              try {
                const response = await fetch(`${gateway.url}/send`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
                  },
                  body: JSON.stringify({ to: num, message: msgRecord.message, sim_mode: simMode }),
                  signal: controller.signal,
                });
                clearTimeout(t);
                if (response.ok) {
                  db.prepare("UPDATE messages SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), msgRecord.id);
                  return { success: true, num, msgRecord };
                } else {
                  db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
                    'Gateway returned HTTP ' + response.status, msgRecord.id
                  );
                  return { success: false, num, msgRecord };
                }
              } catch (pushErr) {
                clearTimeout(t);
                db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
                  'Push failed: ' + (pushErr.message || 'timeout'), msgRecord.id
                );
                return { success: false, num, msgRecord };
              }
            })
          );

          // Tally results and log activity
          for (const result of pushResults) {
            if (result.status === 'fulfilled') {
              const r = result.value;
              if (r.success) {
                sent++;
                logActivity(broadcastRecord.agent_id, 'broadcast:queued', `Message sent to ${r.num} [Turbo]`, 'info', broadcastRecord.campaign_id);
              } else {
                failed++;
                logActivity(broadcastRecord.agent_id, 'broadcast:queued', `Message failed for ${r.num} [Turbo]`, 'warn', broadcastRecord.campaign_id);
              }
            } else {
              failed++;
            }
          }
        }

        broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending' });
      }
    } catch (e) {
      console.error('[broadcast-engine] Turbo error:', e);
      wasCancelled = true;
    }

    wasCancelled = wasCancelled || state.cancel;
    if (wasCancelled) {
      db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = ?, sent = ?, failed = ? WHERE id = ?")
        .run(new Date().toISOString(), sent, failed, broadcastId);
      broadcast({ type: 'broadcast:complete', broadcastId, status: 'cancelled', sent, failed, total, completed_at: new Date().toISOString() });
      logActivity(broadcastRecord.agent_id, 'broadcast:cancel',
        `Broadcast ${broadcastId} cancelled — ${sent}/${total} sent [Turbo]`,
        'warn', broadcastRecord.campaign_id);
      running.delete(broadcastId);
      onMessageAcked(broadcastId);
      return;
    }
  } else {
    // ── Normal mode: one-at-a-time with delay, PUSH in parallel batches ─
    const isParallelMode = broadcastRecord.sim_mode === 'parallel';
    const roundIdxMap = {};
    let normalCombinedPos = 0;
    let normalPushBatch = [];

    async function flushNormalPush() {
      if (normalPushBatch.length === 0) return;
      const items = normalPushBatch.splice(0);
      const results = await Promise.allSettled(
        items.map(async ({ number, msgRecord, gateway, simMode }) => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 30000);
          try {
            const response = await fetch(`${gateway.url}/send`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
              },
              body: JSON.stringify({ to: number, message: msgRecord.message, sim_mode: simMode }),
              signal: controller.signal,
            });
            clearTimeout(t);
            if (response.ok) {
              db.prepare("UPDATE messages SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), msgRecord.id);
              return { success: true };
            } else {
              db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
                'Gateway returned HTTP ' + response.status, msgRecord.id
              );
              return { success: false };
            }
          } catch (pushErr) {
            clearTimeout(t);
            db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(
              'Push failed: ' + (pushErr.message || 'timeout'), msgRecord.id
            );
            return { success: false };
          }
        })
      );
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.success) sent++;
        else failed++;
      }
    }

    for (const number of recipients) {
      if (state.cancel) {
        await flushNormalPush();
        db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = ?, sent = ?, failed = ? WHERE id = ?")
          .run(new Date().toISOString(), sent, failed, broadcastId);
        broadcast({ type: 'broadcast:complete', broadcastId, status: 'cancelled', sent, failed, total, completed_at: new Date().toISOString() });
        logActivity(broadcastRecord.agent_id, 'broadcast:cancel', `Broadcast ${broadcastId} cancelled — ${sent}/${total} sent`, 'warn', broadcastRecord.campaign_id);
        running.delete(broadcastId);
        return;
      }

      // ── Global pause check ────────────────────────────────────
      if (!state.paused) {
        const gpRow = db.prepare("SELECT value FROM settings WHERE key = 'broadcasts_globally_paused'").get();
        if (gpRow && gpRow.value === 'true') {
          state.paused = true;
          db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
          broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'paused' });
          logActivity(broadcastRecord.agent_id, 'broadcast:paused',
            `Broadcast paused — globally paused by admin.`,
            'warn', broadcastRecord.campaign_id);
        }
      }

      // ── Max duration check ────────────────────────────────────
      if (maxDurationMin > 0 && !state.cancel) {
        const elapsed = (Date.now() - startedMs) / 60000;
        if (elapsed >= maxDurationMin) {
          state.cancel = true;
          logActivity(broadcastRecord.agent_id, 'broadcast:cancel',
            `Broadcast auto-cancelled — exceeded max duration of ${maxDurationMin} minutes.`,
            'warn', broadcastRecord.campaign_id);
          continue;
        }
      }

      // ── Time window check (global admin window + per-broadcast schedule) ──
      while (true) {
        config = readConfig();
        const now = nowHHMM();
        const withinGlobal = now >= config.window_start && now <= config.window_end;
        const withinSchedule = (!scheduleStart || now >= scheduleStart) && (!scheduleEnd || now <= scheduleEnd);
        if (withinGlobal && withinSchedule) break;
        if (state.cancel) break;
        const phTimeDisplay = new Date().toLocaleTimeString('en-PH', { timeZone: getTimezone(), hour: '2-digit', minute: '2-digit', hour12: true });
        const windowLabel = scheduleStart
          ? `${scheduleStart}–${scheduleEnd || config.window_end} (scheduled)`
          : `${config.window_start}–${config.window_end}`;
        logActivity(broadcastRecord.agent_id, 'broadcast:paused',
          `Broadcast paused — outside sending window (${windowLabel}). Current time: ${phTimeDisplay}`,
          'info', broadcastRecord.campaign_id);
        await sleep(60000);
      }
      if (state.cancel) continue;

      // ── Pause check ────────────────────────────────────────────────────
      if (state.paused) {
        db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(broadcastId);
        broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'paused' });
        await new Promise((resolve) => { state._resume = resolve; });
        db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(broadcastId);
        broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: 'sending' });
      }

      // ── Daily cap check ───────────────────────────────────────────────
      const todayStr = new Date().toISOString().slice(0, 10);
      const lastReset = db.prepare("SELECT value FROM settings WHERE key = 'sent_today_date'").get();
      if (!lastReset || lastReset.value !== todayStr) {
        db.prepare('UPDATE gateways SET sent_today = 0').run();
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sent_today_date', ?)").run(todayStr);
      }
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

      const msgRecord = db.prepare("SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')")
        .get(broadcastId, number);
      if (!msgRecord) continue;

      const gateway = gatewayMap[msgRecord.gateway_id] || gateways[0];

      // ── Pre-send delay ────────────────────────────────────────────────
      await sleep(broadcastRecord.delay_ms);
      if (state.cancel) continue;

      // ── PUSH: buffer for parallel batch; PULL: release to 'pending' ─
      const isPush = gateway && gateway.url && gateway.mode !== 'pull';

      const gid = gateway.id;
      if (roundIdxMap[gid] === undefined) roundIdxMap[gid] = 0;

      if (isPush) {
        // Determine sim_mode based on broadcast mode (per-gateway)
        let simMode;
        if (broadcastRecord.sim_mode === 'round-robin') {
          const isCombined = broadcastRecord.distribution === 'round-robin' && gateways.length > 1;
          if (isCombined) {
            const roundStartSim = broadcastRecord.sim_round_start || 'sim1';
            const numGateways = gateways.length;
            const simCycleIdx = Math.floor(normalCombinedPos / numGateways) % 2;
            simMode = roundStartSim === 'sim2'
              ? (simCycleIdx === 0 ? 'sim2' : 'sim1')
              : (simCycleIdx === 0 ? 'sim1' : 'sim2');
          } else {
            const roundStartSim = broadcastRecord.sim_round_start || 'sim1';
            simMode = roundStartSim === 'sim2'
              ? (roundIdxMap[gid] % 2 === 0 ? 'sim2' : 'sim1')
              : (roundIdxMap[gid] % 2 === 0 ? 'sim1' : 'sim2');
          }
        } else if (isParallelMode) {
          const startSim = broadcastRecord.sim_round_start || 'sim1';
          const gwMid = Math.floor((gatewayMsgCounts[gid] || broadcastRecord.total) / 2);
          simMode = roundIdxMap[gid] < gwMid ? startSim : (startSim === 'sim1' ? 'sim2' : 'sim1');
        } else {
          simMode = broadcastRecord.sim_mode || 'sim1';
        }
        normalPushBatch.push({ number, msgRecord, gateway, simMode });
      } else {
        // PULL gateway — release to 'pending' so the phone picks it up
        db.prepare("UPDATE messages SET status = 'pending' WHERE id = ? AND status IN ('queued', 'pending')").run(msgRecord.id);
      }
      if (broadcastRecord.distribution === 'round-robin' && gateways.length > 1 && broadcastRecord.sim_mode === 'round-robin') {
        normalCombinedPos++;
      } else {
        roundIdxMap[gid]++; // increment per-gateway for ALL messages
      }

      // Flush PUSH batch when full (send all in parallel)
      if (normalPushBatch.length >= TURBO_BATCH) {
        await flushNormalPush();
      }
    }

    // Flush any remaining PUSH messages
    await flushNormalPush();
  }

  running.delete(broadcastId);

  // Settle completion from actual message state. Messages are 'pending'
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
    if (row.status === 'sent' || row.status === 'delivered') sent += row.c;
    else if (row.status === 'failed') failed = row.c;
    else if (row.status === 'queued' || row.status === 'pending' || row.status === 'sending') open += row.c;
  }
  const total = b.total;

  db.prepare('UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?').run(sent, failed, broadcastId);
  broadcast({ type: 'broadcast:progress', broadcastId, sent, failed, total, status: b.status });

  if (open === 0) {
    const completedAt = new Date().toISOString();
    db.prepare("UPDATE broadcasts SET status = 'done', completed_at = ?, sent = ?, failed = ? WHERE id = ?")
      .run(completedAt, sent, failed, broadcastId);
    broadcast({ type: 'broadcast:complete', broadcastId, status: 'done', sent, failed, total, completed_at: completedAt });
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
