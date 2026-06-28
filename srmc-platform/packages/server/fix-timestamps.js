/**
 * fix-timestamps.js — Normalizes date/timestamp fields from SQLite
 * so they display consistently across the frontend.
 *
 * SQLite stores dates as ISO strings. This utility ensures all date
 * fields are properly handled before sending to the client.
 */

/**
 * Walk an object (or array of objects) and ensure all date-like fields
 * are returned as ISO strings. Currently a pass-through — SQLite already
 * gives us ISO strings, but this provides a single point to fix any
 * date formatting in the future.
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
      // If it looks like a date string (ISO format), pass through
      // No transformation needed — SQLite already stores ISO strings
      // This function exists as a single place to add date fixes later
    }
    return out;
  }
  return data;
}

export default fixTimestamps;
