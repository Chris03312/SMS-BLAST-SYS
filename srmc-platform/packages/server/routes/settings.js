import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getAllSettings, updateSettings } from '../services/config-service.js';
import db from '../database/db.js';
import { broadcast } from '../services/ws.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    const settings = getAllSettings();
    return ok(res, { settings });
  } catch (e) {
    console.error('[settings] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/', adminOnly, (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return fail(res, 'Body must be a key-value object', 400);
    }
    const settings = updateSettings(updates);
    // Broadcast a real-time event so all clients (and the broadcast engine)
    // know settings have changed and can re-read relevant values from DB.
    broadcast({
      type: 'settings:changed',
      keys: Object.keys(updates),
      changed_by: req.user.id,
    });
    return ok(res, { settings });
  } catch (e) {
    console.error('[settings] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Danger Zone ──────────────────────────────────────────────────────────────

/**
 * POST /api/settings/purge-activity — Delete all activity log entries.
 */
router.post('/purge-activity', adminOnly, (req, res) => {
  try {
    if (req.body.confirm !== true && req.body.confirm !== 'true') {
      return fail(res, 'Confirmation required. Set { "confirm": true } to proceed.', 400);
    }
    db.prepare('DELETE FROM activity').run();
    console.log('[settings] Activity log purged by', req.user.id);
    broadcast({ type: 'activity:purged', purged_by: req.user.id });
    return ok(res, { success: true, message: 'Activity log purged.' });
  } catch (e) {
    console.error('[settings] purge-activity error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/settings/reset — Reset all settings to factory defaults.
 */
router.post('/reset', adminOnly, (req, res) => {
  try {
    if (req.body.confirm !== true && req.body.confirm !== 'true') {
      return fail(res, 'Confirmation required. Set { "confirm": true } to proceed.', 400);
    }
    const defaults = [
      ['org_name',       'SMS Platform'],
      ['sender_id',      'SMSGATEWAY'],
      ['delay',          '6000'],
      ['window_start',   '00:00'],
      ['window_end',     '23:59'],
      ['daily_cap',               '10000'],
      ['max_concurrent_broadcasts', '0'],
      ['max_broadcasts_per_agent',  '5'],
      ['turbo_delay',               '100'],
      ['turbo_batch_size',           '5'],
      ['timezone',                  'Asia/Manila'],
      ['public_url',     ''],
      ['backup_enabled', 'true'],
      ['backup_interval_minutes', '15'],
      ['backup_max_copies', '6'],
    ];
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const resetAll = db.transaction(() => {
      for (const [key, value] of defaults) {
        upsert.run(key, String(value));
      }
    });
    resetAll();
    console.log('[settings] All settings reset to defaults by', req.user.id);
    const settings = getAllSettings();
    // Broadcast so clients and engine pick up the reset values
    broadcast({ type: 'settings:changed', keys: Object.keys(settings), changed_by: req.user.id });
    return ok(res, { settings, message: 'Settings reset to factory defaults.' });
  } catch (e) {
    console.error('[settings] reset error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/settings/revoke-sessions — Revoke all gateway tokens, forcing re-login.
 */
router.post('/revoke-sessions', adminOnly, (req, res) => {
  try {
    if (req.body.confirm !== true && req.body.confirm !== 'true') {
      return fail(res, 'Confirmation required. Set { "confirm": true } to proceed.', 400);
    }
    db.prepare('DELETE FROM gateway_tokens').run();
    console.log('[settings] All sessions revoked by', req.user.id);
    broadcast({ type: 'sessions:revoked', revoked_by: req.user.id });
    return ok(res, { success: true, message: 'All sessions revoked. Gateways must log in again.' });
  } catch (e) {
    console.error('[settings] revoke-sessions error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

/**
 * POST /api/settings/toggle-pause — Toggle the global broadcast kill switch.
 * Body: { paused: true|false }
 */
router.post('/toggle-pause', adminOnly, (req, res) => {
  try {
    const { paused } = req.body;
    const nowPaused = paused === true || paused === 'true';
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('broadcasts_globally_paused', ?)").run(String(nowPaused));
    console.log('[settings] Global broadcast pause toggled to', nowPaused, 'by', req.user.id);
    broadcast({
      type: 'broadcasts:global-pause',
      paused: nowPaused,
      toggled_by: req.user.id,
    });
    return ok(res, { paused: nowPaused, message: nowPaused ? 'All broadcasts paused.' : 'Broadcasts resumed.' });
  } catch (e) {
    console.error('[settings] toggle-pause error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
