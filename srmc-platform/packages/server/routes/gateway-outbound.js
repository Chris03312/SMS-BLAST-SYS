/**
 * gateway-outbound.js — Pull-based outbound queue for remote gateways.
 *
 * Instead of the server POSTing to each phone (which only works on a LAN), a
 * remote phone PULLS its queued messages from the central server, sends them
 * via SMS, then ACKs the results. This works across any network — the phone
 * only makes outbound HTTPS calls.
 *
 * Auth: the phone's inbound token (Bearer), same one issued at gateway login.
 *
 *   GET  /api/gateway/outbound       → claim up to N pending messages
 *   POST /api/gateway/outbound/ack   → report sent/failed results
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { broadcast } from '../services/ws.js';
import { gatewayOutboundLimiter } from '../middleware/rate-limit.js';
import { validateInboundToken, trackGatewayResult } from '../services/gateway-service.js';
import { onMessageAcked } from '../services/broadcast-engine.js';
function resolveSender(gateway) {
  if (!gateway) return 'unknown';
  if (gateway.number) return gateway.number;
  try {
    const s = db.prepare("SELECT value FROM settings WHERE key = 'sender_id'").get();
    if (s && s.value) return s.value;
  } catch (_) {}
  return gateway.name || 'unknown';
}

function logActivity(userId, action, detail, level = 'info') {
  try {
    db.prepare('INSERT INTO activity (id, user_id, action, detail, level) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), userId || null, action, detail, level);
    broadcast({ type: 'activity:new', action, detail, level, created_at: new Date().toISOString() });
  } catch (_) {}
}

const router = Router();

const CLAIM_TIMEOUT_S = 120; // re-deliver a claimed message if not ACKed in time
const STALE_QUEUED_S = 15;     // claim queued messages after this many seconds

function authGateway(req, res) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing gateway token' });
    return null;
  }
  const payload = validateInboundToken(h.slice(7));
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired gateway token' });
    return null;
  }
  const rawId = payload.gatewayId;
  // Resolve gateway by phone_id first (admin-created PULL gateway), then direct ID
  const gw = db.prepare('SELECT id FROM gateways WHERE phone_id = ?').get(rawId)
    || db.prepare('SELECT id FROM gateways WHERE id = ?').get(rawId);
  if (gw) return gw.id;
  // Fallback: try username lookup
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(rawId);
  if (user && user.username) {
    const gw2 = db.prepare('SELECT id FROM gateways WHERE phone_id = ?').get(user.username);
    if (gw2) return gw2.id;
  }
  return rawId;
}

// ── Claim pending outbound messages for this gateway ──────────────────────
router.get('/gateway/outbound', gatewayOutboundLimiter, (req, res) => {
  const gatewayId = authGateway(req, res);
  if (!gatewayId) return;

  try {
    const max = Math.min(parseInt(req.query.max, 10) || 10, 50);
    const now = new Date().toISOString();

    // Keep the gateway marked alive while it polls.
    db.prepare("UPDATE gateways SET status = 'online', last_poll = ?, last_beat = ?, last_online = ? WHERE id = ?")
      .run(now, now, now, gatewayId);

    // Also include sim_mode + sim_round_start from the broadcast
    const rows = db.prepare(
      `SELECT m.id, m.to_number, m.message, COALESCE(b.sim_mode, 'sim1') as sim_mode, b.sim_round_start, b.total as broadcast_total
         FROM messages m
         LEFT JOIN broadcasts b ON m.broadcast_id = b.id
         WHERE m.gateway_id = ?
           AND ( m.status = 'pending'
                 OR (m.status = 'sending' AND (m.sent_at IS NULL OR m.sent_at < datetime('now', ?)))
                 OR (m.status = 'queued' AND m.created_at < datetime('now', ?)) )
         ORDER BY m.created_at ASC
         LIMIT ?`
    ).all(gatewayId, `-${CLAIM_TIMEOUT_S} seconds`, `-${STALE_QUEUED_S} seconds`, max);

    const claim = db.prepare("UPDATE messages SET status = 'sending', sent_at = ? WHERE id = ?");
    const claimAll = db.transaction(() => { for (const r of rows) claim.run(now, r.id); });
    claimAll();

    // Apply round-robin or parallel alternation per-message
    const processedRows = rows.map((r, idx) => {
      if (r.sim_mode === 'round-robin') {
        const startSim = r.sim_round_start || 'sim1';
        const isSim2 = startSim === 'sim2' ? (idx % 2 === 0) : (idx % 2 === 1);
        return { ...r, sim_mode: isSim2 ? 'sim2' : 'sim1' };
      }
      if (r.sim_mode === 'parallel') {
        // First half of messages go to startSim, second half to the other SIM
        const total = r.broadcast_total || rows.length;
        const mid = Math.floor(total / 2);
        const startSim = r.sim_round_start || 'sim1';
        return { ...r, sim_mode: idx < mid ? startSim : (startSim === 'sim1' ? 'sim2' : 'sim1') };
      }
      return r;
    });

    return res.json({
      success: true,
      messages: processedRows.map(r => ({ id: r.id, to: r.to_number, message: r.message, sim_mode: r.sim_mode })),
    });
  } catch (e) {
    console.error('[gateway-outbound] claim error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Report results for claimed messages ───────────────────────────────────
// ── Delivery report from phone (carrier delivery status) ────────────────
router.post('/gateway/delivery-report', gatewayOutboundLimiter, (req, res) => {
  const gatewayId = authGateway(req, res);
  if (!gatewayId) return;

  try {
    const { message_id, to_number, status, error, sim_slot } = req.body;
    if (!message_id || !status) {
      return res.json({ success: false, error: 'Missing fields' });
    }

    const now = new Date().toISOString();
    const gw = db.prepare('SELECT name FROM gateways WHERE id = ?').get(gatewayId);
    const gwName = (gw && gw.name) || 'Gateway';

    if (status === 'delivery_failed' || status === 'failed') {
      // Carrier confirmed the message was NOT delivered (no load, etc.)
      const errMsg = error || 'delivery_failed';
      db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ? AND status != 'failed'").run(errMsg, message_id);
      db.prepare('UPDATE gateways SET sent_today = GREATEST(0, sent_today - 1) WHERE id = ?').run(gatewayId);
      trackGatewayResult(gatewayId, false, gwName, null);
      // Increment delivery_fails counter
      db.prepare('UPDATE gateways SET delivery_fails = delivery_fails + 1 WHERE id = ?').run(gatewayId);
      const gw2 = db.prepare('SELECT delivery_fails FROM gateways WHERE id = ?').get(gatewayId);
      const dfCount = gw2?.delivery_fails || 0;
      logActivity(null, 'sms:delivery_failed',
        `Delivery failed for ${message_id} → ${to_number} via ${gwName}: ${errMsg}`,
        'warn');
      broadcast({
        type: 'gateway:warning',
        gatewayId,
        warning: 'delivery_failed',
        delivery_fails: dfCount,
        message_id,
        message: `Delivery failed for message via ${gwName}: ${errMsg}`,
      });
    } else if (status === 'delivered') {
      // Carrier confirmed delivery — mark as confirmed
      db.prepare("UPDATE messages SET status = 'delivered' WHERE id = ?").run(message_id);
      // Reset delivery_fails counter on successful delivery
      db.prepare('UPDATE gateways SET delivery_fails = 0 WHERE id = ?').run(gatewayId);
      logActivity(null, 'sms:delivered',
        `Delivery confirmed for ${message_id} → ${to_number} via ${gwName}`,
        'info');

      // Trigger progress recalculation so the broadcast's sent count updates
      const msg = db.prepare('SELECT broadcast_id FROM messages WHERE id = ?').get(message_id);
      if (msg && msg.broadcast_id) {
        onMessageAcked(msg.broadcast_id);
      }
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[gateway-outbound] delivery-report error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/gateway/outbound/ack', gatewayOutboundLimiter, (req, res) => {
  const gatewayId = authGateway(req, res);
  if (!gatewayId) return;

  try {
    const results = Array.isArray(req.body && req.body.results) ? req.body.results : [];
    const now = new Date().toISOString();
    const affected = new Set();

    const gw = db.prepare('SELECT name, number FROM gateways WHERE id = ?').get(gatewayId);
    const sender = resolveSender(gw);
    const gwName = (gw && gw.name) || 'Gateway';

    for (const r of results) {
      if (!r || !r.id) continue;
      const msg = db.prepare('SELECT broadcast_id, to_number, agent_id FROM messages m LEFT JOIN broadcasts b ON b.id = m.broadcast_id WHERE m.id = ? AND m.gateway_id = ?').get(r.id, gatewayId);
      if (!msg) continue;
      const receiver = msg.to_number;

      // Read which SIM the phone used (1 or 2), default to 1
      const simSlot = parseInt(r.sim_slot) || 1;
      const simLabel = simSlot === 2 ? 'SIM2' : 'SIM1';
      const senderWithSim = `${sender} (${simLabel})`;

      if (r.status === 'sent') {
        db.prepare("UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(now, r.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gatewayId);
        trackGatewayResult(gatewayId, true, gwName, msg.agent_id);
        logActivity(msg.agent_id, 'sms:sent', `Sent from ${senderWithSim} to ${receiver} via ${gwName}`, 'info');
      } else {
        const err = String(r.error || 'send failed').slice(0, 200);
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(err, r.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gatewayId);
        trackGatewayResult(gatewayId, false, gwName, msg.agent_id);
        logActivity(msg.agent_id, 'sms:failed', `Failed from ${senderWithSim} to ${receiver} via ${gwName}: ${err}`, 'error');
      }
      if (msg.broadcast_id) affected.add(msg.broadcast_id);
    }

    for (const bId of affected) onMessageAcked(bId);

    return res.json({ success: true, acked: results.length });
  } catch (e) {
    console.error('[gateway-outbound] ack error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
