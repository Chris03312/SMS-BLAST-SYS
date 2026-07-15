/**
 * config-service.js — Application configuration service.
 *
 * SINGLE SOURCE OF TRUTH for all setting defaults. Every fallback value
 * across the codebase should flow through this module — never hardcode
 * defaults in other files.
 *
 * FALLBACK CHAIN (highest to lowest priority):
 *   1. Database value (set via admin Settings page)
 *   2. Environment variable from .env file (set by operator)
 *   3. Hardcoded DEFAULTS below
 *
 * Usage:
 *   getSetting('daily_cap')       → DB > env var > default
 *   getAllSettings()              → all DB + env + default merged
 */

import db from '../database/db.js';
import { getInboundWebhookUrl } from './gateway-service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  SINGLE SOURCE OF TRUTH — every default value lives here and nowhere else
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULTS = {
  // ── Branding ────────────────────────────────────────────────────────
  org_name:            'SMS Platform',
  sender_id:           'SMSGATEWAY',

  // ── Timing ──────────────────────────────────────────────────────────
  delay:               '1000',    // default delay between sends (ms) — faster for 100K/day
  window_start:        '00:00',
  window_end:          '23:59',

  // ── Volume limits ───────────────────────────────────────────────────
  daily_cap:                    '100000',  // system-wide daily cap
  max_concurrent_broadcasts:     '3',      // concurrent broadcasts
  max_broadcasts_per_agent:     '20',      // active broadcasts per agent
  max_recipients_per_broadcast: '50000',   // recipients per broadcast
  max_broadcasts_per_day_per_agent: '50',  // broadcasts per agent per day
  max_broadcast_duration_minutes: '0',     // auto-cancel after N minutes (0 = unlimited)

  // ── Turbo mode ──────────────────────────────────────────────────────
  turbo_delay:         '50',      // ms between turbo batches
  turbo_batch_size:    '10',      // messages per concurrent batch

  // ── Global pause ────────────────────────────────────────────────────
  broadcasts_globally_paused: 'false',

  // ── Timezone ────────────────────────────────────────────────────────
  timezone:            'Asia/Manila',

  // ── UI limits ───────────────────────────────────────────────────────
  max_selected_contacts: '200',

  // ── Networking ──────────────────────────────────────────────────────
  public_url:          '',
  webhook_secret:      '',
  ngrok_url:           '',
  ngrok_authtoken:     '',
  ngrok_domain:        '',
};

// ═══════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT VARIABLE FALLBACK MAP
//  Maps setting keys to .env variable names. When a setting has no DB value,
//  the corresponding env var is used as fallback.
// ═══════════════════════════════════════════════════════════════════════════

export const ENV_MAP = {
  // ── Networking ──────────────────────────────────────────────────────
  ngrok_authtoken: 'NGROK_AUTHTOKEN',
  ngrok_domain:    'NGROK_DOMAIN',
  public_url:      'PUBLIC_URL',
  ngrok_url:       'NGROK_URL',
  webhook_secret:  'WEBHOOK_SECRET',

  // ── Branding ────────────────────────────────────────────────────────
  org_name:  'ORG_NAME',
  sender_id: 'SENDER_ID',

  // ── Timing ──────────────────────────────────────────────────────────
  delay:        'DELAY',
  turbo_delay:  'TURBO_DELAY',
  turbo_batch_size: 'TURBO_BATCH_SIZE',
  window_start: 'WINDOW_START',
  window_end:   'WINDOW_END',
  timezone:     'TIMEZONE',

  // ── Volume limits ───────────────────────────────────────────────────
  daily_cap:                      'DAILY_CAP',
  max_concurrent_broadcasts:      'MAX_CONCURRENT_BROADCASTS',
  max_broadcasts_per_agent:       'MAX_BROADCASTS_PER_AGENT',
  max_recipients_per_broadcast:   'MAX_RECIPIENTS_PER_BROADCAST',
  max_broadcasts_per_day_per_agent: 'MAX_BROADCASTS_PER_DAY_PER_AGENT',
  max_broadcast_duration_minutes: 'MAX_BROADCAST_DURATION_MINUTES',
  max_selected_contacts:          'MAX_SELECTED_CONTACTS',

  // ── Global pause ────────────────────────────────────────────────────
  broadcasts_globally_paused: 'BROADCASTS_GLOBALLY_PAUSED',

  // Note: ADMIN_USERNAME / ADMIN_PASSWORD / SERVER_PORT are handled
  // directly by db.js (ensureAdminAccount) and app.js (resolveServerConfig)
  // — they are intentionally NOT included here to avoid leaking them
  // through the /api/settings endpoint.
};

// ═══════════════════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a setting value through the fallback chain:
 *   DB value > env var > hardcoded DEFAULTS
 *
 * @param {string} key  - Setting key (e.g. 'ngrok_authtoken')
 * @returns {string|null}
 */
function resolveValue(key) {
  // 1. Database
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== undefined && row.value !== '') {
    return row.value;
  }

  // 2. Environment variable
  const envName = ENV_MAP[key];
  if (envName && process.env[envName] !== undefined && process.env[envName] !== '') {
    return process.env[envName];
  }

  // 3. Hardcoded default
  return DEFAULTS[key] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a single setting by key.
 * Returns the first non-empty value via the chain: DB > env var > DEFAULTS.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function getSetting(key) {
  return resolveValue(key);
}

/**
 * Get all public-facing configuration values.
 *
 * Android gateways fetch this at /api/config after login to discover
 * the inbound webhook URL (supports ngrok tunnels).
 *
 * @returns {object}  { INBOUND_WEBHOOK_URL, ...other config }
 */
export function getPublicConfig() {
  const webhookUrl = getInboundWebhookUrl();
  return {
    INBOUND_WEBHOOK_URL: webhookUrl,
    ...getAllSettings(),
  };
}

/**
 * Get ALL settings, filling any missing keys from env vars then DEFAULTS.
 * The response is deterministic — every known key will always be present.
 *
 * @returns {object}  Flat key-value map
 */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULTS };

  // DB values override DEFAULTS
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) {
      settings[row.key] = row.value;
    }
  }

  // Environment variables fill in any empty/missing DB values
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    if ((!settings[key] || settings[key] === '') && process.env[envName] !== undefined && process.env[envName] !== '') {
      settings[key] = process.env[envName];
    }
  }

  return settings;
}

/**
 * Update settings in bulk.
 *
 * @param {object} updates - Key-value pairs to upsert
 * @returns {object}  Full settings map after update
 */
export function updateSettings(updates) {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const updateAll = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      upsert.run(key, String(value));
    }
  });
  updateAll();
  return getAllSettings();
}

/**
 * Return only the DEFAULTS object (for reset endpoints that need to
 * restore factory settings).
 *
 * @returns {object}
 */
export function getDefaults() {
  return { ...DEFAULTS };
}

/**
 * Return the ENV_MAP so other modules can reference env var names.
 *
 * @returns {object}
 */
export function getEnvMap() {
  return { ...ENV_MAP };
}
