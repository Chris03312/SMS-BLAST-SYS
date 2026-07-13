/**
 * timezone.js — Centralised server-side timezone management.
 *
 * Reads the configured timezone from the settings table and keeps
 * process.env.TZ in sync so that server-side Date() operations use
 * the admin's chosen timezone (not just a hardcoded default).
 *
 * Usage:
 *   import { initTimezone, applyTimezone, getTimezone } from './services/timezone.js';
 *   initTimezone();          // called once at startup
 *   applyTimezone('UTC');    // update on-the-fly (e.g. after settings save)
 *   const tz = getTimezone();  // read current value
 */

import db from '../database/db.js';

const FALLBACK_TZ = 'Asia/Manila';

/**
 * Read the configured timezone from settings.
 * Returns the IANA timezone string or the fallback.
 */
export function getTimezone() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
    return (row && row.value) || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

/**
 * Apply a timezone by updating process.env.TZ.
 * In Node.js this affects all subsequent new Date() operations.
 *
 * @param {string} tz - IANA timezone string (e.g. 'Asia/Manila', 'UTC')
 */
export function applyTimezone(tz) {
  const resolved = tz || getTimezone();
  process.env.TZ = resolved;
  // Force V8 to re-read the TZ env var for subsequent Date() calls.
  // Creating a Date after changing TZ forces ICU to re-read the env.
  // eslint-disable-next-line no-new
  new Date();
}

/**
 * Initialise the timezone at server startup.
 * Call once before any date-dependent operations.
 */
export function initTimezone() {
  const tz = getTimezone();
  applyTimezone(tz);
  console.log(`[timezone] Initialised to "${process.env.TZ}"`);
}

export default { initTimezone, applyTimezone, getTimezone };
