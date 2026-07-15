import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import db from '../database/db.js';
import { fixTimestamps } from '../utils/fix-timestamps.js';
import { authMiddleware } from '../middleware/auth.js';
import { webhookLimiter } from '../middleware/rate-limit.js';
import { broadcast } from '../services/ws.js';
import { validateInboundToken } from '../services/gateway-service.js';

const router = Router();

// ── Helper: wrap responses in { success, data } format ───────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── Enrich inbound messages with linked broadcast context ────────────
// Batches all lookups into a single query to avoid N+1.
function enrichInboundMessages(messages) {
  const numbers = [...new Set(messages.map(m => m.from_number).filter(Boolean))];
  if (numbers.length === 0) return;

  const placeholders = numbers.map(() => '?').join(', ');
  const linkedRows = db.prepare(`
    SELECT m.to_number, m.broadcast_id, m.message AS outbound_message, m.sent_at,
           b.message AS broadcast_message, b.agent_id
    FROM messages m
    LEFT JOIN broadcasts b ON b.id = m.broadcast_id
    WHERE m.to_number IN (${placeholders})
      AND m.rowid = (
        SELECT MAX(rowid) FROM messages WHERE to_number = m.to_number
      )
  `).all(...numbers);

  const linkedMap = {};
  for (const row of linkedRows) {
    linkedMap[row.to_number] = row;
  }

  for (const msg of messages) {
    if (linkedMap[msg.from_number]) {
      msg.linked_broadcast = linkedMap[msg.from_number];
    }
  }
}

// ── Get inbound messages ─────────────────────────────────────────────

