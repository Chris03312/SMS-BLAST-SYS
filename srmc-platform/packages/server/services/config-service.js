/**
 * config-service.js — Application configuration service.
 *
 * Provides a central place to assemble and serve configuration
 * to clients (web UI and Android gateways).
 */

import db from '../db.js';
import { getInboundWebhookUrl } from './gateway-service.js';

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
 * Get only the settings map (key-value pairs).
 */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
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
