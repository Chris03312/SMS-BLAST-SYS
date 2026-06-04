import { Router } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

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
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const level = req.query.level;
    const userId = req.query.user_id;

    let query = `
      SELECT a.*, u.display_name as user_name, c.name as campaign_name
      FROM activity a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN campaigns c ON a.campaign_id = c.id
    `;
    const conditions = [];
    const params = [];

    if (level && level !== 'all') {
      conditions.push('a.level = ?');
      params.push(level);
    }

    if (userId) {
      conditions.push('a.user_id = ?');
      params.push(userId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const activities = db.prepare(query).all(...params);
    const total = db.prepare(
      `SELECT COUNT(*) as c FROM activity a ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}`
    ).get(...params.slice(0, -2));

    return ok(res, { activities, total: total ? total.c : 0, limit, offset });
  } catch (e) {
    console.error('[activity] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
