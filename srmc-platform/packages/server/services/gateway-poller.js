import fetch from 'node-fetch';
import db from '../database/db.js';
import { broadcast } from './ws.js';

async function checkGateway(gateway) {
  let status = 'offline';
  let lastBeat = gateway.last_beat;
  let lastError = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // Reduced from 5s to 2s

    const res = await fetch(`${gateway.url}/health`, {
      headers: {
        ...(gateway.token ? { Authorization: `Bearer ${gateway.token}` } : {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'ok') {
        status = 'online';
        lastBeat = new Date().toISOString();
        lastError = null;
      } else {
        status = 'offline';
        lastError = 'Gateway returned unhealthy status';
      }
    } else if (res.status === 401) {
      status = 'offline';
      lastError = 'Unauthorized — gateway token is invalid or rejected';
    } else if (res.status === 403) {
      status = 'offline';
      lastError = 'Forbidden — access denied by gateway';
    } else {
      status = 'offline';
      lastError = `HTTP ${res.status} — gateway returned error status`;
    }
  } catch (e) {
    // Determine slow vs offline based on last_beat
    if (e.name === 'AbortError') {
      lastError = 'Not responding — connection timed out (5s)';
    } else if (e.code === 'ECONNREFUSED') {
      lastError = 'Connection refused — gateway is not running or wrong port';
    } else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
      lastError = 'Host unreachable — check IP address or network';
    } else if (e.code === 'ECONNRESET') {
      lastError = 'Connection reset — gateway closed the connection';
    } else {
      lastError = e.message || 'Unknown error';
    }

    if (gateway.last_beat) {
      const lastBeatTime = new Date(gateway.last_beat).getTime();
      const diffMs = Date.now() - lastBeatTime;
      if (diffMs < 2 * 60 * 1000) {
        status = 'slow';
      } else {
        status = 'offline';
      }
    } else {
      status = 'offline';
    }
  }

  try {
    // Count sent_today
    const todayStr = new Date().toISOString().slice(0, 10);
    const sentToday = db.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE gateway_id = ? AND status = 'sent' AND sent_at LIKE ?`
    ).get(gateway.id, `${todayStr}%`);

    db.prepare(`UPDATE gateways SET status = ?, last_beat = ?, sent_today = ?, last_error = ? WHERE id = ?`)
      .run(status, lastBeat, sentToday ? sentToday.c : 0, lastError, gateway.id);

    broadcast({
      type: 'gateway:status',
      gatewayId: gateway.id,
      status,
      last_beat: lastBeat,
      sent_today: sentToday ? sentToday.c : 0,
      last_error: lastError,
    });
  } catch (dbErr) {
    console.error('[poller] DB update failed for gateway', gateway.id, ':', typeof dbErr === 'string' ? dbErr : (dbErr?.message || 'unknown'));
  }
}

export function startPoller() {
  async function poll() {
    // Skip pull-mode gateways — they have no reachable HTTP server.
    // They self-register with url='' and work by polling the central server
    // for outbound work instead.
    const gateways = db.prepare("SELECT * FROM gateways WHERE active = 1 AND (mode != 'pull' OR mode IS NULL)").all();
    for (const gateway of gateways) {
      try {
        await checkGateway(gateway);
      } catch (e) {
        console.error('[poller] Error checking gateway', gateway.id, typeof e === 'string' ? e : (e?.message || 'unknown'));
      }
    }
  }

  // Catch unhandled promise rejections. sql.js can throw "Statement closed"
  // (a plain string, not an Error) when DDL invalidates cached prepared
  // statements. The Statement class now auto-recovers from this, but the
  // async wrapper still produces a rejected promise that must be caught.
  poll().catch(err => {
    const msg = typeof err === 'string' ? err : (err?.message || 'unknown');
    console.error('[poller] Poll cycle failed:', msg);
  });
  setInterval(() => {
    poll().catch(err => {
      const msg = typeof err === 'string' ? err : (err?.message || 'unknown');
      console.error('[poller] Poll cycle failed:', msg);
    });
  }, 30000);
  console.log('[poller] Gateway poller started');
}

export async function checkGatewayNow(gatewayId, overrideToken) {
  let gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(gatewayId);
  if (!gateway) return null;
  // If an override token is provided, use it instead of the DB-stored one.
  // This lets the frontend test with a newly typed token before saving.
  if (overrideToken !== undefined) {
    gateway = { ...gateway, token: overrideToken };
  }
  await checkGateway(gateway);
  return db.prepare('SELECT * FROM gateways WHERE id = ?').get(gatewayId);
}
