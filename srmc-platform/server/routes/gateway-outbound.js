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
import db from '../db.js';
import { broadcast } from '../ws.js';
import { validateInboundToken, trackGatewayResult } from '../services/gateway-service.js';
import { onMessageAcked } from '../broadcast-engine.js';
import { logSend, resolveSender } from '../send-logger.js';

function logActivity(userId, action, detail, level = 'info') {
  try {
    db.prepare('INSERT INTO activity (id, user_id, action, detail, level) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), userId || null, action, detail, level);
    broadcast({ type: 'activity:new', action, detail, level, created_at: new Date().toISOString() });
  } catch (_) {}
}

const router = Router();

const CLAIM_TIMEOUT_S = 120; // re-deliver a claimed message if not ACKed in time

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
  return payload.gatewayId;
}

// ── Claim pending outbound messages for this gateway ──────────────────────
router.get('/gateway/outbound', (req, res) => {
  const gatewayId = authGateway(req, res);
  if (!gatewayId) return;

  try {
    const max = Math.min(parseInt(req.query.max, 10) || 10, 50);
    const now = new Date().toISOString();

    // Keep the gateway marked alive while it polls.
    db.prepare("UPDATE gateways SET status = 'online', last_poll = ?, last_beat = ?, last_online = ? WHERE id = ?")
      .run(now, now, now, gatewayId);

    // Claim 'pending' messages, plus any 'sending' ones whose claim went stale
    // (phone crashed/lost connection before ACKing).
    const rows = db.prepare(
      `SELECT id, to_number, message FROM messages
         WHERE gateway_id = ?
           AND ( status = 'pending'
                 OR (status = 'sending' AND (sent_at IS NULL OR sent_at < datetime('now', ?))) )
         ORDER BY created_at ASC
         LIMIT ?`
    ).all(gatewayId, `-${CLAIM_TIMEOUT_S} seconds`, max);

    const claim = db.prepare("UPDATE messages SET status = 'sending', sent_at = ? WHERE id = ?");
    const claimAll = db.transaction(() => { for (const r of rows) claim.run(now, r.id); });
    claimAll();

    return res.json({
      success: true,
      messages: rows.map(r => ({ id: r.id, to: r.to_number, message: r.message })),
    });
  } catch (e) {
    console.error('[gateway-outbound] claim error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Report results for claimed messages ───────────────────────────────────
// ── Delivery report from phone (carrier delivery status) ────────────────
router.post('/gateway/delivery-report', (req, res) => {
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
    }

    return res.json({ success: true });
  } catch (e) {
    console.error('[gateway-outbound] delivery-report error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/gateway/outbound/ack', (req, res) => {
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
        logSend({ name: gwName, sender: senderWithSim, receiver, status: 'sent', time: now });
      } else {
        const err = String(r.error || 'send failed').slice(0, 200);
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(err, r.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gatewayId);
        trackGatewayResult(gatewayId, false, gwName, msg.agent_id);
        logActivity(msg.agent_id, 'sms:failed', `Failed from ${senderWithSim} to ${receiver} via ${gwName}: ${err}`, 'error');
        logSend({ name: gwName, sender: senderWithSim, receiver, status: 'failed', time: now });
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
