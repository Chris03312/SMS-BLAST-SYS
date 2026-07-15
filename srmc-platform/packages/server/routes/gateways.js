import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import db from '../database/db.js';
import { fixTimestamps } from '../utils/fix-timestamps.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkGatewayNow } from '../services/gateway-poller.js';
import { getTimezone } from '../services/timezone.js';

/** Save a snapshot of the gateway's current numbers to the history table.
 *  If the exact same number combination already exists, just bump its
 *  changed_at timestamp so it moves to the top of the history list. */
function saveNumberSnapshot(gatewayId, gatewayName, number, number2, simCarrier, sim2Carrier, agentName) {
  // Check if this exact number combo already exists for this gateway
  const existing = db.prepare(
    `SELECT id FROM gateway_numbers
     WHERE gateway_id = ? AND COALESCE(number,'') = COALESCE(?,'') 
       AND COALESCE(number2,'') = COALESCE(?,'')
       AND COALESCE(sim_carrier,'') = COALESCE(?,'')
       AND COALESCE(sim2_carrier,'') = COALESCE(?,'')`
  ).get(gatewayId, number || '', number2 || '', simCarrier || '', sim2Carrier || '');

  if (existing) {
    // Bump the timestamp — same numbers, just updated
    db.prepare('UPDATE gateway_numbers SET changed_at = datetime(\'now\') WHERE id = ?').run(existing.id);
  } else {
    const id = uuidv4();
    db.prepare(
      'INSERT INTO gateway_numbers (id, gateway_id, gateway_name, agent_name, number, number2, sim_carrier, sim2_carrier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, gatewayId, gatewayName || '', agentName || '', number || null, number2 || null, simCarrier || null, sim2Carrier || null);
  }
}

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// Helper: check if the user owns the gateway or is admin.
function canAccess(user, gatewayId) {
  if (!gatewayId) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  const gw = db.prepare('SELECT owner_id FROM gateways WHERE id = ?').get(gatewayId);
  return gw && gw.owner_id === user.id;
}

router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    let gateways;
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      gateways = db.prepare('SELECT * FROM gateways ORDER BY created_at DESC').all();
    } else {
      // Agents only see gateways they own
      gateways = db.prepare('SELECT * FROM gateways WHERE active = 1 AND owner_id = ? ORDER BY created_at DESC').all(req.user.id);
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

router.post('/', async (req, res) => {
  try {
    const { name, url, token, sim_carrier, number, number2 } = req.body;
    if (!name || !url) {
      return fail(res, 'Name and URL are required', 400);
    }

    const normalizedToken = token ? token.toLowerCase() : null;

    // Try to detect the Lite app's persistent device UUID by pinging /health.
    // If found, use that UUID as the gateway ID so the Lite app's heartbeat
    // and online calls will match automatically (no manual ID sync needed).
    let deviceId = null;
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const healthRes = await fetch(`${baseUrl}/health`, {
        headers: {
          ...(normalizedToken ? { Authorization: `Bearer ${normalizedToken}` } : {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        if (healthData.device_id) {
          deviceId = healthData.device_id;
        }
      }
    } catch (e) {
      // Health check failed (offline, timeout, unreachable) —
      // fall back to random UUID. The Lite app won't match via
      // heartbeat, but the admin can still use PUSH mode.
    }

    // If we detected a device ID, check it's not already registered
    if (deviceId) {
      const existing = db.prepare('SELECT id FROM gateways WHERE id = ?').get(deviceId);
      if (existing) {
        return fail(res, 'This gateway device is already registered. Find it in your gateway list.', 409);
      }
    }

    const id = deviceId || uuidv4();

    db.prepare('INSERT INTO gateways (id, name, url, token, sim_carrier, number, number2, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, url, normalizedToken, sim_carrier || null, number || null, number2 || null, req.user.id);

    // Save initial numbers to history (include the agent name from the logged-in user)
    saveNumberSnapshot(id, name, number, number2, sim_carrier, null, req.user.display_name || '');

    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(id);
    return ok(res, { gateway }, 201);
  } catch (e) {
    console.error('[gateways] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/:id', (req, res) => {
  try {
    if (!canAccess(req.user, req.params.id)) {
      return fail(res, 'Forbidden — you do not own this gateway', 403);
    }
    const { name, url, token, sim_carrier, sim2_carrier, number, number2, active } = req.body;
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }

    const normalizedToken = token !== undefined ? (token || '').toLowerCase() : gateway.token;

    // Before updating, save the OLD numbers to history if they changed
    const finalNumber = number !== undefined ? number : gateway.number;
    const finalNumber2 = number2 !== undefined ? number2 : gateway.number2;
    const finalSimCarrier = sim_carrier !== undefined ? sim_carrier : gateway.sim_carrier;
    const finalSim2Carrier = sim2_carrier !== undefined ? sim2_carrier : gateway.sim2_carrier;
    const finalName = name ?? gateway.name;

    // Only save snapshot if numbers actually changed
    const numbersChanged =
      String(finalNumber || '') !== String(gateway.number || '') ||
      String(finalNumber2 || '') !== String(gateway.number2 || '');
    if (numbersChanged) {
      // Look up the owner's display name for the snapshot
      let agentName = '';
      if (gateway.owner_id) {
        const owner = db.prepare('SELECT display_name FROM users WHERE id = ?').get(gateway.owner_id);
        agentName = owner?.display_name || '';
      }
      saveNumberSnapshot(gateway.id, gateway.name, gateway.number, gateway.number2, gateway.sim_carrier, gateway.sim2_carrier, agentName);
    }

    db.prepare('UPDATE gateways SET name = ?, url = ?, token = ?, sim_carrier = ?, sim2_carrier = ?, number = ?, number2 = ?, active = ? WHERE id = ?')
      .run(
        finalName,
        url ?? gateway.url,
        normalizedToken,
        finalSimCarrier,
        finalSim2Carrier,
        finalNumber,
        finalNumber2,
        active !== undefined ? (active ? 1 : 0) : gateway.active,
        req.params.id
      );

    return ok(res, { gateway: db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[gateways] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/:id', (req, res) => {
  try {
    if (!canAccess(req.user, req.params.id)) {
      return fail(res, 'Forbidden — you do not own this gateway', 403);
    }
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }
    // Actually delete the gateway row — no soft-delete
    db.prepare('DELETE FROM gateways WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[gateways] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    if (!canAccess(req.user, req.params.id)) {
      return fail(res, 'Forbidden — you do not own this gateway', 403);
    }
    const { token } = req.body; // optional — use form token instead of DB token
    const updated = await checkGatewayNow(req.params.id, token);
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
    if (!canAccess(req.user, req.params.id)) {
      return fail(res, 'Forbidden — you do not own this gateway', 403);
    }
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

// ── Get gateway number history ────────────────────────────────────────────
// router.use(authMiddleware) already protects all routes below it
router.get('/numbers', (req, res) => {
  try {
    const search = req.query.search || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    let whereClause = '';
    const params = [];

    // Agents only see histories of gateways they own
    if (req.user.role === 'agent') {
      whereClause = 'WHERE gn.gateway_id IN (SELECT id FROM gateways WHERE owner_id = ?)';
      params.push(req.user.id);
    }

    if (search.trim()) {
      const term = '%' + search.trim() + '%';
      if (whereClause) {
        whereClause += ' AND (gn.gateway_name LIKE ? OR gn.number LIKE ? OR gn.number2 LIKE ? OR gn.agent_name LIKE ?)';
      } else {
        whereClause = 'WHERE (gn.gateway_name LIKE ? OR gn.number LIKE ? OR gn.number2 LIKE ? OR gn.agent_name LIKE ?)';
      }
      params.push(term, term, term, term);
    }

    const rows = db.prepare(
      `SELECT gn.* FROM gateway_numbers gn ${whereClause} ORDER BY gn.changed_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const count = db.prepare(
      `SELECT COUNT(*) as c FROM gateway_numbers gn ${whereClause}`
    ).get(...params);

    return ok(res, { numbers: fixTimestamps(rows), total: count ? count.c : 0 });
  } catch (e) {
    console.error('[gateways] numbers error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Delete a gateway number history record (admin only) ────────────────
router.delete('/numbers/:id', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return fail(res, 'Forbidden — admin access required', 403);
    }
    const record = db.prepare('SELECT id FROM gateway_numbers WHERE id = ?').get(req.params.id);
    if (!record) {
      return fail(res, 'History record not found', 404);
    }
    db.prepare('DELETE FROM gateway_numbers WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[gateways] DELETE numbers error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Test SIM load by sending a test SMS through the gateway ────────────────
router.post('/:id/test-sim', async (req, res) => {
  try {
    if (!canAccess(req.user, req.params.id)) {
      return fail(res, 'Forbidden — you do not own this gateway', 403);
    }
    const { sim } = req.body; // 'sim1' or 'sim2'
    const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(req.params.id);
    if (!gateway) {
      return fail(res, 'Gateway not found', 404);
    }

    const targetNumber = sim === 'sim2' ? gateway.number2 : gateway.number;
    if (!targetNumber) {
      return fail(res, `SIM ${sim === 'sim2' ? '2' : '1'} has no number configured`, 400);
    }

    const tz = getTimezone();
    const testMsg = `SMS test — SIM ${sim === 'sim2' ? '2' : '1'} at ${new Date().toLocaleTimeString('en-PH', { timeZone: tz })}`;

    // PUSH gateway — send directly to the phone's HTTP server
    if (gateway.url && gateway.mode !== 'pull') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${gateway.url}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
          },
          body: JSON.stringify({ to: targetNumber, message: testMsg, sim_mode: sim }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          return ok(res, {
            success: true,
            message: `Test SMS sent via ${sim} → ${targetNumber}`,
            method: 'push',
          });
        } else {
          return fail(res, `Gateway returned HTTP ${response.status}`, 502);
        }
      } catch (e) {
        clearTimeout(timeout);
        return fail(res, `Failed to reach gateway: ${e.message}`, 502);
      }
    }

    // PULL gateway — queue the message for the phone to pick up
    const messageId = uuidv4();
    db.prepare(
      `INSERT INTO messages (id, broadcast_id, to_number, message, status, gateway_id, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))`
    ).run(messageId, null, targetNumber, testMsg, req.params.id);

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