router.get('/inbound', authMiddleware, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const flag = req.query.flag;
    const unread = req.query.unread;
    const unique = req.query.unique === '1';

    // Build WHERE conditions
    const conditions = [];
    const params = [];

    if (flag && flag !== 'all') {
      if (flag === 'unread') {
        conditions.push('inbound.read_at IS NULL');
      } else {
        conditions.push('inbound.flag = ?');
        params.push(flag);
      }
    }

    if (unread === '1') {
      conditions.push('inbound.read_at IS NULL');
    }

    // Agents only see inbound messages linked to their own broadcasts.
    // Admins see all inbound messages (including unlinked ones).
    if (req.user.role === 'agent') {
      conditions.push('inbound.agent_id = ?');
      params.push(req.user.id);
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    if (unique) {
      // ── Unique mode: one row per (phone number + gateway) pair ──
      // Same number from different gateways shows up as separate rows.
      // Uses MAX(rowid) per group for reliable dedup (higher rowid = later insert).
      const uniqueQuery = `
        SELECT inbound.*, gateways.name AS gateway_name, gateways.number AS gateway_number,
               gateways.sim_carrier, gateways.sim2_carrier
        FROM inbound
        LEFT JOIN gateways ON inbound.gateway_id = gateways.id
        WHERE inbound.rowid IN (
          SELECT MAX(i.rowid)
          FROM inbound i
          ${whereClause.replace(/inbound\./g, 'i.')}
          GROUP BY i.from_number, i.gateway_id
        )
        ORDER BY inbound.created_at DESC
        LIMIT ? OFFSET ?
      `;
      const messages = db.prepare(uniqueQuery).all(...params, limit, offset);

      enrichInboundMessages(messages);

      // Count unique (number + gateway) combinations
      const countUnique = `
        SELECT COUNT(*) as c FROM (
          SELECT 1 FROM inbound i
          ${whereClause.replace(/inbound\./g, 'i.')}
          GROUP BY i.from_number, i.gateway_id
        )
      `;
      const total = db.prepare(countUnique).get(...params);

      return ok(res, { messages: fixTimestamps(messages), total: total ? total.c : 0 });
    }

    // ── Normal mode: all messages, no dedup ──
    let query = 'SELECT inbound.*, gateways.name AS gateway_name, gateways.number AS gateway_number, gateways.sim_carrier, gateways.sim2_carrier';
    let fromClause = ' FROM inbound LEFT JOIN gateways ON inbound.gateway_id = gateways.id';
    query += fromClause + whereClause;
    query += ' ORDER BY inbound.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const messages = db.prepare(query).all(...params);

    enrichInboundMessages(messages);

    let countQuery = 'SELECT COUNT(*) as c FROM inbound LEFT JOIN gateways ON inbound.gateway_id = gateways.id' + whereClause;
    const total = db.prepare(countQuery).get(...params.slice(0, -2));

    return ok(res, { messages: fixTimestamps(messages), total: total ? total.c : 0 });
  } catch (e) {
    console.error('[inbound] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Shared webhook handler ────────────────────────────────────────────
// Accepts two payload formats:
//   1. Android gateway format:  { sender, message }   (Bearer token auth)
//   2. Original format:         { from, body, gateway_id }  (no auth)
//
// The Android InboundSmsReceiver POSTs with:
//   - Body: { sender: "+639xx...", message: "STOP" }
//   - Auth: Authorization: Bearer <inboundToken>
//
// This is used by both:
//   POST /webhook/inbound  — main webhook (used by ngrok URL)
//   POST /inbound          — LAN fallback (used when no ngrok)

function handleInboundWebhook(req, res) {
  try {
    let { sender, message, from, body, gateway_id, sim_slot } = req.body;

    let gatewayId = gateway_id;

    // ── Android gateway format — validate Bearer token ────────────────
    if (sender && message && !from) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return fail(res, 'Missing or invalid Authorization header for gateway webhook', 401);
      }
      const token = authHeader.slice(7);
      const payload = validateInboundToken(token);
      if (!payload) {
        return fail(res, 'Invalid or expired inbound token', 401);
      }
      gatewayId = payload.gatewayId;
    }

    // Normalize field names
    const finalSender = from || sender;
    const finalBody = body || message;

    if (!finalSender || !finalBody) {
      return fail(res, 'Sender (from/sender) and body/message are required', 400);
    }

    let flag = null;
    const upperBody = finalBody.toUpperCase().trim();
    if (upperBody === 'STOP') {
      flag = 'opt-out';
    } else if (upperBody.startsWith('YES')) {
      flag = 'confirmed';
    } else {
      flag = 'needs-reply';
    }

    const id = uuidv4();

    // Look up which agent sent the most recent broadcast to this number,
    // so the inbound message is only visible to the correct agent.
    let agentId = null;
    const senderMsg = db.prepare(`
      SELECT b.agent_id FROM messages m
      LEFT JOIN broadcasts b ON b.id = m.broadcast_id
      WHERE m.to_number = ? AND b.agent_id IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 1
    `).get(finalSender);
    if (senderMsg) agentId = senderMsg.agent_id;

    // If no broadcast was sent to this number, try linking to the gateway's
    // owner instead. This ensures Lite app inbound messages are visible to
    // the agent who added the gateway, even if no broadcast was sent yet.
    //
    // Fallback chain:
    //   1. Try gatewayId as a gateway device ID → get its owner_id
    //   2. Try gatewayId as a user UUID → find any gateway owned by this user
    //   3. Try gatewayId as a user UUID directly → use it as agent_id
    //
    // Step 3 is critical for the main Android app's inbound flow:
    //   - Agent logs in → JWT contains gatewayId = agent's user UUID
    //   - Admin added the gateway → owner_id = admin UUID (not agent UUID)
    //   - Steps 1-2 fail to match → without step 3, agentId stays null
    if (!agentId && gatewayId) {
      // Try as gateway device ID first
      const gw = db.prepare('SELECT owner_id FROM gateways WHERE id = ?').get(gatewayId);
      if (gw && gw.owner_id) {
        agentId = gw.owner_id;
      } else {
        // gatewayId might be a user UUID from the login token —
        // find any gateway owned by this user
        const gwByOwner = db.prepare('SELECT owner_id FROM gateways WHERE owner_id = ? AND active = 1 LIMIT 1').get(gatewayId);
        if (gwByOwner) {
          agentId = gatewayId;
        } else {
          // Final fallback: gatewayId IS the agent's user UUID from the
          // login token. No gateway ownership check needed — the JWT was
          // validated, so this is a legitimate agent.
          const user = db.prepare('SELECT id FROM users WHERE id = ?').get(gatewayId);
          if (user) {
            agentId = gatewayId;
          }
        }
      }
    }

    const simSlot = parseInt(sim_slot) || 0;

    db.prepare('INSERT INTO inbound (id, from_number, body, flag, agent_id, gateway_id, sim_slot) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, finalSender, finalBody, flag, agentId, gatewayId || null, simSlot);

    const messageRecord = db.prepare(`
      SELECT inbound.*, gateways.name AS gateway_name, gateways.number AS gateway_number,
             gateways.sim_carrier, gateways.sim2_carrier
      FROM inbound
      LEFT JOIN gateways ON inbound.gateway_id = gateways.id
      WHERE inbound.id = ?
    `).get(id);
    // Enrich the broadcast message so the client gets linked_broadcast on real-time pushes too
    enrichInboundMessages([messageRecord]);

    // Fix timestamps before broadcasting so the frontend can sort correctly
    // Raw SQLite dates ("2026-07-12 10:30:00") sort differently from ISO dates
    // ("2026-07-12T10:30:00Z") when parsed by new Date().
    const fixedRecord = fixTimestamps(messageRecord);

    // Only broadcast to relevant clients — admins get all, agents filter on their side
    broadcast({ type: 'inbound:new', message: fixedRecord });

    return ok(res, { message: messageRecord });
  } catch (e) {
    console.error('[inbound] webhook error:', e);
    return fail(res, 'Internal server error', 500);
  }
}

// Main webhook endpoint (used by ngrok URL via /api/webhook/inbound)
router.post('/webhook/inbound', webhookLimiter, handleInboundWebhook);

// Per-gateway webhook endpoint — each gateway gets its own URL with its ID
// e.g. POST /api/webhook/inbound/gateway_abc123
// This allows the server to identify the gateway from the URL path, making
// multiple gateways share a single ngrok tunnel.
router.post('/webhook/inbound/:gatewayId', webhookLimiter, (req, res) => {
  try {
    const { gatewayId } = req.params;
    if (!gatewayId) {
      return fail(res, 'Gateway ID is required', 400);
    }

    let { sender, message, from, body, sim_slot } = req.body;
    const finalSender = from || sender;
    const finalBody   = body || message;

    if (!finalSender || !finalBody) {
      return fail(res, 'Sender (from/sender) and body/message are required', 400);
    }

    let flag = null;
    const upperBody = finalBody.toUpperCase().trim();
    if (upperBody === 'STOP') {
      flag = 'opt-out';
    } else if (upperBody.startsWith('YES')) {
      flag = 'confirmed';
    } else {
      flag = 'needs-reply';
    }

    const id = uuidv4();

    // Look up which agent sent the most recent broadcast to this number
    let agentId = null;
    const senderMsg = db.prepare(`
      SELECT b.agent_id FROM messages m
      LEFT JOIN broadcasts b ON b.id = m.broadcast_id
      WHERE m.to_number = ? AND b.agent_id IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 1
    `).get(finalSender);
    if (senderMsg) agentId = senderMsg.agent_id;

    // If no broadcast was sent to this number, fall back to the gateway's owner
    if (!agentId && gatewayId) {
      const gw = db.prepare('SELECT owner_id FROM gateways WHERE id = ?').get(gatewayId);
      if (gw && gw.owner_id) {
        agentId = gw.owner_id;
      } else {
        // gatewayId might be a user UUID — find any gateway owned by this user
        const gwByOwner = db.prepare('SELECT owner_id FROM gateways WHERE owner_id = ? AND active = 1 LIMIT 1').get(gatewayId);
        if (gwByOwner) {
          agentId = gatewayId;
        } else {
          // Final fallback: gatewayId is the agent's user UUID directly
          const user = db.prepare('SELECT id FROM users WHERE id = ?').get(gatewayId);
          if (user) {
            agentId = gatewayId;
          }
        }
      }
    }

    const simSlot = parseInt(sim_slot) || 0;

    db.prepare('INSERT INTO inbound (id, from_number, body, flag, agent_id, gateway_id, sim_slot) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, finalSender, finalBody, flag, agentId, gatewayId || null, simSlot);

    const messageRecord = db.prepare(`
      SELECT inbound.*, gateways.name AS gateway_name, gateways.number AS gateway_number,
             gateways.sim_carrier, gateways.sim2_carrier
      FROM inbound
      LEFT JOIN gateways ON inbound.gateway_id = gateways.id
      WHERE inbound.id = ?
    `).get(id);
    enrichInboundMessages([messageRecord]);

    // Fix timestamps before broadcasting so the frontend can sort correctly
    const fixedRecord = fixTimestamps(messageRecord);

    broadcast({ type: 'inbound:new', message: fixedRecord });

    return ok(res, { message: messageRecord });
  } catch (e) {
    console.error('[inbound] per-gateway webhook error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// LAN fallback endpoint (used by Android when no ngrok via /api/inbound)
router.post('/inbound', webhookLimiter, handleInboundWebhook);

// ── Mark inbound message read / update ───────────────────────────────

router.put('/inbound/:id', authMiddleware, (req, res) => {
  try {
    const inbound = db.prepare('SELECT * FROM inbound WHERE id = ?').get(req.params.id);
    if (!inbound) {
      return fail(res, 'Message not found', 404);
    }

    const { flag, read } = req.body;
    const updates = {};
    if (flag !== undefined) updates.flag = flag;
    if (read) updates.read_at = new Date().toISOString();

    if (Object.keys(updates).length === 0) {
      return fail(res, 'No updates provided', 400);
    }

    const setParts = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE inbound SET ${setParts} WHERE id = ?`).run(...Object.values(updates), req.params.id);

    return ok(res, { message: db.prepare('SELECT * FROM inbound WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[inbound] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Conversation thread for a phone number ───────────────────────────

router.get('/inbound/conversation/:number', authMiddleware, (req, res) => {
  try {
    const number = req.params.number;

    // Inbound messages FROM this number (oldest first)
    const inboundMsgs = db.prepare(`
      SELECT 'inbound' as direction, id, from_number as other_number, body, created_at, flag, read_at, NULL as gateway_name, NULL as sim_mode
      FROM inbound
      WHERE from_number = ?
      ORDER BY created_at ASC
    `).all(number);

    // Outbound messages SENT to this number (oldest first)
    const outboundMsgs = db.prepare(`
      SELECT 'outbound' as direction, m.id, m.to_number as other_number, m.message as body,
             COALESCE(m.sent_at, m.created_at) as created_at, NULL as flag, NULL as read_at,
             g.name as gateway_name, m.gateway_id, 'sent' as status
      FROM messages m
      LEFT JOIN gateways g ON m.gateway_id = g.id
      WHERE m.to_number = ? AND m.status IN ('sent', 'delivered')
      ORDER BY created_at ASC
    `).all(number);

    // Fix timestamps FIRST so sort works on consistent ISO dates,
    // then combine and sort by time
    const combined = [...fixTimestamps(inboundMsgs), ...fixTimestamps(outboundMsgs)]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return ok(res, { messages: combined });
  } catch (e) {
    console.error('[inbound] conversation error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Reply to inbound message ────────────────────────────────────────

router.post('/inbound/:id/reply', authMiddleware, async (req, res) => {
  try {
    const inbound = db.prepare('SELECT * FROM inbound WHERE id = ?').get(req.params.id);
    if (!inbound) {
      return fail(res, 'Message not found', 404);
    }

    const { message, gateway_id, sim_mode } = req.body;
    if (!message || !gateway_id) {
      return fail(res, 'message and gateway_id are required', 400);
    }

    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ? AND active = 1').get(gateway_id);
    if (!gateway) {
      return fail(res, 'Invalid gateway', 400);
    }

    const msgId = uuidv4();
    const isPullGateway = gateway.mode === 'pull' || !gateway.url;

    // Always store the reply in messages table for conversation history
    db.prepare(
      'INSERT INTO messages (id, to_number, message, status, gateway_id) VALUES (?, ?, ?, ?, ?)'
    ).run(msgId, inbound.from_number, message, 'pending', gateway_id);

    if (isPullGateway) {
      // Pull gateway — phone picks it up on next poll
      db.prepare("UPDATE inbound SET read_at = datetime('now') WHERE id = ?").run(req.params.id);
      broadcast({ type: 'message:queued', message_id: msgId, gateway_id });
      return ok(res, { message_id: msgId, method: 'queue' });
    }

    // Push gateway — POST directly to the phone's embedded HTTP server
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${gateway.url}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
        },
        body: JSON.stringify({ to: inbound.from_number, message, flash: false, sim_mode: sim_mode || 'sim1' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return fail(res, `Gateway returned ${response.status}`, 502);
      }

      // Mark as sent in the messages table
      db.prepare("UPDATE messages SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), msgId);
    } catch (e) {
      clearTimeout(timeout);
      return fail(res, 'Failed to reach gateway: ' + e.message, 502);
    }

    // Mark as read
    db.prepare("UPDATE inbound SET read_at = datetime('now') WHERE id = ?").run(req.params.id);

    return ok(res, { success: true, method: 'push', message_id: msgId });
  } catch (e) {
    console.error('[inbound] reply error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
