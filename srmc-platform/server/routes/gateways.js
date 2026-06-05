import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import db from '../db.js';
import { fixTimestamps } from '../fix-timestamps.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { checkGatewayNow } from '../gateway-poller.js';

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
    let gateways;
    if (req.user.role === 'admin') {
      gateways = db.prepare('SELECT * FROM gateways ORDER BY created_at DESC').all();
    } else {
      gateways = db.prepare('SELECT * FROM gateways WHERE active = 1 ORDER BY created_at DESC').all();
    }

    // Collect all gateway IDs that are referenced in active (sending/paused) broadcasts
    const activeBroadcasts = db.prepare(
      "SELECT gateway_ids, gateway_id FROM broadcasts WHERE status IN ('sending', 'paused')"
    ).all();

    const inUseIds = new Set();
    for (const b of activeBroadcasts) {
      // Parse the JSON array of gateway_ids
      if (b.gateway_ids) {
        try {
          const ids = JSON.parse(b.gateway_ids);
          for (const id of ids) inUseIds.add(id);
        } catch (_) {}
      }
      // Legacy single gateway_id fallback
      if (b.gateway_id) inUseIds.add(b.gateway_id);
    }

    // Tag each gateway with an in_use flag
    gateways = gateways.map(g => ({
      ...g,
      in_use: inUseIds.has(g.id) ? 1 : 0,
    }));

    return ok(res, { gateways: fixTimestamps(gateways) });
  } catch (e) {
    console.error('[gateways] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', (req, res) => {
  try {
    const { name, url, token, sim_carrier, number, number2 } = req.body;
    if (!name || !url) {
      return fail(res, 'Name and URL are required', 400);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO gateways (id, name, url, token, sim_carrier, number, number2) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, url, token || null, sim_carrier || null, number || null, number2 || null);

    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
    return ok(res, { gateway }, 201);
  } catch (e) {
    console.error('[gateways] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/:id', (req, res) => {
  try {
    const { name, url, token, sim_carrier, number, number2, active } = req.body;
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }

    db.prepare('UPDATE gateways SET name = ?, url = ?, token = ?, sim_carrier = ?, number = ?, number2 = ?, active = ? WHERE id = ?')
      .run(
        name ?? gateway.name,
        url ?? gateway.url,
        token !== undefined ? token : gateway.token,
        sim_carrier !== undefined ? sim_carrier : gateway.sim_carrier,
        number !== undefined ? number : gateway.number,
        number2 !== undefined ? number2 : gateway.number2,
        active !== undefined ? (active ? 1 : 0) : gateway.active,
        req.params.id
      );

    return ok(res, { gateway: db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[gateways] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/:id', adminOnly, (req, res) => {
  try {
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }
    db.prepare('UPDATE gateways SET active = 0 WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[gateways] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const updated = await checkGatewayNow(req.params.id);
    if (!updated) {
      return fail(res, 'Gateway not found', 404);
    }
    return ok(res, { gateway: updated });
  } catch (e) {
    console.error('[gateways] test error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/:id/log', async (req, res) => {
  try {
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      await fetch(`${gateway.url}/log`, {
        method: 'DELETE',
        headers: {
          ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (e) {
      clearTimeout(timeout);
    }

    return ok(res, { success: true });
  } catch (e) {
    console.error('[gateways] delete log error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Test SIM load by sending a test SMS through the gateway ────────────────
router.post('/:id/test-sim', async (req, res) => {
  try {
    const { sim } = req.body; // 'sim1' or 'sim2'
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }

    const targetNumber = sim === 'sim2' ? gateway.number2 : gateway.number;
    if (!targetNumber) {
      return fail(res, `SIM ${sim === 'sim2' ? '2' : '1'} has no number configured`, 400);
    }

    // Create a test message in the outbound queue for this PULL gateway
    const messageId = uuidv4();
    const testMsg = `SRMC test — SIM ${sim === 'sim2' ? '2' : '1'} at ${new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' })}`;

    db.prepare(
      `INSERT INTO messages (id, broadcast_id, to_number, message, status, gateway_id, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))`
    ).run(messageId, null, targetNumber, testMsg, req.params.id);

    // For PUSH gateways, send directly
    if (gateway.mode === 'push' && gateway.url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res2 = await fetch(`${gateway.url}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
          },
          body: JSON.stringify({ to: targetNumber, message: testMsg, flash: false }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res2.ok) {
          db.prepare("UPDATE messages SET status = 'sent', sent_at = datetime('now') WHERE id = ?").run(messageId);
          return ok(res, { success: true, message: `Test SMS sent via ${sim} to ${targetNumber}` });
        } else {
          const body = await res2.text();
          db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(`HTTP ${res2.status}: ${body}`, messageId);
          return ok(res, { success: true, message: `Test SMS failed: HTTP ${res2.status}`, failed: true });
        }
      } catch (e) {
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(e.message, messageId);
        return ok(res, { success: true, message: `Test SMS failed: ${e.message}`, failed: true });
      }
    }

    // For PULL gateways, the message is queued and the phone will pick it up
    return ok(res, {
      success: true,
      message: `Test message queued for ${sim} → ${targetNumber}. Phone will send it on next poll.`,
      message_id: messageId,
    });
  } catch (e) {
    console.error('[gateways] test-sim error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
