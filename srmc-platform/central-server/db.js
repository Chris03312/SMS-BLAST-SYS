/**
 * central-server/db.js — sql.js database for the central monitoring server.
 */

import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, 'data');
const DB_PATH   = join(DATA_DIR, 'central.db');

mkdirSync(DATA_DIR, { recursive: true });

const SQL    = await initSqlJs();
const rawDb = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

let saveTimer = null;
function scheduleFlush() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = rawDb.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  }, 200);
}

class Statement {
  constructor(sql) { this._sql = sql; }
  _params(args) { return args; }
  get(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }
  all(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
  run(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    stmt.step();
    const changes = rawDb.getRowsModified();
    stmt.free();
    scheduleFlush();
    return { changes };
  }
}

class Database {
  exec(sql) { rawDb.run(sql); scheduleFlush(); }
  prepare(sql) { return new Statement(sql); }
  transaction(fn) {
    return () => {
      rawDb.run('BEGIN');
      try { fn(); rawDb.run('COMMIT'); } catch (e) { rawDb.run('ROLLBACK'); throw e; }
      scheduleFlush();
    };
  }
  pragma() {}
}

export const db = new Database();

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      install_id         TEXT PRIMARY KEY,
      org_name           TEXT DEFAULT '',
      hostname           TEXT DEFAULT '',
      platform           TEXT DEFAULT '',
      arch               TEXT DEFAULT '',
      cpus               INTEGER DEFAULT 0,
      total_mem          TEXT DEFAULT '',
      node_ver           TEXT DEFAULT '',
      app_ver            TEXT DEFAULT '',
      ngrok_url          TEXT DEFAULT '',
      ngrok_running      INTEGER DEFAULT 0,
      messages_sent_today INTEGER DEFAULT 0,
      messages_sent_total INTEGER DEFAULT 0,
      messages_failed    INTEGER DEFAULT 0,
      gateways_online    INTEGER DEFAULT 0,
      total_gateways     INTEGER DEFAULT 0,
      last_seen          TEXT,
      first_seen         TEXT DEFAULT (datetime('now')),
      created_at         TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stats_snapshots (
      id                   TEXT PRIMARY KEY,
      install_id          TEXT NOT NULL,
      timestamp           TEXT NOT NULL,
      uptime              TEXT DEFAULT '',
      messages_sent_today  INTEGER DEFAULT 0,
      messages_sent_total  INTEGER DEFAULT 0,
      messages_failed     INTEGER DEFAULT 0,
      messages_pending    INTEGER DEFAULT 0,
      gateways_online     INTEGER DEFAULT 0,
      gateways_total      INTEGER DEFAULT 0,
      users_total         INTEGER DEFAULT 0,
      broadcasts_active   INTEGER DEFAULT 0,
      broadcasts_total    INTEGER DEFAULT 0,
      inbound_total       INTEGER DEFAULT 0,
      inbound_unread      INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_stats_install_id ON stats_snapshots(install_id);
    CREATE INDEX IF NOT EXISTS idx_stats_timestamp ON stats_snapshots(timestamp);
  `);

  console.log('[central-db] Database ready at', DB_PATH);
}
