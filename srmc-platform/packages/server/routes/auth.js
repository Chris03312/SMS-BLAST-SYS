import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../database/db.js';
import { authMiddleware, JWT_SECRET } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rate-limit.js';
import { fixTimestamps } from '../utils/fix-timestamps.js';

const router = Router();

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── User login (web clients) ─────────────────────────────────────────

router.post('/login', loginLimiter, async (req, res) => {
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

    // Track last login time so the admin panel can show active/inactive status
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

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

// ── Change password (web clients) ─────────────────────────────────────

router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return fail(res, 'Current password and new password are required', 400);
    }
    if (newPassword.length < 4) {
      return fail(res, 'New password must be at least 4 characters', 400);
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return fail(res, 'User not found', 404);
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return fail(res, 'Current password is incorrect', 401);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

    return ok(res, { message: 'Password updated successfully' });
  } catch (e) {
    console.error('[auth] Change password error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
