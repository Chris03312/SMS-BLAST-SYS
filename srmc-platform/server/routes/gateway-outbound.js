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

      if (r.status === 'sent') {
        db.prepare("UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(now, r.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gatewayId);
        trackGatewayResult(gatewayId, true, gwName, msg.agent_id);
        logActivity(msg.agent_id, 'sms:sent', `Sent from ${sender} to ${receiver} via ${gwName}`, 'info');
        logSend({ name: gwName, sender, receiver, status: 'sent', time: now });
      } else {
        const err = String(r.error || 'send failed').slice(0, 200);
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(err, r.id);
        db.prepare('UPDATE gateways SET sent_today = sent_today + 1 WHERE id = ?').run(gatewayId);
        trackGatewayResult(gatewayId, false, gwName, msg.agent_id);
        logActivity(msg.agent_id, 'sms:failed', `Failed from ${sender} to ${receiver} via ${gwName}: ${err}`, 'error');
        logSend({ name: gwName, sender, receiver, status: 'failed', time: now });
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
