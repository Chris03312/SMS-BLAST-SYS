import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../secrets.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

export function superAdminOnly(req, res, next) {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Super admin access required' });
}

export { JWT_SECRET };
