/**
 * fix-timestamps.js — Normalizes date/timestamp fields from SQLite
 * so they display consistently across the frontend.
 *
 * SQLite's datetime('now') returns UTC timestamps WITHOUT a timezone
 * marker (e.g. "2026-07-05 08:30:00"). When the browser's new Date()
 * parses these, some engines treat them as local time instead of UTC.
 *
 * This utility ensures every date-like field ends with "Z" (UTC marker)
 * so the client's timezone-aware formatters (format.js) display the
 * correct local time.
 */

// Fields that contain timestamps from SQLite
const TIMESTAMP_FIELDS = new Set([
  'created_at',
  'updated_at',
  'started_at',
  'completed_at',
  'sent_at',
  'last_beat',
  'last_online',
  'last_poll',
  'expires_at',
  'read_at',
]);

/**
 * Walk an object (or array of objects) and ensure all date-like fields
 * end with "Z" so the browser treats them as UTC.
 *
 * @param {object|object[]} data  - Record(s) to normalize
 * @returns {object|object[]}  Same structure with normalized dates
 */
export function fixTimestamps(data) {
  if (Array.isArray(data)) {
    return data.map(row => fixTimestamps(row));
  }
  if (data && typeof data === 'object') {
    const out = { ...data };
    for (const [key, val] of Object.entries(out)) {
      if (typeof val === 'string' && TIMESTAMP_FIELDS.has(key)) {
        // Append Z if missing so the browser treats it as UTC
        if (val && !val.endsWith('Z')) {
          out[key] = val.replace(' ', 'T') + 'Z';
        }
      }
    }
    return out;
  }
  return data;
}

export default fixTimestamps;
