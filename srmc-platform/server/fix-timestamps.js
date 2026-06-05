/**
 * fix-timestamps.js — SQLite datetime fixer.
 *
 * SQLite's datetime('now') returns UTC timestamps in "YYYY-MM-DD HH:MM:SS"
 * format WITHOUT timezone info. When the browser parses these with
 * `new Date("2026-06-05 15:15:00")`, it treats them as LOCAL time instead
 * of UTC, causing an 8-hour offset for PH-time users.
 *
 * This helper recursively walks API response objects and appends 'Z' to
 * any string that looks like a bare SQLite datetime, so `new Date()` knows
 * it's UTC and converts to the viewer's timezone correctly.
 */

const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Recursively walk an object/array and append 'Z' to any string that
 * matches a bare SQLite datetime (no timezone suffix).
 *
 * Mutates in place for performance, then returns the same reference.
 */
export function fixTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) fixTimestamps(item);
  } else if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string' && SQLITE_DATETIME_RE.test(val)) {
        obj[key] = val.replace(' ', 'T') + 'Z';
      } else if (typeof val === 'object' && val !== null) {
        fixTimestamps(val);
      }
    }
  }
  return obj;
}
