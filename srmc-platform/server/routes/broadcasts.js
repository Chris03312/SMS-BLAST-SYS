import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { fixTimestamps } from '../fix-timestamps.js';
import { authMiddleware } from '../middleware/auth.js';
import { startBroadcast, cancelBroadcast, pauseBroadcast, resumeBroadcast, getRunningCount } from '../broadcast-engine.js';
import { normalizePhone } from '../phone.js';

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
      conditions.push('(b.message LIKE ? OR u.display_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
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
      `SELECT COUNT(*) as c FROM broadcasts b ${conditions.length > 0 ? 'WHERE ' + conditions.slice(0, conditions.length).join(' AND ') : ''}`
    ).get(...params.slice(0, -2));

    return ok(res, { broadcasts: fixTimestamps(broadcasts), total: total ? total.c : 0, limit, offset });
  } catch (e) {
    console.error('[broadcasts] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.get('/running/list', (req, res) => {
  try {
    const running = db.prepare(
      `SELECT b.id, b.status, b.sent, b.failed, b.total, b.message, b.delay_ms, b.created_at,
              c.name as campaign_name, g.number as gateway_number
       FROM broadcasts b
       LEFT JOIN campaigns c ON b.campaign_id = c.id
       LEFT JOIN gateways g ON b.gateway_id = g.id
       WHERE b.status IN ('pending', 'sending', 'paused')
       ORDER BY b.created_at DESC`
    ).all();
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

router.post('/', async (req, res) => {
  try {
    const { gateway_ids, gateway_id, template_id, message, recipients, delay_ms, campaign_id, distribution } = req.body;
    const distMode = distribution === 'linear' ? 'linear' : 'round-robin';

    const rawGatewayIds = Array.isArray(gateway_ids) && gateway_ids.length > 0
      ? gateway_ids
      : gateway_id ? [gateway_id] : [];

    if (rawGatewayIds.length === 0 || !message || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return fail(res, 'At least one gateway, a message, and recipients[] are required', 400);
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

    // Read default delay from admin settings if not explicitly provided
    let resolvedDelay = delay_ms;
    if (!resolvedDelay) {
      const setting = db.prepare("SELECT value FROM settings WHERE key = 'delay'").get();
      resolvedDelay = setting ? parseInt(setting.value) : 6000;
    }

    const broadcastId = uuidv4();
    const primaryGwId = validGateways[0].id;

    db.prepare(`INSERT INTO broadcasts (id, agent_id, campaign_id, template_id, gateway_id, gateway_ids, distribution, message, recipients, total, delay_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
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
        resolvedDelay
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

    const broadcastRecord = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId);

    setImmediate(() => startBroadcast(broadcastId));

    return ok(res, { broadcast: broadcastRecord }, 201);
  } catch (e) {
    console.error('[broadcasts] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Get running broadcast count ────────────────────────────────────────

router.get('/running/count', (req, res) => {
  return ok(res, { count: getRunningCount() });
});

router.delete('/:id', (req, res) => {
  try {
    const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!broadcast) {
      return fail(res, 'Broadcast not found', 404);
    }

    if (req.user.role === 'agent' && broadcast.agent_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    cancelBroadcast(req.params.id);

    // Always update DB — this is the authoritative cancel.
    // The engine's in-memory cancel flag is advisory; the DB status
    // is what the system checks for completion. This ensures cancel
    // always works even if the engine's cancel handler is mid-batch.
    if (broadcast.status === 'pending' || broadcast.status === 'sending' || broadcast.status === 'paused') {
      db.prepare(`UPDATE broadcasts SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`).run(req.params.id);
      broadcast({ type: 'broadcast:complete', broadcastId: req.params.id, status: 'cancelled', sent: broadcast.sent || 0, failed: broadcast.failed || 0, total: broadcast.total || 0 });
    }

    return ok(res, { success: true });
  } catch (e) {
    console.error('[broadcasts] DELETE error:', e);
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

export default router;
