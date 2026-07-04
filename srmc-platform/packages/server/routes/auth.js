import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authMiddleware, JWT_SECRET } from '../middleware/auth.js';
import { fixTimestamps } from '../fix-timestamps.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── User login (web clients) ─────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return fail(res, 'Username and password are required', 400);
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user) {
      return fail(res, 'Invalid credentials', 401);
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return fail(res, 'Invalid credentials', 401);
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash, ...userSafe } = user;

    return ok(res, { token, user: userSafe });
  } catch (e) {
    console.error('[auth] Login error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ? AND active = 1'
    ).get(req.user.id);
    if (!user) {
      return fail(res, 'User not found', 404);
    }
    return ok(res, { user: fixTimestamps(user) });
  } catch (e) {
    console.error('[auth] Me error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
