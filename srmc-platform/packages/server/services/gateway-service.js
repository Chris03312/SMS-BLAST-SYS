/**
 * gateway-service.js — Gateway lifecycle management.
 *
 * Handles gateway auth tokens, online/offline tracking, heartbeats,
 * and provides a clean API for the rest of the system.
 */

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import db from '../database/db.js';
import { broadcast } from './ws.js';
import { JWT_SECRET } from '../configurations/secrets.js';

const INBOUND_TOKEN_EXPIRY = '30d';

/**
 * Authenticate a gateway device and return an inbound token.
 * The inbound token is used by the Android gateway to authenticate
 * inbound SMS forwarding requests.
 *
 * @param {string} userId   - Gateway user ID
 * @returns {object|null}   - { user, inboundToken } or null on failure
 */
export function gatewayLogin(userId) {
  // Validate gateway user (users with active=1 in the users table)
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(userId);
  if (!user) return null;

  // Simple password check (bcrypt compare is async, so do it inline here)
  // For simplicity, we do a direct hash comparison. The caller handles bcrypt.
  // This function just looks up the user and generates the token.
  const inboundToken = jwt.sign(
    { gatewayId: String(user.id), type: 'gateway', role: user.role },
    JWT_SECRET,
    { expiresIn: INBOUND_TOKEN_EXPIRY }
  );

  // Store the token reference
  const tokenId = uuidv4();
  db.prepare('INSERT INTO gateway_tokens (id, gateway_id, token) VALUES (?, ?, ?)')
    .run(tokenId, userId, inboundToken);

  return {
    user: {
      user_id: user.id,
      name: user.display_name || user.username,
      role: user.role,
      status: user.active ? 'Active' : 'Inactive',
    },
    inboundToken,
  };
}

/**
 * Validate an inbound token.
 *
 * @param {string} token - Bearer token from the Authorization header
 * @returns {object|null} - Decoded payload or null if invalid
 */
export function validateInboundToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'gateway') return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Mark a gateway as online. Only updates gateways that were manually added
 * by an admin in the gateway management page. Returns false if the gateway
 * has not been registered yet.
 *
 * @param {string} userId     - Gateway user ID
 * @param {string} deviceInfo - Device model / info string
 * @returns {boolean} - Whether the gateway was found and updated
 */
