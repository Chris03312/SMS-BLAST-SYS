/**
 * config-service.js — Application configuration service.
 *
 * Provides a central place to assemble and serve configuration
 * to clients (web UI and Android gateways).
 *
 * Central setting lookup pattern:
 *   getSetting('delay', 'DELAY', '6000')
 *   → reads DB key 'delay', falls back to env DELAY, then to '6000'
 */

import db from '../database/db.js';
import { getInboundWebhookUrl } from './gateway-service.js';

/**
 * Read a single setting with DB → env → default fallback chain.
 *
 * Database values always take precedence. If the DB key is missing or
 * empty, the corresponding env var is checked. If that's also missing,
 * the provided default is returned.
 *
 * @param {string}  dbKey      - Key in the settings table (e.g. 'delay')
 * @param {string}  [envVar]   - Env var name (e.g. 'DELAY'). Defaults to uppercased dbKey.
 * @param {string}  [defVal]   - Final fallback if DB and env are both empty.
 * @returns {string}
 */
export function getSetting(dbKey, envVar, defVal) {
  // Try DB first
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(dbKey);
    if (row && row.value && row.value.trim() !== '') return row.value.trim();
  } catch (_) {}
  // Fall back to env var
  const envKey = envVar || dbKey.replace(/([A-Z])/g, '_$1').toUpperCase();
  if (typeof process.env[envKey] !== 'undefined' && process.env[envKey] !== '') {
    return process.env[envKey];
  }
  // Final default
  return typeof defVal !== 'undefined' ? defVal : '';
}

/**
 * Read a numeric setting with DB → env → default fallback.
 *
 * @param {string}  dbKey      - Key in the settings table
 * @param {string}  [envVar]   - Env var name
 * @param {number}  [defVal]   - Default numeric value
 * @returns {number}
 */
export function getNumericSetting(dbKey, envVar, defVal) {
  const raw = getSetting(dbKey, envVar);
  if (raw !== '') {
    const num = parseInt(raw, 10);
    if (!isNaN(num)) return num;
  }
  return typeof defVal !== 'undefined' ? defVal : 0;
}

/**
 * Read a boolean setting with DB → env → default fallback.
 *
 * @param {string}  dbKey      - Key in the settings table
 * @param {string}  [envVar]   - Env var name
 * @param {boolean} [defVal]   - Default boolean value
 * @returns {boolean}
 */
export function getBooleanSetting(dbKey, envVar, defVal) {
  const raw = getSetting(dbKey, envVar);
  if (raw !== '') {
    return raw === 'true' || raw === '1';
  }
  return typeof defVal !== 'undefined' ? defVal : false;
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

  // Read all settings
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  return {
    INBOUND_WEBHOOK_URL: webhookUrl,
    ...settings,
  };
}

/**
 * Known setting keys with their env-var name and hardcoded default.
 * Used to resolve the active value when a DB row is missing or empty.
 */
const SETTING_DEFAULTS = {
  // Organisation
  org_name:                    { env: 'ORG_NAME',                    def: 'SMS Platform' },
  sender_id:                   { env: 'SENDER_ID',                   def: 'SMSGATEWAY' },
  // Sending behaviour
  delay:                       { env: 'DELAY',                       def: '6000' },
  turbo_delay:                 { env: 'TURBO_DELAY',                 def: '100' },
  turbo_batch_size:            { env: 'TURBO_BATCH_SIZE',            def: '5' },
  daily_cap:                   { env: 'DAILY_CAP',                   def: '10000' },
  max_concurrent_broadcasts:   { env: 'MAX_CONCURRENT_BROADCASTS',   def: '0' },
  max_broadcasts_per_agent:    { env: 'MAX_BROADCASTS_PER_AGENT',    def: '5' },
  max_recipients_per_broadcast: { env: 'MAX_RECIPIENTS_PER_BROADCAST', def: '0' },
  max_broadcast_duration_minutes:   { env: 'MAX_BROADCAST_DURATION_MINUTES',   def: '0' },
  max_broadcasts_per_day_per_agent: { env: 'MAX_BROADCASTS_PER_DAY_PER_AGENT', def: '0' },
  // Sending window
  window_start:                { env: 'WINDOW_START',                def: '00:00' },
  window_end:                  { env: 'WINDOW_END',                  def: '23:59' },
  // Timezone & pause
  timezone:                    { env: 'TIMEZONE',                    def: 'Asia/Manila' },
  broadcasts_globally_paused:  { env: 'BROADCASTS_GLOBALLY_PAUSED',  def: 'false' },
  // Public URL & ngrok
  public_url:                  { env: 'PUBLIC_URL',                  def: '' },
  ngrok_url:                   { env: 'NGROK_URL',                   def: '' },
  ngrok_authtoken:             { env: 'NGROK_AUTHTOKEN',             def: '' },
  ngrok_domain:                { env: 'NGROK_DOMAIN',                def: '' },
  // Webhook / API secret
  webhook_secret:              { env: 'WEBHOOK_SECRET',              def: '' },
  // Backup
  backup_enabled:              { env: 'BACKUP_ENABLED',              def: 'true' },
  backup_interval_minutes:     { env: 'BACKUP_INTERVAL_MINUTES',     def: '15' },
  backup_max_copies:           { env: 'BACKUP_MAX_COPIES',           def: '6' },
};

/**
 * Get the active value for a known setting key, resolving DB → env → default.
 * Returns the raw DB value if present, otherwise falls back to env var,
 * then to the hardcoded default.
 */
function resolveSetting(dbKey, dbValue) {
  // If DB has a non-empty value, return it immediately
  if (dbValue !== undefined && dbValue !== null && dbValue !== '') {
    return dbValue;
  }
  // Check for known defaults
  const meta = SETTING_DEFAULTS[dbKey];
  if (meta) {
    // Try env var
    if (typeof process.env[meta.env] !== 'undefined' && process.env[meta.env] !== '') {
      return process.env[meta.env];
    }
    // Return hardcoded default
    return meta.def;
  }
  // Unknown key — return as-is (could be empty)
  return dbValue ?? '';
}

/**
 * Get only the settings map (key-value pairs) with resolved values.
 * Each value is the active value: DB → env var → hardcoded default.
 * This ensures the admin Settings page always shows the actual value in use.
 */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = resolveSetting(row.key, row.value);
  }
  // Also include known settings that might not have DB rows yet
  for (const [key, meta] of Object.entries(SETTING_DEFAULTS)) {
    if (!(key in settings)) {
      settings[key] = resolveSetting(key, undefined);
    }
  }
  return settings;
}

/**
 * Update settings in bulk.
 *
 * @param {object} updates - Key-value pairs to upsert
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
