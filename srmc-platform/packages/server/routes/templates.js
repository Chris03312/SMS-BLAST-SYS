import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { fixTimestamps } from '../utils/fix-timestamps.js';

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
    // Agents see only their own templates + templates created by admins.
    // Admins see every template.
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

    let sql;
    let params;
    if (isAdmin) {
      sql = `
        SELECT t.*, u.display_name as creator_name, u.role as creator_role, c.name as campaign_name
        FROM templates t
        LEFT JOIN users u ON t.created_by = u.id
        LEFT JOIN campaigns c ON t.campaign_id = c.id
        ORDER BY t.created_at DESC
      `;
      params = [];
    } else {
      sql = `
        SELECT t.*, u.display_name as creator_name, u.role as creator_role, c.name as campaign_name
        FROM templates t
        LEFT JOIN users u ON t.created_by = u.id
        LEFT JOIN campaigns c ON t.campaign_id = c.id
        WHERE t.created_by = ?
           OR t.created_by IN (SELECT id FROM users WHERE role IN ('admin', 'super_admin'))
        ORDER BY t.created_at DESC
      `;
      params = [req.user.id];
    }

    const templates = db.prepare(sql).all(...params);
    return ok(res, { templates: fixTimestamps(templates) });
  } catch (e) {
    console.error('[templates] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', (req, res) => {
  try {
    const { name, body, category, variables, campaign_id } = req.body;
    if (!name || !body) {
      return fail(res, 'Name and body are required', 400);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO templates (id, name, body, category, variables, created_by, campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, body, category || 'transactional', JSON.stringify(variables || []), req.user.id, campaign_id || null);

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return ok(res, { template }, 201);
  } catch (e) {
    console.error('[templates] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/:id', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) {
      return fail(res, 'Template not found', 404);
    }

    // Agents cannot modify templates created by admins
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      const creator = db.prepare('SELECT role FROM users WHERE id = ?').get(template.created_by);
      if (creator && (creator.role === 'admin' || creator.role === 'super_admin')) {
        return fail(res, 'Admin-created templates cannot be modified by agents', 403);
      }
    }

    const { name, body, category, variables, campaign_id } = req.body;

    db.prepare(`UPDATE templates SET name = ?, body = ?, category = ?, variables = ?, campaign_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(
        name ?? template.name,
        body ?? template.body,
        category ?? template.category,
        variables !== undefined ? JSON.stringify(variables) : template.variables,
        campaign_id !== undefined ? campaign_id : template.campaign_id,
        req.params.id
      );

    return ok(res, { template: db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[templates] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!template) {
      return fail(res, 'Template not found', 404);
    }

    // Agents cannot delete templates created by admins
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    if (!isAdmin) {
      const creator = db.prepare('SELECT role FROM users WHERE id = ?').get(template.created_by);
      if (creator && (creator.role === 'admin' || creator.role === 'super_admin')) {
        return fail(res, 'Admin-created templates cannot be deleted by agents', 403);
      }
    }

    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[templates] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