export function gatewayOnline(userId, deviceId, deviceInfo, number, simCarrier, number2, sim2Carrier) {
  const now = new Date().toISOString();
  const gwId = deviceId || userId;

  // Only update if gateway was manually added by admin
  const existing = db.prepare('SELECT id FROM gateways WHERE id = ?').get(gwId);
  if (!existing) return false;

  // Build update — only set fields that are provided
  const updates = ["status = ?", "last_online = ?", "device_info = ?"];
  const params = ['online', now, deviceInfo || ''];

  if (number !== undefined && number !== null) {
    updates.push("number = ?");
    params.push(String(number));
  }
  if (simCarrier !== undefined && simCarrier !== null) {
    updates.push("sim_carrier = ?");
    params.push(String(simCarrier));
  }
  if (number2 !== undefined && number2 !== null) {
    updates.push("number2 = ?");
    params.push(String(number2));
  }
  if (sim2Carrier !== undefined && sim2Carrier !== null) {
    updates.push("sim2_carrier = ?");
    params.push(String(sim2Carrier));
  }

  params.push(gwId);
  db.prepare(`UPDATE gateways SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  broadcast({
    type: 'gateway:online',
    gatewayId: gwId,
    deviceInfo: deviceInfo || '',
    last_online: now,
    sim_carrier: simCarrier || null,
    sim2_carrier: sim2Carrier || null,
  });

  return true;
}

/**
 * Mark a gateway as offline.
 *
 * @param {string} userId - Gateway user ID
 */
export function gatewayOffline(userId, deviceId) {
  const now = new Date().toISOString();
  const gwId = deviceId || userId;
  db.prepare('UPDATE gateways SET status = ?, last_beat = ? WHERE id = ?')
    .run('offline', now, gwId);

  broadcast({
    type: 'gateway:offline',
    gatewayId: gwId,
    last_offline: now,
  });
}

/**
 * Resolve a gateway by ID, phone_id, or username.
 * Used by the outbound poller and heartbeat to match phones to gateways.
 *
 * @param {string} rawId - The raw ID from JWT or heartbeat
 * @returns {object|null} - The gateway row, or null if not found
 */
export function resolveGateway(rawId) {
  if (!rawId) return null;
  // 1. Direct ID match
  let gw = db.prepare('SELECT * FROM gateways WHERE id = ?').get(rawId);
  if (gw) return gw;
  // 2. Phone ID match
  gw = db.prepare('SELECT * FROM gateways WHERE phone_id = ?').get(rawId);
  if (gw) return gw;
  // 3. Resolve username from users table, then match phone_id = username
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(rawId);
  if (user && user.username) {
    gw = db.prepare('SELECT * FROM gateways WHERE phone_id = ?').get(user.username);
    if (gw) return gw;
  }
  return null;
}

/**
 * Process a gateway heartbeat. Auto-creates the gateway if it doesn't exist,
 * supporting both SRMCGateway (has login) and SRMCGatewayLite (no login).
 *
 * @param {string} userId - Gateway user ID
 * @returns {boolean} - Whether the gateway was found / created
 */
export function gatewayHeartbeat(userId, deviceId, extra = {}) {
  const now = new Date().toISOString();
  const gwId = deviceId || userId;

  // Try to resolve existing gateway by id, phone_id, or username
  let resolved = resolveGateway(gwId);

  // Auto-create gateway if it doesn't exist (supports Lite app which has no login)
  if (!resolved) {
    const deviceName = extra.simCarrier
      ? `Lite Gateway (${extra.simCarrier}${extra.sim2Carrier ? ' + ' + extra.sim2Carrier : ''})`
      : `Lite Gateway (${gwId.slice(0, 8)}…)`;
    db.prepare(
      'INSERT INTO gateways (id, name, url, token, mode, active, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(gwId, deviceName, '', '', 'pull', 1, 'online', now);
    broadcast({
      type: 'gateway:new',
      gatewayId: gwId,
      name: deviceName,
      status: 'online',
    });
    resolved = { id: gwId };
  }

  const existingId = resolved.id;

  // Build update — always set status/beat/online, optionally update SIM fields
  const updates = ["status = ?", "last_beat = ?", "last_online = ?"];
  const params = ['online', now, now];

  if (extra.simCarrier !== undefined && extra.simCarrier !== null) {
    updates.push("sim_carrier = ?");
    params.push(String(extra.simCarrier));
  }
  if (extra.number2 !== undefined && extra.number2 !== null) {
    updates.push("number2 = ?");
    params.push(String(extra.number2));
  }
  if (extra.sim2Carrier !== undefined && extra.sim2Carrier !== null) {
    updates.push("sim2_carrier = ?");
    params.push(String(extra.sim2Carrier));
  }
  if (extra.number !== undefined && extra.number !== null) {
    updates.push("number = ?");
    params.push(String(extra.number));
  }

  params.push(existingId);
  db.prepare(`UPDATE gateways SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  broadcast({
    type: 'gateway:heartbeat',
    gatewayId: existingId,
    timestamp: now,
    sim_carrier: extra.simCarrier || null,
    sim2_carrier: extra.sim2Carrier || null,
  });

  return true;
}

/**
 * Get the inbound webhook URL from settings (ngrok or LAN fallback).
 *
 * When a gatewayId is provided, returns a per-gateway webhook URL so each
 * gateway has its own endpoint (e.g. /api/webhook/inbound/{gatewayId}).
 * This allows multiple gateways to share a single ngrok tunnel while the
 * server can identify each gateway from the URL path.
 *
 * @param {string} [gatewayId] - Optional gateway ID for per-gateway URL
 * @returns {string} - The public-facing webhook URL
 */
export function getInboundWebhookUrl(gatewayId) {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'ngrok_url'").get();
  const ngrokUrl = setting ? setting.value : '';
  if (ngrokUrl) {
    const base = `${ngrokUrl}/api/webhook/inbound`;
    if (gatewayId) {
      return `${base}/${gatewayId}`;
    }
    return base;
  }
  return ''; // Empty = use LAN fallback
}

/**
 * Log out a gateway.
 *
 * @param {string} userId - Gateway user ID
 */
export function gatewayLogout(userId, deviceId) {
  // Revoke all tokens for this gateway
  db.prepare('DELETE FROM gateway_tokens WHERE gateway_id = ?').run(userId);
  gatewayOffline(userId, deviceId);
}

function logActivity(userId, action, detail, level = 'info') {
  try {
    db.prepare('INSERT INTO activity (id, user_id, action, detail, level) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), userId || null, action, detail, level);
    broadcast({ type: 'activity:new', user_id: userId || null, action, detail, level, created_at: new Date().toISOString() });
  } catch (_) {}
}

/**
 * Track a gateway's send result and alert if too many consecutive failures
 * suggest the SIM may have no load.
 *
 * Call this after every send attempt through a gateway (both push and pull).
 *
 * @param {string}  gatewayId
 * @param {boolean} success   - true if the message was sent, false otherwise
 * @param {string}  gwName    - Display name for activity logs
 * @param {string}  [agentId] - Agent who triggered the send (for activity log)
 */
export function trackGatewayResult(gatewayId, success, gwName, agentId) {
  if (success) {
    db.prepare('UPDATE gateways SET consecutive_fails = 0 WHERE id = ?').run(gatewayId);
  } else {
    const gw = db.prepare('SELECT consecutive_fails FROM gateways WHERE id = ?').get(gatewayId);
    const fails = (gw?.consecutive_fails || 0) + 1;
    db.prepare('UPDATE gateways SET consecutive_fails = ? WHERE id = ?').run(fails, gatewayId);
    if (fails >= 5 && fails % 5 === 0) {
      logActivity(
        agentId,
        'gateway:no_load',
        `⚠ Gateway "${gwName}" has ${fails} consecutive failures — SIM may have no load!`,
        'warn'
      );
      broadcast({
        type: 'gateway:warning',
        gatewayId,
        warning: 'no_load',
        consecutive_fails: fails,
        message: `Gateway "${gwName}" — ${fails} consecutive send failures. Check SIM load.`,
      });
    }
  }
}

/**
 * Notify that the server has an inbound webhook endpoint reachable.
 * This is called on server startup if NGROK_URL is configured.
 *
 * @param {string} ngrokUrl - The ngrok URL from env
 * @returns {string} - The webhook URL
 */
export function registerNgrokWebhook(ngrokUrl) {
  if (ngrokUrl) {
    const cleanUrl = ngrokUrl.replace(/\/+$/, '');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ngrok_url', ?)")
      .run(cleanUrl);
    const webhookUrl = `${cleanUrl}/api/webhook/inbound`;
    console.log('[config] Ngrok webhook URL:', webhookUrl);
    return webhookUrl;
  }
  return '';
}
