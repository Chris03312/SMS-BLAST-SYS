/**
 * format.js — Shared date/time formatting utilities.
 *
 * Timezone is configurable via setTimezone(). Defaults to Asia/Manila.
 * Call setTimezone(value) from your app to apply the admin's preference.
 */

let TZ = 'Asia/Manila';

/**
 * Override the display timezone used by all date/time formatters.
 * @param {string} tz - A valid IANA timezone string (e.g. 'Asia/Manila')
 */
export function setTimezone(tz) {
  if (tz) TZ = tz;
}

/** Get the currently configured timezone. */
export function getTimezone() {
  return TZ;
}

/**
 * Format a date for display: "25 Jan 2026, 02:30 PM"
 */
export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-PH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
  } catch {
    return '—';
  }
}

/**
 * Short date: "25 Jan 2026"
 */
export function formatDateShort(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-PH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: TZ,
    });
  } catch {
    return '—';
  }
}

/**
 * Time only: "02:30 PM"
 */
export function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    });
  } catch {
    return '—';
  }
}

/**
 * Relative time: "2m ago", "5h ago", "3d ago"
 */
export function formatRelative(iso) {
  if (!iso) return '—';
  try {
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now - date;
    const secs = Math.floor(diffMs / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDateShort(iso);
  } catch {
    return '—';
  }
}

/**
 * Number formatted for Philippine locale (e.g. 123,456)
 */
export function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-PH');
}
