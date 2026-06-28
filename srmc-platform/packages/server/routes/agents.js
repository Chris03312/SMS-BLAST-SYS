import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { fixTimestamps } from '../fix-timestamps.js';
import { authMiddleware, adminOnly, superAdminOnly } from '../middleware/auth.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

router.use(authMiddleware, adminOnly);

router.get('/', (req, res) => {
  try {
    const agents = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.active, u.created_at,
        (SELECT COUNT(*) FROM broadcasts b WHERE b.agent_id = u.id) as broadcast_count,
        (SELECT COALESCE(SUM(b.sent), 0) FROM broadcasts b WHERE b.agent_id = u.id AND b.created_at >= date('now', '-1 day')) as sent_today
      FROM users u
      WHERE u.role = 'agent'
      ORDER BY u.created_at DESC
    `).all();
    return ok(res, { agents: fixTimestamps(agents) });
  } catch (e) {
    console.error('[agents] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, password, display_name, role } = req.body;
    if (!username || !password) {
      return fail(res, 'Username and password are required', 400);
    }

    // Only super_admin can create admin/super_admin accounts; anyone admin+ can create agents
    const targetRole = (role === 'admin' || role === 'super_admin') ? role : 'agent';
    if (targetRole !== 'agent' && req.user.role !== 'super_admin') {
      return fail(res, 'Only super admins can create admin accounts', 403);
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return fail(res, 'Username already exists', 409);
    }

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`)
      .run(id, username, hash, display_name || username, targetRole);

    const agent = db.prepare('SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?').get(id);
    return ok(res, { agent }, 201);
  } catch (e) {
    console.error('[agents] POST error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'agent');
    if (!agent) {
      return fail(res, 'Agent not found', 404);
    }

    const { display_name, password, active } = req.body;
    let hash = agent.password_hash;
    if (password) {
      hash = await bcrypt.hash(password, 10);
    }

    db.prepare('UPDATE users SET display_name = ?, password_hash = ?, active = ? WHERE id = ?')
      .run(
        display_name ?? agent.display_name,
        hash,
        active !== undefined ? (active ? 1 : 0) : agent.active,
        req.params.id
      );

    return ok(res, { agent: db.prepare('SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[agents] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const agent = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'agent');
    if (!agent) {
      return fail(res, 'Agent not found', 404);
    }
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[agents] DELETE error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Admin management (super_admin only) ──────────────────────────────

router.get('/admins', superAdminOnly, (req, res) => {
  try {
    const admins = db.prepare(`
      SELECT id, username, display_name, role, active, created_at
      FROM users
      WHERE role IN ('admin', 'super_admin')
      ORDER BY created_at DESC
    `).all();
    return ok(res, { admins: fixTimestamps(admins) });
  } catch (e) {
    console.error('[agents] GET /admins error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.put('/admins/:id', superAdminOnly, async (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND role IN (?, ?)').get(req.params.id, 'admin', 'super_admin');
    if (!user) {
      return fail(res, 'Admin user not found', 404);
    }

    // Can't demote the last super_admin
    if (user.role === 'super_admin') {
      const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin'").get();
      if (count && count.c <= 1 && req.body.active === 0) {
        return fail(res, 'Cannot deactivate the last super admin', 400);
      }
    }

    const { display_name, password, active } = req.body;
    let hash = user.password_hash;
    if (password) {
      hash = await bcrypt.hash(password, 10);
    }

    db.prepare('UPDATE users SET display_name = ?, password_hash = ?, active = ? WHERE id = ?')
      .run(
        display_name ?? user.display_name,
        hash,
        active !== undefined ? (active ? 1 : 0) : user.active,
        req.params.id
      );

    return ok(res, { admin: db.prepare('SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?').get(req.params.id) });
  } catch (e) {
    console.error('[agents] PUT /admins error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.delete('/admins/:id', superAdminOnly, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND role IN (?, ?)').get(req.params.id, 'admin', 'super_admin');
    if (!user) {
      return fail(res, 'Admin user not found', 404);
    }

    // Can't delete the last super_admin
    if (user.role === 'super_admin') {
      const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'super_admin'").get();
      if (count && count.c <= 1) {
        return fail(res, 'Cannot delete the last super admin', 400);
      }
    }

    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
    return ok(res, { success: true });
  } catch (e) {
    console.error('[agents] DELETE /admins error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
