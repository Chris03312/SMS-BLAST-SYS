import { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getAllSettings, updateSettings } from '../services/config-service.js';

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
    return ok(res, { settings });
  } catch (e) {
    console.error('[settings] PUT error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
