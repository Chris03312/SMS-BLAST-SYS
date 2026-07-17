/**
 * stats-service.js — Reusable stats query logic extracted from route handlers.
 *
 * Centralises all dashboard / stats SQL so route files stay thin.
 */

import db from '../database/db.js';

/**
 * Global 7-day stats (admin dashboard).
 *
 * @returns {object}  { sent_7d, delivery_rate, active_agents, failed_7d, sent_by_gateway, gateways_status, daily }
 */
export function getGlobalStats() {
  // ── Daily sent_today reset for gateways table ─────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastReset = db.prepare("SELECT value FROM settings WHERE key = 'sent_today_date'").get();
  if (!lastReset || lastReset.value !== todayStr) {
    db.prepare('UPDATE gateways SET sent_today = 0').run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sent_today_date', ?)").run(todayStr);
  }

  // Count sent messages directly from the messages table (7 days)
  const sentMsg = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE status IN ('sent', 'delivered')
      AND sent_at >= datetime('now', '-7 days')
  `).get();

  // Count failed messages directly from the messages table (7 days)
  const failedMsg = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE status = 'failed'
      AND created_at >= datetime('now', '-7 days')
  `).get();

  // Count failed messages TODAY
  const failedToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE status = 'failed'
      AND created_at >= (date('now') || ' 00:00:00')
      AND created_at < (date('now', '+1 day') || ' 00:00:00')
  `).get();

  // Count ALL sent messages (all time)
  const allTimeSent = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE status IN ('sent', 'delivered')
  `).get();

  // Count sent messages TODAY
  const sentToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages
    WHERE status IN ('sent', 'delivered')
      AND sent_at >= (date('now') || ' 00:00:00')
      AND sent_at < (date('now', '+1 day') || ' 00:00:00')
  `).get();

  const totalSentToday = sentToday ? sentToday.total : 0;
  const totalSent7d = sentMsg ? sentMsg.total : 0;
  const totalFailed7d = failedMsg ? failedMsg.total : 0;
  const totalFailedToday = failedToday ? failedToday.total : 0;
  const totalAllTime = allTimeSent ? allTimeSent.total : 0;
  const deliveryRate = totalSent7d + totalFailed7d > 0
    ? Math.round((totalSent7d / (totalSent7d + totalFailed7d)) * 100)
    : 0;

  const activeAgents = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'agent' AND active = 1`).get();

  const sentByGateway = db.prepare(`
    SELECT g.id, g.name, g.status, g.sim_carrier,
      COALESCE(SUM(CASE WHEN m.sent_at >= date('now') THEN 1 ELSE 0 END), 0) as sent_today
    FROM gateways g
    LEFT JOIN messages m ON m.gateway_id = g.id AND m.status = 'sent'
    WHERE g.active = 1
    GROUP BY g.id
  `).all();

  // Daily sent counts from messages table (by sent_at)
  const sentDaily = db.prepare(`
    SELECT date(sent_at) as day, COUNT(*) as sent
    FROM messages
    WHERE status IN ('sent', 'delivered')
      AND sent_at >= datetime('now', '-7 days')
    GROUP BY date(sent_at)
    ORDER BY day ASC
  `).all();

  // Daily failed counts from messages table (by created_at)
  const failedDaily = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as failed
    FROM messages
    WHERE status = 'failed'
      AND created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  // Merge sent and failed by day
  const dayMap = {};
  for (const r of sentDaily) dayMap[r.day] = { day: r.day, sent: r.sent, failed: 0 };
  for (const r of failedDaily) {
    if (dayMap[r.day]) dayMap[r.day].failed = r.failed;
    else dayMap[r.day] = { day: r.day, sent: 0, failed: r.failed };
  }
  const daily = Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day));

  const gatewaysStatus = db.prepare(`
    SELECT id, name, status, last_beat, last_online, device_info, sent_today, sim_carrier, url
    FROM gateways
    WHERE active = 1
  `).all();

  return {
    sent_7d: totalSent7d,
    sent_today: totalSentToday,
    total_all_time: totalAllTime,
    delivery_rate: deliveryRate,
    active_agents: activeAgents ? activeAgents.c : 0,
    failed_7d: totalFailed7d,
    failed_today: totalFailedToday,
    sent_today_by_gateway: sentByGateway,
    gateways_status: gatewaysStatus,
    daily,
  };
}

/**
 * Per-user stats (what the Android gateway polls).
 *
 * Counts from the **messages** table directly so that in-progress
 * broadcasts are reflected in real time, not just completed ones.
 *
 * @param {string} userId  - The user / gateway ID
 * @returns {object}  { sentToday, failedToday, queuedToday, phone }
 */
export function getUserStats(userId) {
  // Sent today for this user — count messages with status 'sent' or 'delivered'
  const sentToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages m
    JOIN broadcasts b ON b.id = m.broadcast_id
    WHERE b.agent_id = ?
      AND m.status IN ('sent', 'delivered')
      AND m.sent_at >= (date('now') || ' 00:00:00')
      AND m.sent_at < (date('now', '+1 day') || ' 00:00:00')
  `).get(userId);

  // Failed today
  const failedToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages m
    JOIN broadcasts b ON b.id = m.broadcast_id
    WHERE b.agent_id = ?
      AND m.status = 'failed'
      AND m.created_at >= (date('now') || ' 00:00:00')
      AND m.created_at < (date('now', '+1 day') || ' 00:00:00')
  `).get(userId);

  // Queued (not yet sent) — pending, queued, or sending
  const queuedToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM messages m
    JOIN broadcasts b ON b.id = m.broadcast_id
    WHERE b.agent_id = ?
      AND m.status IN ('queued', 'pending', 'sending')
      AND m.created_at >= (date('now') || ' 00:00:00')
      AND m.created_at < (date('now', '+1 day') || ' 00:00:00')
  `).get(userId);

  // Get user's active phone / gateway info
  const gateway = db.prepare(`
    SELECT url, sim_carrier FROM gateways
    WHERE id = ? AND active = 1
  `).get(userId);

  return {
    sentToday: sentToday ? sentToday.total : 0,
    failedToday: failedToday ? failedToday.total : 0,
    queuedToday: queuedToday ? queuedToday.total : 0,
    phone: gateway ? gateway.url || '' : '',
  };
}

/**
 * Simple sending status (used by Android's /api/status endpoint).
 *
 * @returns {object}  { canceled, message }
 */
export function getSendingStatus() {
  // Check if there are any in-progress broadcasts
  const active = db.prepare(`
    SELECT COUNT(*) as c FROM broadcasts WHERE status = 'sending'
  `).get();

  return {
    canceled: active ? active.c === 0 : true,
    message: active && active.c > 0
      ? `${active.c} broadcast(s) in progress`
      : 'No active broadcasts',
  };
}
