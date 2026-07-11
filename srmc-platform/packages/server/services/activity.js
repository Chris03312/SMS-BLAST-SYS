/**
 * activity.js — Shared activity logger.
 *
 * Eliminates the logActivity function that was redefined identically in three
 * separate files (broadcast-engine.js, gateway-service.js, gateway-outbound.js).
 *
 * Usage:
 *   import { logActivity } from '../services/activity.js';
 *   logActivity(userId, 'broadcast:start', 'Broadcast started', 'info', campaignId);
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { broadcast } from './ws.js';

/**
 * Insert an activity log entry and broadcast it via WebSocket.
 *
 * @param {string|null}  userId     - The user who performed the action (or null)
 * @param {string}       action     - Action key (e.g. 'broadcast:start', 'sms:sent')
 * @param {string}       detail     - Human-readable description
 * @param {string}       [level]    - 'info' | 'warn' | 'error' (default 'info')
 * @param {string|null}  [campaignId] - Optional campaign association
 */
export function logActivity(userId, action, detail, level = 'info', campaignId = null) {
  try {
    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail, level, campaign_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId || null, action, detail, level, campaignId || null);
    broadcast({
      type: 'activity:new',
      user_id: userId || null,
      action,
      detail,
      level,
      campaign_id: campaignId || null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[activity] logActivity error:', e.message);
  }
}
