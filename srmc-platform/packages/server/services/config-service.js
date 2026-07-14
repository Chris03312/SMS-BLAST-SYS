/**
 * config-service.js — Application configuration service.
 *
 * SINGLE SOURCE OF TRUTH for all setting defaults. Every fallback value
 * across the codebase should flow through this module — never hardcode
 * defaults in other files.
 *
 * Usage:
 *   getSetting('daily_cap')       → returns DB value or DEFAULTS['daily_cap']
 *   getAllSettings()              → all DB values + any missing keys filled from DEFAULTS
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
//  Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a single setting by key.
 * Returns the DB value if present, otherwise the DEFAULTS value.
 * @param {string} key
 * @returns {string|null}
 */
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row && row.value !== null && row.value !== undefined) return row.value;
  return DEFAULTS[key] ?? null;
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
 * Get ALL settings, filling any missing keys from DEFAULTS.
 * The response is deterministic — every known key will always be present.
 *
 * @returns {object}  Flat key-value map
 */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    settings[row.key] = row.value;
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
