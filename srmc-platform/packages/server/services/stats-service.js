/**
 * stats-service.js — Reusable stats query logic extracted from route handlers.
 *
 * Centralises all dashboard / stats SQL so route files stay thin.
 */

import db from '../db.js';

/**
 * Global 7-day stats (admin dashboard).
 *
 * @returns {object}  { sent_7d, delivery_rate, active_agents, failed_7d, sent_by_gateway, gateways_status, daily }
 */
export function getGlobalStats() {
  const sent7d = db.prepare(`
    SELECT COALESCE(SUM(sent), 0) as total
    FROM broadcasts
    WHERE created_at >= datetime('now', '-7 days')
      AND status = 'done'
  `).get();

  const failed7d = db.prepare(`
    SELECT COALESCE(SUM(failed), 0) as total
    FROM broadcasts
    WHERE created_at >= datetime('now', '-7 days')
  `).get();

  const totalSent7d = sent7d ? sent7d.total : 0;
  const totalFailed7d = failed7d ? failed7d.total : 0;
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

  const daily = db.prepare(`
    SELECT date(created_at) as day, COALESCE(SUM(sent), 0) as sent, COALESCE(SUM(failed), 0) as failed
    FROM broadcasts
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all();

  const gatewaysStatus = db.prepare(`
    SELECT id, name, status, last_beat, last_online, device_info, sent_today, sim_carrier, url
    FROM gateways
    WHERE active = 1
  `).all();

  return {
    sent_7d: totalSent7d,
    delivery_rate: deliveryRate,
    active_agents: activeAgents ? activeAgents.c : 0,
    failed_7d: totalFailed7d,
    sent_today_by_gateway: sentByGateway,
    gateways_status: gatewaysStatus,
    daily,
  };
}

/**
 * Per-user stats (what the Android gateway polls).
 *
 * @param {string} userId  - The user / gateway ID
 * @returns {object}  { sentToday, failedToday, queuedToday, phone }
 */
export function getUserStats(userId) {
  const today = new Date().toISOString().slice(0, 10);

  // Sent today for this user
  const sentToday = db.prepare(`
    SELECT COALESCE(SUM(sent), 0) as total
    FROM broadcasts
    WHERE agent_id = ?
      AND created_at >= ?
      AND status = 'done'
  `).get(userId, today);

  // Failed today
  const failedToday = db.prepare(`
    SELECT COALESCE(SUM(failed), 0) as total
    FROM broadcasts
    WHERE agent_id = ?
      AND created_at >= ?
  `).get(userId, today);

  // Queued (pending) broadcasts
  const queuedToday = db.prepare(`
    SELECT COUNT(*) as total
    FROM broadcasts
    WHERE agent_id = ?
      AND created_at >= ?
      AND status = 'pending'
  `).get(userId, today);

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
