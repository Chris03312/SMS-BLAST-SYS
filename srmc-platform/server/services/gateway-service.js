/**
 * gateway-service.js — Gateway lifecycle management.
 *
 * Handles gateway auth tokens, online/offline tracking, heartbeats,
 * and provides a clean API for the rest of the system.
 */

import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { broadcast } from '../ws.js';
import { JWT_SECRET } from '../secrets.js';

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
    { gatewayId: user.id, type: 'gateway', role: user.role },
    JWT_SECRET,
    { expiresIn: INBOUND_TOKEN_EXPIRY }
  );

  // Store the token reference
  const tokenId = uuidv4();
  db.prepare('INSERT INTO gateway_tokens (id, gateway_id, token) VALUES (?, ?, ?)')
    .run(tokenId, user.id, inboundToken);

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
 * Ensure a gateway record exists for the given user.
 * If a gateway record already exists with this ID it will be updated.
 * Previously this auto-created gateways with a placeholder URL (localhost:8088),
 * which caused broadcasts to fail trying to send to a non-existent server.
 * Gateways should only be created through the admin UI with correct URLs.
 */
function ensureGateway(userId, deviceInfo) {
  const existing = db.prepare('SELECT id FROM gateways WHERE id = ?').get(userId);
  if (existing) return;

  // Self-register the phone as a PULL gateway. It has no reachable URL — it
  // polls the central server for outbound work — so this works across networks.
  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
  const name = deviceInfo || (user && (user.display_name || user.username)) || 'Gateway';
  db.prepare(
    "INSERT INTO gateways (id, name, url, mode, status, active) VALUES (?, ?, '', 'pull', 'online', 1)"
  ).run(userId, name);
  console.log('[gateway-service] Self-registered pull gateway for user', userId, `(${name})`);
}

/**
 * Mark a gateway as online.
 *
 * @param {string} userId     - Gateway user ID
 * @param {string} deviceInfo - Device model / info string
 */
export function gatewayOnline(userId, deviceInfo, number) {
  const now = new Date().toISOString();
  ensureGateway(userId, deviceInfo);
  db.prepare('UPDATE gateways SET status = ?, last_online = ?, device_info = ? WHERE id = ?')
    .run('online', now, deviceInfo || '', userId);
  // Record the SIM's own number if the phone reported it (used as send "sender").
  if (number) {
    db.prepare('UPDATE gateways SET number = ? WHERE id = ?').run(String(number), userId);
  }

  broadcast({
    type: 'gateway:online',
    gatewayId: userId,
    deviceInfo: deviceInfo || '',
    last_online: now,
  });
}

/**
 * Mark a gateway as offline.
 *
 * @param {string} userId - Gateway user ID
 */
export function gatewayOffline(userId) {
  const now = new Date().toISOString();
  ensureGateway(userId);
  db.prepare('UPDATE gateways SET status = ?, last_beat = ? WHERE id = ?')
    .run('offline', now, userId);

  broadcast({
    type: 'gateway:offline',
    gatewayId: userId,
    last_offline: now,
  });
}

/**
 * Process a gateway heartbeat.
 *
 * @param {string} userId - Gateway user ID
 * @returns {boolean} - Whether the gateway was found
 */
export function gatewayHeartbeat(userId) {
  const now = new Date().toISOString();
  ensureGateway(userId);
  db.prepare('UPDATE gateways SET status = ?, last_beat = ?, last_online = ? WHERE id = ?')
    .run('online', now, now, userId);

  broadcast({
    type: 'gateway:heartbeat',
    gatewayId: userId,
    timestamp: now,
  });

  return true;
}

/**
 * Get the inbound webhook URL from settings (ngrok or LAN fallback).
 *
 * @returns {string} - The public-facing webhook URL
 */
export function getInboundWebhookUrl() {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'ngrok_url'").get();
  const ngrokUrl = setting ? setting.value : '';
  if (ngrokUrl) {
    return `${ngrokUrl}/api/webhook/inbound`;
  }
  return ''; // Empty = use LAN fallback
}

/**
 * Log out a gateway.
 *
 * @param {string} userId - Gateway user ID
 */
export function gatewayLogout(userId) {
  // Revoke all tokens for this gateway
  db.prepare('DELETE FROM gateway_tokens WHERE gateway_id = ?').run(userId);
  gatewayOffline(userId);
}

function logActivity(userId, action, detail, level = 'info') {
  try {
    db.prepare('INSERT INTO activity (id, user_id, action, detail, level) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), userId || null, action, detail, level);
    broadcast({ type: 'activity:new', action, detail, level, created_at: new Date().toISOString() });
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
