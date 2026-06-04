import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
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
    const templates = db.prepare(`
      SELECT t.*, u.display_name as creator_name
      FROM templates t
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `).all();
    return ok(res, { templates });
  } catch (e) {
    console.error('[templates] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', (req, res) => {
  try {
    const { name, body, category, variables, dlt_id } = req.body;
    if (!name || !body) {
      return fail(res, 'Name and body are required', 400);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO templates (id, name, body, category, variables, dlt_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, body, category || 'transactional', JSON.stringify(variables || []), dlt_id || null, req.user.id);

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

    const { name, body, category, variables, dlt_id } = req.body;

    db.prepare(`UPDATE templates SET name = ?, body = ?, category = ?, variables = ?, dlt_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(
        name ?? template.name,
        body ?? template.body,
        category ?? template.category,
        variables !== undefined ? JSON.stringify(variables) : template.variables,
        dlt_id !== undefined ? dlt_id : template.dlt_id,
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
    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[templates] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
