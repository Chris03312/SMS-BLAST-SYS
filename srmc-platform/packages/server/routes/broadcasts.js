import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { fixTimestamps } from '../utils/fix-timestamps.js';
import { authMiddleware } from '../middleware/auth.js';
import { broadcastLimiter } from '../middleware/rate-limit.js';
import { startBroadcast, cancelBroadcast, pauseBroadcast, resumeBroadcast, getRunningCount } from '../services/broadcast-engine.js';
import { normalizePhone } from '../utils/phone.js';
import { broadcast as emitEvent } from '../services/ws.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;
    const search = req.query.search;
    const campaignId = req.query.campaign_id;

    let query = `
      SELECT b.*,
        u.display_name as agent_name,
        t.name as template_name,
        g.name as gateway_name,
        g.number as gateway_number,
        g.number2 as gateway_number2,
        c.name as campaign_name,
        (SELECT COUNT(*) FROM messages WHERE broadcast_id = b.id AND status = 'delivered') as delivered
      FROM broadcasts b
      LEFT JOIN users u ON b.agent_id = u.id
      LEFT JOIN templates t ON b.template_id = t.id
      LEFT JOIN gateways g ON b.gateway_id = g.id
      LEFT JOIN campaigns c ON b.campaign_id = c.id
    `;

    const conditions = [];
    const params = [];

    if (req.user.role === 'agent') {
      conditions.push('b.agent_id = ?');
      params.push(req.user.id);
    }

    if (status && status !== 'all') {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(b.message LIKE ? OR u.display_name LIKE ? OR c.name LIKE ? OR g.name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (campaignId) {
      conditions.push('b.campaign_id = ?');
      params.push(campaignId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const broadcasts = db.prepare(query).all(...params);
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM broadcasts b
       LEFT JOIN users u ON b.agent_id = u.id
       LEFT JOIN gateways g ON b.gateway_id = g.id
       LEFT JOIN campaigns c ON b.campaign_id = c.id
       ${conditions.length > 0 ? 'WHERE ' + conditions.slice(0, conditions.length).join(' AND ') : ''}`
    ).get(...params.slice(0, -2));

    return ok(res, { broadcasts: fixTimestamps(broadcasts), total: total ? total.c : 0, limit, offset });
  } catch (e) {
    console.error('[broadcasts] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.get('/running/list', (req, res) => {
  try {
    let runningSql = `
      SELECT b.id, b.status, b.sent, b.failed, b.total, b.message, b.delay_ms, b.created_at,
              u.display_name as agent_name,
              c.name as campaign_name,
              g.name as gateway_name, g.number as gateway_number, g.number2 as gateway_number2
       FROM broadcasts b
       LEFT JOIN users u ON b.agent_id = u.id
       LEFT JOIN campaigns c ON b.campaign_id = c.id
       LEFT JOIN gateways g ON b.gateway_id = g.id
       WHERE b.status IN ('pending', 'sending', 'paused')
    `;
    const params = [];
    if (req.user.role === 'agent') {
      runningSql += ' AND b.agent_id = ?';
      params.push(req.user.id);
    }
    runningSql += ' ORDER BY b.created_at DESC';
    const running = db.prepare(runningSql).all(...params);
    return ok(res, { broadcasts: fixTimestamps(running) });
  } catch (e) {
    console.error('[broadcasts] GET /running error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Get per-recipient message details for a broadcast ───────────────
router.get('/:id/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status;

    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    let query = `
      SELECT m.id, m.to_number, m.status, m.error, m.sent_at, m.created_at,
             g.name as gateway_name, g.number as gateway_number, g.number2 as gateway_number2
      FROM messages m
      LEFT JOIN gateways g ON m.gateway_id = g.id
      WHERE m.broadcast_id = ?
    `;
    const params = [req.params.id];

    if (status && status !== 'all') {
      query += ' AND m.status = ?';
      params.push(status);
    }

    query += ' ORDER BY m.created_at ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = db.prepare(query).all(...params);
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE broadcast_id = ?${status && status !== 'all' ? ' AND status = ?' : ''}`
    ).get(req.params.id, ...(status && status !== 'all' ? [status] : []));

    return ok(res, {
      messages: fixTimestamps(messages),
      total: total ? total.c : 0,
      limit,
      offset,
      broadcast: { id: broadcast.id, message: broadcast.message, total: broadcast.total },
    });
  } catch (e) {
    console.error('[broadcasts] GET /:id/messages error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.get('/:id', (req, res) => {
  try {
    const broadcast = db.prepare(`
      SELECT b.*,
        u.display_name as agent_name,
        t.name as template_name,
        g.name as gateway_name,
        g.number as gateway_number,
        g.number2 as gateway_number2,
        c.name as campaign_name
      FROM broadcasts b
      LEFT JOIN users u ON b.agent_id = u.id
      LEFT JOIN templates t ON b.template_id = t.id
      LEFT JOIN gateways g ON b.gateway_id = g.id
      LEFT JOIN campaigns c ON b.campaign_id = c.id
      WHERE b.id = ?
    `).get(req.params.id);

    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    const messages = db.prepare('SELECT * FROM messages WHERE broadcast_id = ? ORDER BY created_at ASC').all(req.params.id);

    return ok(res, { ...fixTimestamps(broadcast), messages: fixTimestamps(messages) });
  } catch (e) {
    console.error('[broadcasts] GET/:id error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', broadcastLimiter, async (req, res) => {
  try {
    const { gateway_ids, gateway_id, template_id, message, recipients, delay_ms, campaign_id, distribution, sim_mode, sim_round_start, send_start_at, send_end_at } = req.body;
    const distMode = distribution === 'linear' ? 'linear' : 'round-robin';
    const resolvedSimMode = sim_mode === 'sim2' ? 'sim2' : sim_mode === 'round-robin' ? 'round-robin' : sim_mode === 'parallel' ? 'parallel' : 'sim1';
    const resolvedStartAt = (send_start_at && send_start_at !== '') ? send_start_at : null;
    const resolvedEndAt = (send_end_at && send_end_at !== '') ? send_end_at : null;

    const rawGatewayIds = Array.isArray(gateway_ids) && gateway_ids.length > 0
      ? gateway_ids
      : gateway_id ? [gateway_id] : [];

    if (rawGatewayIds.length === 0 || !message || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return fail(res, 'At least one gateway, a message, and recipients[] are required', 400);
    }

    // ── Agent broadcast cap check (active broadcasts) ────────────────────
    if (req.user.role === 'agent') {
      const maxSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_broadcasts_per_agent'").get();
      const maxPerAgent = parseInt(maxSetting?.value) || 5;
      if (maxPerAgent > 0) {
        const agentCount = db.prepare(
          "SELECT COUNT(*) as c FROM broadcasts WHERE agent_id = ? AND status IN ('pending', 'sending', 'paused')"
        ).get(req.user.id);
        if (agentCount && agentCount.c >= maxPerAgent) {
          return fail(res, `Active broadcast limit reached (${maxPerAgent}). Cancel or complete existing broadcasts first.`, 429);
        }
      }
    }

    // ── Max broadcasts per day (agent) ────────────────────────────────────
    if (req.user.role === 'agent') {
      const perDaySetting = db.prepare("SELECT value FROM settings WHERE key = 'max_broadcasts_per_day_per_agent'").get();
      const perDay = parseInt(perDaySetting?.value) || 0;
      if (perDay > 0) {
        const todayCount = db.prepare(
          "SELECT COUNT(*) as c FROM broadcasts WHERE agent_id = ? AND created_at >= (date('now') || ' 00:00:00') AND created_at < (date('now', '+1 day') || ' 00:00:00')"
        ).get(req.user.id);
        if (todayCount && todayCount.c >= perDay) {
          return fail(res, `Daily broadcast limit reached (${perDay} today). Wait until tomorrow or ask an admin to increase the limit.`, 429);
        }
      }
    }

    // ── Global pause check ───────────────────────────────────────────────
    const pauseSetting = db.prepare("SELECT value FROM settings WHERE key = 'broadcasts_globally_paused'").get();
    if (pauseSetting && pauseSetting.value === 'true') {
      return fail(res, 'Broadcasting is globally paused by the admin. No new broadcasts can be created.', 503);
    }

    const validGateways = rawGatewayIds
      .map(id => db.prepare('SELECT * FROM gateways WHERE id = ? AND active = 1').get(id))
      .filter(Boolean);

    if (validGateways.length === 0) {
      return fail(res, 'No valid active gateways selected', 400);
    }

    const validRecipients = recipients
      .map(r => normalizePhone(String(r).trim()))
      .filter(r => r.length >= 7);

    if (validRecipients.length === 0) {
      return fail(res, 'No valid recipients', 400);
    }

    // ── Max recipients per broadcast check ────────────────────────────────
    const maxRecipSetting = db.prepare("SELECT value FROM settings WHERE key = 'max_recipients_per_broadcast'").get();
    const maxRecip = parseInt(maxRecipSetting?.value) || 0;
    if (maxRecip > 0 && validRecipients.length > maxRecip) {
      return fail(res, `Too many recipients (${validRecipients.length}). Maximum allowed per broadcast is ${maxRecip}.`, 400);
    }

    // Read default delay from admin settings if not explicitly provided
    let resolvedDelay = delay_ms;
    if (!resolvedDelay) {
      const setting = db.prepare("SELECT value FROM settings WHERE key = 'delay'").get();
      resolvedDelay = setting ? parseInt(setting.value) : 6000;
    }

    const broadcastId = uuidv4();
    const primaryGwId = validGateways[0].id;

    db.prepare(`INSERT INTO broadcasts (id, agent_id, campaign_id, template_id, gateway_id, gateway_ids, distribution, message, recipients, total, delay_ms, status, sim_mode, sim_round_start, send_start_at, send_end_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(
        broadcastId,
        req.user.id,
        campaign_id || null,
        template_id || null,
        primaryGwId,
        JSON.stringify(validGateways.map(g => g.id)),
        distMode,
        message,
        JSON.stringify(validRecipients),
        validRecipients.length,
        resolvedDelay,
        resolvedSimMode,
        sim_round_start === 'sim2' ? 'sim2' : 'sim1',
        resolvedStartAt,
        resolvedEndAt
      );

    const total = validRecipients.length;
    const chunkSize = Math.ceil(total / validGateways.length);

    const insertMsg = db.prepare('INSERT INTO messages (id, broadcast_id, to_number, message, gateway_id) VALUES (?, ?, ?, ?, ?)');
    const insertMany = db.transaction(() => {
      validRecipients.forEach((num, i) => {
        const gw = distMode === 'linear'
          ? validGateways[Math.min(Math.floor(i / chunkSize), validGateways.length - 1)]
          : validGateways[i % validGateways.length];
        insertMsg.run(uuidv4(), broadcastId, num, message, gw.id);
      });
    });
    insertMany();

    if (template_id) {
      db.prepare('UPDATE templates SET use_count = use_count + 1 WHERE id = ?').run(template_id);
    }

    // ── Boss numbers: auto-notify from template ────────────────────────
    if (template_id) {
      const template = db.prepare('SELECT boss_numbers FROM templates WHERE id = ?').get(template_id);
      if (template && template.boss_numbers) {
        const bossNums = template.boss_numbers
          .split('\n')
          .map(s => normalizePhone(s.trim()))
          .filter(s => s.length >= 7);

        if (bossNums.length > 0) {
          const insertBoss = db.transaction(() => {
            for (const num of bossNums) {
              // Use the first gateway for boss notifications
              const gw = validGateways[0];
              insertMsg.run(uuidv4(), broadcastId, num, message, gw.id);
            }
          });
          insertBoss();

          // Update broadcast total & recipients so the engine sends to them
          const updatedRecipients = [...validRecipients, ...bossNums];
          db.prepare('UPDATE broadcasts SET total = ?, recipients = ? WHERE id = ?')
            .run(updatedRecipients.length, JSON.stringify(updatedRecipients), broadcastId);
        }
      }
    }

    const broadcastRecord = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);

    setImmediate(() => startBroadcast(broadcastId));

    return ok(res, { broadcast: broadcastRecord }, 201);
  } catch (e) {
    console.error('[broadcasts] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Check which recipients have been sent to before ────────────────────
// Used by the Compose page to warn when some numbers have already been messaged.
router.post('/check-recipients', (req, res) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return fail(res, 'No numbers provided');
    }

    // Query which of the given numbers have been sent/delivered in previous
    // broadcasts for this agent — using IN with parameter placeholders.
    const placeholders = numbers.map(() => '?').join(',');
    const existing = db.prepare(
      `SELECT DISTINCT m.to_number FROM messages m
       JOIN broadcasts b ON m.broadcast_id = b.id
       WHERE b.agent_id = ? AND m.to_number IN (${placeholders})
       AND m.status IN ('sent', 'delivered')`
    ).all(req.user.id, ...numbers);

    const alreadySent = existing.map(r => r.to_number);

    return ok(res, {
      already_sent: alreadySent,
      total: alreadySent.length,
    });
  } catch (e) {
    console.error('[broadcasts] check-recipients error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Get running broadcast count ────────────────────────────────────────

router.get('/running/count', (req, res) => {
  return ok(res, { count: getRunningCount() });
});

// ── Delete a broadcast ──────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  try {
    const bcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!bcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && bcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    // Stop the engine if this broadcast is actively sending
    cancelBroadcast(req.params.id);

    // Soft-delete: mark as 'deleted' so it stays visible in History page
    db.prepare("UPDATE broadcasts SET status = 'deleted', completed_at = datetime('now') WHERE id = ?").run(req.params.id);

    // Notify frontend so it can update UIs
    emitEvent({
      type: 'broadcast:complete',
      broadcastId: req.params.id,
      status: 'deleted',
      sent: bcast.sent || 0,
      failed: bcast.failed || 0,
      total: bcast.total || 0,
    });

    return ok(res, { success: true });
  } catch (e) {
    console.error('[broadcasts] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Cancel ALL active broadcasts (admin only) ───────────────────────

router.post('/cancel-all', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return fail(res, 'Access denied', 403);
    }

    const activeBcasts = db.prepare("SELECT * FROM broadcasts WHERE status IN ('sending', 'paused')").all();

    for (const bcast of activeBcasts) {
      // Stop the engine
      cancelBroadcast(bcast.id);

      // Mark as cancelled — keep data for history
      db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?").run(bcast.id);
      db.prepare("UPDATE messages SET status = 'cancelled' WHERE broadcast_id = ? AND status NOT IN ('sent', 'delivered')").run(bcast.id);

      // Notify frontend
      emitEvent({
        type: 'broadcast:complete',
        broadcastId: bcast.id,
        status: 'cancelled',
        sent: bcast.sent || 0,
        failed: bcast.failed || 0,
        total: bcast.total || 0,
        agent_id: bcast.agent_id,
      });
    }

    return ok(res, { success: true, cancelled: activeBcasts.length });
  } catch (e) {
    console.error('[broadcasts] CANCEL ALL error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Soft-cancel a broadcast (keeps data, used by History page) ──────

router.post('/:id/cancel', (req, res) => {
  try {
    const bcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!bcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && bcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    // Stop the engine
    cancelBroadcast(req.params.id);

    // Mark as cancelled — keep data for history
    db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?").run(req.params.id);
    // Mark non-sent messages as cancelled (keep already sent/delivered as-is)
    db.prepare("UPDATE messages SET status = 'cancelled' WHERE broadcast_id = ? AND status NOT IN ('sent', 'delivered')").run(req.params.id);

    emitEvent({
      type: 'broadcast:complete',
      broadcastId: req.params.id,
      status: 'cancelled',
      sent: bcast.sent || 0,
      failed: bcast.failed || 0,
      total: bcast.total || 0,
    });

    return ok(res, { success: true, status: 'cancelled' });
  } catch (e) {
    console.error('[broadcasts] CANCEL error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Pause a running broadcast ───────────────────────────────────────────────

router.post('/:id/pause', (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    if (broadcast.status !== 'sending') {
      return fail(res, 'Broadcast is not currently sending', 400);
    }

    pauseBroadcast(req.params.id);
    return ok(res, { success: true, status: 'paused' });
  } catch (e) {
    console.error('[broadcasts] PAUSE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Resume a paused broadcast ───────────────────────────────────────────────

router.post('/:id/resume', (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    if (broadcast.status !== 'paused') {
      return fail(res, 'Broadcast is not paused', 400);
    }

    resumeBroadcast(req.params.id);
    return ok(res, { success: true, status: 'sending' });
  } catch (e) {
    console.error('[broadcasts] RESUME error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Bulk cancel selected broadcasts ───────────────────────────────────
// POST /api/broadcasts/cancel-selected
// Body: { ids: ["id1", "id2", ...] }
router.post('/cancel-selected', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return fail(res, 'No broadcast IDs provided', 400);
    }

    let cancelled = 0;
    for (const id of ids) {
      const bcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id);
      if (!bcast) continue;

      // Check access
      if (req.user.role === 'agent' && bcast.agent_id !== req.user.id) continue;

      // Only cancel active broadcasts
      if (bcast.status !== 'sending' && bcast.status !== 'paused') continue;

      cancelBroadcast(id);
      db.prepare("UPDATE broadcasts SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?").run(id);
      db.prepare("UPDATE messages SET status = 'cancelled' WHERE broadcast_id = ? AND status NOT IN ('sent', 'delivered')").run(id);

      emitEvent({
        type: 'broadcast:complete',
        broadcastId: id,
        status: 'cancelled',
        sent: bcast.sent || 0,
        failed: bcast.failed || 0,
        total: bcast.total || 0,
        agent_id: bcast.agent_id,
      });
      cancelled++;
    }

    return ok(res, { success: true, cancelled });
  } catch (e) {
    console.error('[broadcasts] CANCEL SELECTED error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Clone a broadcast ────────────────────────────────────────────────
// POST /api/broadcasts/:id/clone
// Creates a new broadcast with the same settings as the original.
router.post('/:id/clone', (req, res) => {
  try {
    const original = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!original) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && original.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    const newId = uuidv4();
    const now = new Date().toISOString();

    // Clone the broadcast with same settings but new status
    db.prepare(`INSERT INTO broadcasts (id, agent_id, campaign_id, template_id, gateway_id, gateway_ids, distribution, message, recipients, total, delay_ms, status, sim_mode, sim_round_start, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(
        newId,
        original.agent_id,
        original.campaign_id,
        original.template_id,
        original.gateway_id,
        original.gateway_ids,
        original.distribution || 'round-robin',
        original.message,
        original.recipients,
        original.total,
        original.delay_ms,
        original.sim_mode || 'sim1',
        original.sim_round_start || 'sim1',
        now
      );

    // Clone all messages
    const messages = db.prepare('SELECT to_number, message, gateway_id FROM messages WHERE broadcast_id = ?').all(req.params.id);
    const insertMsg = db.prepare('INSERT INTO messages (id, broadcast_id, to_number, message, gateway_id) VALUES (?, ?, ?, ?, ?)');
    const cloneMessages = db.transaction(() => {
      for (const m of messages) {
        insertMsg.run(uuidv4(), newId, m.to_number, m.message, m.gateway_id);
      }
    });
    cloneMessages();

    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(newId);
    return ok(res, { broadcast }, 201);
  } catch (e) {
    console.error('[broadcasts] CLONE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Export broadcast as CSV ─────────────────────────────────────────
// GET /api/broadcasts/:id/export
// Returns a CSV file with all message results.
router.get('/:id/export', (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    const messages = db.prepare(
      'SELECT to_number, status, error, sent_at, created_at FROM messages WHERE broadcast_id = ? ORDER BY created_at ASC'
    ).all(req.params.id);

    // Build CSV
    const header = 'Phone Number,Status,Error,Sent At,Created At\n';
    const rows = messages.map(m => {
      const sentAt = m.sent_at ? m.sent_at.replace('T', ' ').slice(0, 19) : '';
      const createdAt = m.created_at ? m.created_at.replace('T', ' ').slice(0, 19) : '';
      const error = m.error || '';
      // Escape commas and quotes in error field
      const escapedError = error.includes(',') || error.includes('"') ? `"${error.replace(/"/g, '""')}"` : error;
      return `${m.to_number},${m.status},${escapedError},${sentAt},${createdAt}`;
    }).join('\n');

    const csv = `\uFEFF${header}${rows}`; // BOM for Excel UTF-8 support

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="broadcast-${req.params.id.slice(0, 8)}.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error('[broadcasts] EXPORT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;