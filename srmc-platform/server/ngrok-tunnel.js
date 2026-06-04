/**
 * ngrok-tunnel.js — Auto-manages an ngrok tunnel for the inbound SMS webhook.
 *
 * On start, the tunnel URL is registered in the database settings so that
 * Android gateways can discover it via /api/config after login.
 *
 * Usage:
 *   import { startNgrok, stopNgrok, getNgrokStatus } from './ngrok-tunnel.js';
 */

import ngrok from '@ngrok/ngrok';
import db from './db.js';
import { registerNgrokWebhook, getInboundWebhookUrl } from './services/gateway-service.js';

let activeListener = null;
let currentUrl     = null;
let retryTimer     = null;

const RETRY_INTERVAL_MS = 30_000; // check every 30s when offline

/**
 * Resolve the ngrok authtoken for THIS device.
 * Precedence: explicit arg → per-device 'ngrok_authtoken' setting → env.
 * Per-device settings let each install use its own free ngrok account so it
 * gets its own inbound tunnel (free ngrok = one tunnel per token).
 */
function resolveAuthtoken(explicit) {
  if (explicit) return explicit;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ngrok_authtoken'").get();
    if (row && row.value) return row.value.trim();
  } catch (_) {}
  return process.env.NGROK_AUTHTOKEN || process.env.NGROK_TOKEN || '';
}

/**
 * Resolve an optional reserved domain to bind the tunnel to, so the public URL
 * stays stable across restarts. Precedence: 'ngrok_domain' setting → env.
 */
function resolveDomain() {
  let raw = '';
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ngrok_domain'").get();
    if (row && row.value) raw = row.value;
  } catch (_) {}
  if (!raw) raw = process.env.NGROK_DOMAIN || '';
  // ngrok wants the bare hostname — tolerate a full URL or trailing slash.
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

/** Whether this device has any ngrok authtoken available (settings or env). */
export function hasAuthtoken() {
  return !!resolveAuthtoken();
}

/**
 * Start an ngrok tunnel pointing to the given local port.
 *
 * @param {number} port      - Local server port to expose (default: 3001)
 * @param {string} [authtoken] - Optional explicit authtoken (else resolved per-device)
 * @returns {Promise<{url:string, webhookUrl:string}>}
 */
/**
 * Start the auto-retry loop. When the tunnel fails (e.g. no internet),
 * it will keep retrying every 30s until the tunnel comes up.
 */
export function startNgrokAutoRetry(port = 3001) {
  stopNgrokAutoRetry();
  async function attempt() {
    if (activeListener) return; // already connected
    try {
      await startNgrok(port);
      console.log('[ngrok] Auto-retry: tunnel established');
      stopNgrokAutoRetry(); // success — stop retrying
    } catch (err) {
      console.log(`[ngrok] Auto-retry: no internet yet (${err.message}) — retrying in ${RETRY_INTERVAL_MS / 1000}s`);
    }
  }
  attempt();
  retryTimer = setInterval(attempt, RETRY_INTERVAL_MS);
}

/** Stop the auto-retry loop. */
export function stopNgrokAutoRetry() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

export async function startNgrok(port = 3001, authtoken) {
  await stopNgrok();
  stopNgrokAutoRetry();

  const token  = resolveAuthtoken(authtoken);
  const domain = resolveDomain();

  try {
    const opts = { addr: port };
    if (token) opts.authtoken = token;
    else       opts.authtoken_from_env = true;
    if (domain) opts.domain = domain;

    const listener = await ngrok.forward(opts);
    const url = listener.url().replace(/\/+$/, '');

    activeListener = listener;
    currentUrl     = url;

    // Save URL in the database so Android gateways discover it via /api/config
    registerNgrokWebhook(url);

    // Also update the public_url setting so the web UI shows it
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('public_url', ?)")
      .run(url);

    const webhookUrl = `${url}/api/webhook/inbound`;
    console.log(`[ngrok] ✅ Tunnel established: ${url}`);
    console.log(`[ngrok] 📥 Inbound webhook: ${webhookUrl}`);

    return { url, webhookUrl };
  } catch (err) {
    console.error('[ngrok] ❌ Failed to start tunnel:', err.message);
    throw err;
  }
}

/**
 * Stop the active ngrok tunnel gracefully.
 */
export async function stopNgrok() {
  stopNgrokAutoRetry();
  if (activeListener) {
    try {
      await ngrok.disconnect();
    } catch (err) {
      console.warn('[ngrok] Warning during disconnect:', err.message);
    }
    activeListener = null;
    currentUrl     = null;
    console.log('[ngrok] Tunnel closed');
  }
}

/**
 * Get the current tunnel status.
 *
 * @returns {{ running: boolean, url: string|null, webhookUrl: string|null }}
 */
export function getNgrokStatus() {
  return {
    running: activeListener !== null,
    url:     currentUrl,
    webhookUrl: currentUrl ? `${currentUrl}/api/webhook/inbound` : null,
  };
}
