import { Router } from 'express';
import db from '../db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getGlobalStats, getUserStats, getSendingStatus } from '../services/stats-service.js';

const router = Router();

// ── Helper: wrap responses ───────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── Admin-level global stats ─────────────────────────────────────────

router.get('/', authMiddleware, (req, res) => {
  try {
    const stats = getGlobalStats();
    return ok(res, stats);
  } catch (e) {
    console.error('[stats] GET error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Simple sending status (used by Android gateways) ─────────────────

router.get('/status', (req, res) => {
  try {
    const status = getSendingStatus();
    return ok(res, status);
  } catch (e) {
    console.error('[stats] status error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Per-user scoped stats (used by Android gateways) ──────────────────
// Android ServerStatsPoller calls: GET /api/user/stats/:userId

router.get('/user/stats/:userId', (req, res) => {
  try {
    const stats = getUserStats(req.params.userId);
    return ok(res, { data: stats });
  } catch (e) {
    console.error('[stats] user stats error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Historical analytics (admin) ─────────────────────────────────────
// Returns time-series data grouped by day/week/month/year, plus per-user
// breakdown. Query params:
//   period  — 'day' | 'week' | 'month' | 'year'  (default 'day')
//   from    — ISO date start (default 30 days ago)
//   to      — ISO date end   (default today)
//   campaign_id — optional, filter by campaign

router.get('/historical', authMiddleware, adminOnly, (req, res) => {
  try {
    const period      = req.query.period || 'day';
    const to          = req.query.to   || new Date().toISOString().slice(0, 10);
    const from        = req.query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const campaignId  = req.query.campaign_id || null;

    // Build the date-truncation expression based on the requested period
    let dateExpr;
    if (period === 'year')      dateExpr = "strftime('%Y', m.sent_at)";
    else if (period === 'month') dateExpr = "strftime('%Y-%m', m.sent_at)";
    else if (period === 'week')  dateExpr = "strftime('%Y-%W', m.sent_at)";
    else                         dateExpr = "date(m.sent_at)";

    // Build campaign filter clause
    const campFilter = campaignId ? "AND b.campaign_id = ?" : "";

    // Time-series: messages sent/failed per period
    const seriesSql = `
      SELECT ${dateExpr} AS date,
             COUNT(CASE WHEN m.status = 'sent' THEN 1 END)   AS sent,
             COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed
      FROM messages m
      JOIN broadcasts b ON b.id = m.broadcast_id
      WHERE m.sent_at IS NOT NULL
        AND date(m.sent_at) >= ?
        AND date(m.sent_at) <= ?
        ${campFilter}
      GROUP BY ${dateExpr}
      ORDER BY date ASC
    `;
    const seriesParams = campaignId ? [from, to, campaignId] : [from, to];
    const series = db.prepare(seriesSql).all(...seriesParams);

    // Per-user breakdown (join messages → broadcasts → users)
    const byUserSql = `
      SELECT
        u.id          AS agent_id,
        u.display_name,
        u.username,
        COUNT(CASE WHEN m.status = 'sent'   THEN 1 END) AS sent,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed
      FROM messages m
      JOIN broadcasts b ON b.id = m.broadcast_id
      JOIN users u      ON u.id = b.agent_id
      WHERE m.sent_at IS NOT NULL
        AND date(m.sent_at) >= ?
        AND date(m.sent_at) <= ?
        ${campFilter}
      GROUP BY u.id
      ORDER BY sent DESC
    `;
    const byUser = db.prepare(byUserSql).all(...seriesParams);

    // Per-campaign breakdown (messages → broadcasts → campaigns)
    const byCampaignSql = `
      SELECT
        c.id   AS campaign_id,
        c.name AS campaign_name,
        COUNT(CASE WHEN m.status = 'sent'   THEN 1 END) AS sent,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed
      FROM messages m
      JOIN broadcasts b ON b.id = m.broadcast_id
      LEFT JOIN campaigns c ON c.id = b.campaign_id
      WHERE m.sent_at IS NOT NULL
        AND date(m.sent_at) >= ?
        AND date(m.sent_at) <= ?
        ${campFilter}
      GROUP BY c.id
      ORDER BY sent DESC
    `;
    const byCampaign = db.prepare(byCampaignSql).all(...seriesParams);

    // Per-gateway breakdown
    const byGatewaySql = `
      SELECT
        g.id   AS gateway_id,
        g.name AS gateway_name,
        g.number,
        g.number2,
        COUNT(CASE WHEN m.status = 'sent'   THEN 1 END) AS sent,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed
      FROM messages m
      JOIN broadcasts b ON b.id = m.broadcast_id
      JOIN gateways g ON g.id = m.gateway_id
      WHERE m.sent_at IS NOT NULL
        AND date(m.sent_at) >= ?
        AND date(m.sent_at) <= ?
        ${campFilter}
      GROUP BY g.id
      ORDER BY sent DESC
    `;
    const byGateway = db.prepare(byGatewaySql).all(...seriesParams);

    // Totals
    const totalsSql = `
      SELECT
        COUNT(CASE WHEN m.status = 'sent'   THEN 1 END) AS sent,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed
      FROM messages m
      JOIN broadcasts b ON b.id = m.broadcast_id
      WHERE m.sent_at IS NOT NULL
        AND date(m.sent_at) >= ?
        AND date(m.sent_at) <= ?
        ${campFilter}
    `;
    const totals = db.prepare(totalsSql).get(...seriesParams);

    const ts = totals || { sent: 0, failed: 0 };
    const totalSent   = ts.sent || 0;
    const totalFailed = ts.failed || 0;
    const deliveryRate = totalSent + totalFailed > 0
      ? Math.round((totalSent / (totalSent + totalFailed)) * 100)
      : 0;

    return ok(res, {
      series,
      by_user: byUser,
      by_gateway: byGateway,
      by_campaign: byCampaign,
      totals: {
        sent: totalSent,
        failed: totalFailed,
        delivery_rate: deliveryRate,
      },
      period,
      from,
      to,
    });
  } catch (e) {
    console.error('[stats] historical error:', e);
    return fail(res, 'Internal server error', 500);
  }
});


export default router;
