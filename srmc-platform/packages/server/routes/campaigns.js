import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { fixTimestamps } from '../fix-timestamps.js';

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
    const campaigns = db.prepare(`
      SELECT c.*, u.display_name as owner_name,
        (SELECT COUNT(*) FROM broadcasts b WHERE b.campaign_id = c.id) as broadcast_count,
        (SELECT COALESCE(SUM(b.sent), 0) FROM broadcasts b WHERE b.campaign_id = c.id) as total_sent
      FROM campaigns c
      LEFT JOIN users u ON c.owner_id = u.id
      ORDER BY c.created_at DESC
    `).all();
    return ok(res, { campaigns: fixTimestamps(campaigns) });
  } catch (e) {
    console.error('[campaigns] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', (req, res) => {
  try {
    const { name, status } = req.body;
    if (!name) {
      return fail(res, 'Name is required', 400);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO campaigns (id, name, owner_id, status) VALUES (?, ?, ?, ?)')
      .run(id, name, req.user.id, status || 'active');

    return ok(res, { campaign: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) }, 201);
  } catch (e) {
    console.error('[campaigns] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/:id', (req, res) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) {
      return fail(res, 'Campaign not found', 404);
    }

    const { name, status } = req.body;
    db.prepare('UPDATE campaigns SET name = ?, status = ? WHERE id = ?')
      .run(name ?? campaign.name, status ?? campaign.status, req.params.id);

    return ok(res, { campaign: db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[campaigns] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
