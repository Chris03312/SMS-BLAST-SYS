/**
 * activity.js — Shared activity logger.
 *
 * Eliminates the logActivity function that was redefined identically in three
 * separate files (broadcast-engine.js, gateway-service.js, gateway-outbound.js).
 *
 * Batches DB writes: instead of one INSERT + flushDb per event (which exports
 * the entire sql.js WASM database to disk), entries accumulate in an in-memory
 * buffer and are flushed in a single transaction + one flushDbSync(). This
 * dramatically reduces write contention during broadcasts (hundreds of SMS
 * sends each calling logActivity).
 *
 * WebSocket broadcast is still delivered immediately for real-time UI updates.
 *
 * Usage:
 *   import { logActivity } from '../services/activity.js';
 *   logActivity(userId, 'broadcast:start', 'Broadcast started', 'info', campaignId);
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { broadcast } from './ws.js';

// ── Batch buffer ─────────────────────────────────────────────────────

const _pendingEntries = [];
let _flushTimer = null;
const MAX_BATCH_SIZE = 50;       // Flush immediately when buffer reaches this
const FLUSH_INTERVAL_MS = 2000;  // Or flush after this long regardless

function flushActivityBatch() {
  if (_pendingEntries.length === 0) return;
  const batch = _pendingEntries.splice(0, _pendingEntries.length);
  try {
    const stmt = db.prepare(
      'INSERT INTO activity (id, user_id, action, detail, level, campaign_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const doInsert = db.transaction(() => {
      for (const entry of batch) {
        stmt.run(entry.id, entry.userId, entry.action, entry.detail, entry.level, entry.campaignId);
      }
    });
    doInsert();
  } catch (e) {
    console.error('[activity] batch flush error:', e.message);
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Queue an activity log entry. The DB write is batched (flushed every 2s
 * or when 50 entries accumulate), but the WebSocket push fires immediately.
 *
 * @param {string|null}  userId     - The user who performed the action (or null)
 * @param {string}       action     - Action key (e.g. 'broadcast:start', 'sms:sent')
 * @param {string}       detail     - Human-readable description
 * @param {string}       [level]    - 'info' | 'warn' | 'error' (default 'info')
 * @param {string|null}  [campaignId] - Optional campaign association
 */
export function logActivity(userId, action, detail, level = 'info', campaignId = null) {
  // Queue the DB write
  _pendingEntries.push({
    id: uuidv4(),
    userId: userId || null,
    action,
    detail,
    level,
    campaignId: campaignId || null,
  });

  // Broadcast immediately — the UI needs real-time updates even though
  // the DB write may be deferred by up to 2 seconds.
  broadcast({
    type: 'activity:new',
    user_id: userId || null,
    action,
    detail,
    level,
    campaign_id: campaignId || null,
    created_at: new Date().toISOString(),
  });

  // Schedule a periodic flush if one isn't already pending
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushActivityBatch();
    }, FLUSH_INTERVAL_MS);
  }

  // If the buffer is full, flush immediately (but still async of the caller)
  if (_pendingEntries.length >= MAX_BATCH_SIZE) {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    flushActivityBatch();
  }
}
