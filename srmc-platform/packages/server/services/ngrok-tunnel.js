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
import db from '../database/db.js';
import { registerNgrokWebhook, getInboundWebhookUrl } from './gateway-service.js';
import { getSetting } from './config-service.js';

let activeListener = null;
let currentUrl = null;
let retryTimer = null;

const RETRY_INTERVAL_MS = 30_000; // check every 30s when offline

/**
 * Resolve the ngrok authtoken through the fallback chain:
 *   DB > env var (NGROK_AUTHTOKEN) > DEFAULTS
 * Set via Settings → Webhooks & API → Ngrok auth token.
 */
function resolveAuthtoken(explicit) {
  if (explicit) return explicit;
  const val = getSetting('ngrok_authtoken');
  if (val) return val.trim();
  return '';
}

/**
 * Resolve an optional reserved domain through the fallback chain:
 *   DB > env var (NGROK_DOMAIN) > DEFAULTS
 * Set via Settings → Webhooks & API → Reserved domain.
 */
function resolveDomain() {
  const val = getSetting('ngrok_domain');
  if (val) return val.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return '';
}

/** Whether this device has an ngrok authtoken (DB, env, or default). */
export function hasAuthtoken() {
  return !!resolveAuthtoken();
}

/**
 * Resolve the saved public URL through the fallback chain:
 *   DB > env var (PUBLIC_URL) > DEFAULTS
 * Set automatically when ngrok starts, or manually via Settings.
 */
export function getNgrokUrl() {
  return getSetting('public_url') || '';
}

/**
 * Resolve the ngrok authtoken through the fallback chain.
 */
export function getNgrokAuthtoken() {
  return resolveAuthtoken();
}

/**
 * Start an ngrok tunnel pointing to the given local port.
 *
 * @param {number} port      - Local server port to expose (default: 3003)
 * @param {string} [authtoken] - Optional explicit authtoken (else resolved per-device)
 * @returns {Promise<{url:string, webhookUrl:string}>}
 */
/**
 * Start the auto-retry loop. When the tunnel fails (e.g. no internet),
 * it will keep retrying every 30s until the tunnel comes up.
 */
export function startNgrokAutoRetry(port = 3003) {
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

export async function startNgrok(port = 3003, authtoken) {
  await stopNgrok();
  stopNgrokAutoRetry();

  const token = resolveAuthtoken(authtoken);
  const domain = resolveDomain();

  try {
    const opts = { addr: port };
    if (token) opts.authtoken = token;
    // No env fallback — token must be saved in DB settings (Settings → Webhooks & API)
    if (domain) opts.domain = domain;

    const listener = await ngrok.forward(opts);
    const url = listener.url().replace(/\/+$/, '');

    activeListener = listener;
    currentUrl = url;

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
    currentUrl = null;
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
    url: currentUrl,
    webhookUrl: currentUrl ? `${currentUrl}/api/webhook/inbound` : null,
  };
}
