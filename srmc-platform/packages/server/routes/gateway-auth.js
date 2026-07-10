/**
 * gateway-auth.js — Android gateway authentication routes.
 *
 * These are mounted at /api so they resolve to:
 *   POST /api/auth/gateway/login
 *   POST /api/auth/gateway/online
 *   POST /api/auth/gateway/offline
 *   POST /api/auth/gateway/heartbeat
 *   POST /api/auth/logout
 *   GET  /api/config
 *   GET  /api/ping
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database/db.js';
import {
  gatewayLogin,
  gatewayOnline,
  gatewayOffline,
  gatewayHeartbeat,
  gatewayLogout,
  getInboundWebhookUrl,
} from '../services/gateway-service.js';
import { getAllSettings } from '../services/config-service.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error, message: error });
}

// ── Gateway login (Android devices) ─────────────────────────────────

router.post('/auth/gateway/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      return fail(res, 'userId and password are required', 400);
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(userId);
    if (!user) {
      return fail(res, 'Invalid credentials', 401);
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return fail(res, 'Invalid credentials', 401);
    }

    const result = gatewayLogin(userId);
    if (!result) {
      return fail(res, 'Gateway login failed', 401);
    }

    return ok(res, {
      user: result.user,
      inboundToken: result.inboundToken,
    });
  } catch (e) {
    console.error('[gateway-auth] Login error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Gateway online notification ────────────────────────────────────

router.post('/auth/gateway/online', (req, res) => {
  try {
    const { userId, deviceId, deviceInfo, number, sim_carrier, number2, sim2_carrier } = req.body;
    if (!userId) {
      return fail(res, 'userId is required', 400);
    }
    const found = gatewayOnline(userId, deviceId, deviceInfo, number, sim_carrier, number2, sim2_carrier);
    if (found === false) {
      return fail(res, 'Gateway not found - ask an admin to add it in the Gateway management page first', 404);
    }
    return ok(res, { message: 'Gateway marked online' });
  } catch (e) {
    console.error('[gateway-auth] Online error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Gateway offline notification ───────────────────────────────────

router.post('/auth/gateway/offline', (req, res) => {
  try {
    const { userId, deviceId } = req.body;
    if (!userId) {
      return fail(res, 'userId is required', 400);
    }
    gatewayOffline(userId, deviceId);
    return ok(res, { message: 'Gateway marked offline' });
  } catch (e) {
    console.error('[gateway-auth] Offline error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Gateway heartbeat (60s interval) ───────────────────────────────

router.post('/auth/gateway/heartbeat', (req, res) => {
  try {
    const { userId, deviceId, sim_carrier, number2, sim2_carrier, number } = req.body;
    if (!userId) {
      return fail(res, 'userId is required', 400);
    }
    const found = gatewayHeartbeat(userId, deviceId, { simCarrier: sim_carrier, number2, sim2Carrier: sim2_carrier, number });
    if (!found) {
      return fail(res, 'Gateway not found', 404);
    }

    // Return the gateway-specific inbound webhook URL
    // Each gateway gets its own URL: .../api/webhook/inbound/{gatewayId}
    // This way multiple gateways can share a single ngrok tunnel
    const webhookUrl = getInboundWebhookUrl(deviceId || userId);
    return ok(res, {
      message: 'Heartbeat received',
      inbound_webhook_url: webhookUrl,
    });
  } catch (e) {
    console.error('[gateway-auth] Heartbeat error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Logout (gateway) ───────────────────────────────────────────────

router.post('/auth/logout', (req, res) => {
  try {
    const { userId, deviceId } = req.body;
    if (userId) {
      gatewayLogout(userId, deviceId);
    }
    return ok(res, { message: 'Logged out successfully' });
  } catch (e) {
    console.error('[gateway-auth] Logout error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Config endpoint (fetched by Android after login) ───────────────

router.get('/config', (req, res) => {
  try {
    const config = getAllSettings();
    // The /api/config endpoint doesn't have the gatewayId in the request,
    // so we return the base webhook URL. The gateway will get its specific
    // URL from the heartbeat response after login.
    const webhookUrl = getInboundWebhookUrl();
    return ok(res, {
      INBOUND_WEBHOOK_URL: webhookUrl,
      ...config,
    });
  } catch (e) {
    console.error('[gateway-auth] Config error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Ping endpoint (used by Android ServerChecker) ──────────────────

router.get('/ping', (req, res) => {
  return ok(res, {
    message: 'pong',
    time: new Date().toISOString(),
  });
});

export default router;
