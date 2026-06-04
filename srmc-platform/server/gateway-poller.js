import fetch from 'node-fetch';
import db from './db.js';
import { broadcast } from './ws.js';

async function checkGateway(gateway) {
  let status = 'offline';
  let lastBeat = gateway.last_beat;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

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
      } else {
        status = 'offline';
      }
    } else {
      status = 'offline';
    }
  } catch (e) {
    // Determine slow vs offline based on last_beat
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

  // Count sent_today
  const todayStr = new Date().toISOString().slice(0, 10);
  const sentToday = db.prepare(
    `SELECT COUNT(*) as c FROM messages WHERE gateway_id = ? AND status = 'sent' AND sent_at LIKE ?`
  ).get(gateway.id, `${todayStr}%`);

  db.prepare(`UPDATE gateways SET status = ?, last_beat = ?, sent_today = ? WHERE id = ?`)
    .run(status, lastBeat, sentToday ? sentToday.c : 0, gateway.id);

  broadcast({
    type: 'gateway:status',
    gatewayId: gateway.id,
    status,
    last_beat: lastBeat,
    sent_today: sentToday ? sentToday.c : 0,
  });
}

export function startPoller() {
  async function poll() {
    const gateways = db.prepare('SELECT * FROM gateways WHERE active = 1').all();
    for (const gateway of gateways) {
      try {
        await checkGateway(gateway);
      } catch (e) {
        console.error('[poller] Error checking gateway', gateway.id, e.message);
      }
    }
  }

  // Run immediately, then every 30s
  poll();
  setInterval(poll, 30000);
  console.log('[poller] Gateway poller started');
}

export async function checkGatewayNow(gatewayId) {
  const gateway = db.prepare('SELECT * FROM gateways WHERE id = ?').get(gatewayId);
  if (!gateway) return null;
  await checkGateway(gateway);
  return db.prepare('SELECT * FROM gateways WHERE id = ?').get(gatewayId);
}
