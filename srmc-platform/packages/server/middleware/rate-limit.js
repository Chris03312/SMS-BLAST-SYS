/**
 * middleware/rate-limit.js — API rate limiting using express-rate-limit.
 *
 * Each limiter reads its limit from a RATE_LIMIT_* env var. Set to 0 to
 * disable rate limiting for an endpoint. All use the same window duration
 * from RATE_LIMIT_WINDOW_MS (default 60 000 ms = 1 minute).
 */

import rateLimit from 'express-rate-limit';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;

/**
 * Create a rate limiter for a specific endpoint.
 * @param {string} envVar - e.g. 'RATE_LIMIT_LOGIN'
 * @param {number} defaultMax - fallback if env var is not set or invalid
 * @param {object} [opts] - additional express-rate-limit options
 * @returns {import('express').RequestHandler | function} middleware (or dummy if disabled)
 */
function createLimiter(envVar, defaultMax, opts = {}) {
  const max = parseInt(process.env[envVar], 10);
  // If explicitly set to 0 (or NaN after parseInt), disable rate limiting
  if (max === 0 || Number.isNaN(max)) {
    return (req, res, next) => next();
  }

  return rateLimit({
    windowMs: WINDOW_MS,
    max: max || defaultMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: 'Too many requests — please slow down.',
    },
    ...opts,
  });
}

// ── Named limiters ─────────────────────────────────────────────────────

/** Auth login — per IP */
export const loginLimiter = createLimiter('RATE_LIMIT_LOGIN', 10, {
  skipSuccessfulRequests: true, // only count failed attempts
});

/** Broadcast creation — per user */
export const broadcastLimiter = createLimiter('RATE_LIMIT_BROADCAST', 30);

/** Inbound webhook — per IP (ngrok / gateway calls) */
export const webhookLimiter = createLimiter('RATE_LIMIT_WEBHOOK', 300);

/** Gateway outbound polling — per IP */
export const gatewayOutboundLimiter = createLimiter('RATE_LIMIT_GATEWAY_OUTBOUND', 60);

/** Ngrok tunnel start/stop — per user */
export const ngrokLimiter = createLimiter('RATE_LIMIT_NGROK', 5);

export default { loginLimiter, broadcastLimiter, webhookLimiter, gatewayOutboundLimiter, ngrokLimiter };
