/**
 * db.js — sql.js (WASM) wrapper that mimics the better-sqlite3 API.
 *
 * Why: better-sqlite3 is a native addon that needs Python + node-gyp to compile.
 * sql.js is pure WebAssembly — zero native deps, works everywhere.
 *
 * Public API exposed (matches better-sqlite3):
 *   db.prepare(sql)           → Statement
 *   db.exec(sql)              → void  (runs multi-statement DDL/DML)
 *   db.transaction(fn)        → () => void  (BEGIN/COMMIT wrapper)
 *   db.pragma(str)            → void  (no-op — WAL not needed for WASM)
 *
 * Statement API:
 *   stmt.get(...args)         → first row as plain object, or undefined
 *   stmt.all(...args)         → all rows as array of plain objects
 *   stmt.run(...args)         → { changes }
 */

import initSqlJs from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '../utils/phone.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Writable data directory.
//   - Electron (packaged): main.js sets SRMC_DATA_DIR to app.getPath('userData')
//     because the app folder (app.asar / Program Files) is read-only.
//   - Standalone / dev: falls back to <repo>/data.
const DATA_DIR = process.env.SRMC_DATA_DIR || join(__dirname, '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'srmc.db');

mkdirSync(DATA_DIR, { recursive: true });

// ── Bootstrap sql.js (top-level await — ES module) ──────────────────────────
// Resolve the WASM binary explicitly so it loads both in dev and when packaged
// inside Electron (sql.js must be listed under build.asarUnpack so the .wasm
// exists on disk; Electron's patched fs then reads it through the asar path).
const SQL_DIST = dirname(require.resolve('sql.js'));
const SQL = await initSqlJs({
  locateFile: (file) => join(SQL_DIST, file),
});
const rawDb = existsSync(DB_PATH)
  ? new SQL.Database(readFileSync(DB_PATH))
  : new SQL.Database();

// ── Debounced disk flush ──────────────────────────────────────────────
// sql.js keeps the DB in memory; flushDbSync() exports the entire database
// to disk. For sql.js, this serializes the whole DB to a byte buffer (~50 MB)
// and writes it synchronously — blocking the event loop the whole time.
//
// Every Statement.run() outside a transaction triggers a flush, meaning
// rapid writes (activity logs, heartbeat updates, contact marks) would
// each export the entire 50 MB DB — extremely slow.
//
// Solution: debounce the flush so multiple writes within a short window
// (200 ms) result in a single disk write. Critical operations (transactions,
// bulk inserts) still call flushDbSync() immediately.

let _flushTimer = null;

/**
 * Debounced flush — batches rapid writes into one disk sync.
 * Used by Statement.run() for individual non-transactional writes.
 */
export function flushDb() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushDbSync();
  }, 200);
}

/**
 * Immediate (synchronous) flush — exports the entire DB to disk right now.
 * Used by transactions, bulk inserts, external shutdown hooks, and backup.
 */
export function flushDbSync() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  try {
    const data = rawDb.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('[db] Flush failed:', e.message);
  }
}

// ── Periodic backups ─────────────────────────────────────────────────
// Every 15 minutes, write a copy of the DB to a numbered backup file.
// Keeps the last 6 backups (90 minutes of history).
const BACKUP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKUPS = 6;

function startBackupSchedule() {
  setInterval(() => {
    try {
      // Rotate backups: remove oldest, shift others
      for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
        const oldPath = DB_PATH.replace('.db', `.backup.${i}.db`);
        const newPath = DB_PATH.replace('.db', `.backup.${i + 1}.db`);
        if (existsSync(oldPath)) {
          try {
            renameSync(oldPath, newPath);
          } catch (_) {
            // If rename fails (cross-device), copy + delete
            try {
              copyFileSync(oldPath, newPath);
              unlinkSync(oldPath);
            } catch (_) { }
          }
        }
      }
      // Write new backup
      const data = rawDb.export();
      const backupPath = DB_PATH.replace('.db', '.backup.1.db');
      writeFileSync(backupPath, Buffer.from(data));
      // console.log('[db] Backup saved to', backupPath.replace(DATA_DIR, ''));
    } catch (e) {
      console.error('[db] Backup failed:', e.message);
    }
  }, BACKUP_INTERVAL_MS);
}

// ── Backup on boot (migrate old backups) ─────────────────────────────
// If no backups exist yet, create one immediately
function createInitialBackup() {
  const backupPath = DB_PATH.replace('.db', '.backup.1.db');
  if (!existsSync(backupPath)) {
    try {
      const data = rawDb.export();
      writeFileSync(backupPath, Buffer.from(data));
      console.log('[db] Initial backup created');
    } catch (e) {
      console.error('[db] Initial backup failed:', e.message);
    }
  }
}

// ── Statement wrapper with prepared-statement cache ──────────────────
// Each Statement wraps a single compiled sql.js statement handle.
// Instead of calling rawDb.prepare() + .free() on every query (which
// compiles SQL → WASM bytecode every time), the handle is compiled once
// and reused with .reset() between calls. This ~3–5× faster for repeated
// queries like the hundreds of db.prepare('SELECT ... WHERE id = ?') calls
// across all route files.
//
// The cache lives on Database._stmtCache (Map<sqlString, Statement>).
// It's unbounded but the number of unique SQL patterns in the app is
// small (~100), so memory is negligible.

class Statement {
  constructor(sql) {
    this._sql = sql;
    this._stmt = rawDb.prepare(sql);
  }

  // Normalize variadic positional args to a flat array.
  // Handles both .get(a, b, c) and .get(...arr) — both arrive as individual args.
  _params(args) {
    if (args.length === 0) return [];
    return args;
  }

  /**
   * Execute a sql.js statement operation with auto-recovery from
   * "Statement closed" errors.
   *
   * sql.js can throw "Statement closed" (as a plain string, not an Error)
   * when the underlying compiled SQLite statement has been finalized.
   * This happens because SQLite finalizes ALL prepared statements whenever
   * a DDL statement (CREATE INDEX, ALTER TABLE, etc.) runs against the
   * database connection. Since initDb() runs 50+ DDLs on every boot, and
   * route handlers may run cached statements before or between DDL blocks,
   * any cached statement can become invalid.
   *
   * When caught, we re-prepare the statement from rawDb and retry once.
   * This makes the cache robust regardless of when DDL runs.
   */
  _exec(mode, args) {
    let tries = 0;
    while (tries < 2) {
      try {
        this._stmt.reset();
        const p = this._params(args);
        if (p.length) this._stmt.bind(p);

        if (mode === 'get') {
          return this._stmt.step() ? this._stmt.getAsObject() : undefined;
        }
        if (mode === 'all') {
          const rows = [];
          while (this._stmt.step()) rows.push(this._stmt.getAsObject());
          return rows;
        }
        // run
        this._stmt.step();
        const changes = rawDb.getRowsModified();
        if (!db._inTransaction && !db._initMode) flushDb();
        return { changes };
      } catch (e) {
        tries++;
        // sql.js throws "Statement closed" as a STRING, not an Error
        const isClosed = e === 'Statement closed' ||
          (typeof e === 'object' && e && e.message === 'Statement closed');
        if (tries >= 2 || !isClosed) {
          throw e;
        }
        // Re-prepare: the underlying WASM statement was finalized
        this._stmt = rawDb.prepare(this._sql);
      }
    }
  }

  /** Returns the first row as a plain object, or undefined. */
  get(...args) {
    return this._exec('get', args);
  }

  /** Returns all rows as an array of plain objects. */
  all(...args) {
    return this._exec('all', args);
  }

  /** Executes INSERT / UPDATE / DELETE. Returns { changes }. */
  run(...args) {
    return this._exec('run', args);
  }

  /**
   * Free the underlying WASM statement handle.
   * Called during cache cleanup; never needed during normal operation.
   */
  free() {
    try { this._stmt.free(); } catch (_) { }
  }

  /** Return the SQL text this statement was compiled from. */
  get sql() { return this._sql; }
}

// ── Database wrapper ─────────────────────────────────────────────────────────

class Database {
  /** Tracks whether we are inside a BEGIN/COMMIT transaction. */
  _inTransaction = false;

  /**
   * When true, Statement.run() skips the debounced flushDb() and exec()
   * skips flushDbSync(). Set during initDb() so that 40+ schema migrations
   * and seed inserts don't each export the full sql.js database to disk.
   * A single flushDbSync() is called after _initMode is turned off.
   */
  _initMode = false;

  /** Runs one or many SQL statements (DDL, bulk DML, etc.). */
  exec(sql) {
    rawDb.run(sql);
    if (!this._initMode) flushDbSync();
  }

  /** Cache of compiled sql.js statements keyed by SQL text. */
  _stmtCache = new Map();

  /** Returns a cached (or newly compiled) Statement for the given SQL. */
  prepare(sql) {
    if (this._stmtCache.has(sql)) {
      return this._stmtCache.get(sql);
    }
    const stmt = new Statement(sql);
    this._stmtCache.set(sql, stmt);
    return stmt;
  }

  /**
   * Free all cached prepared statements. Call during graceful shutdown
   * to release WASM memory. Not needed during normal operation.
   */
  freeAll() {
    for (const stmt of this._stmtCache.values()) stmt.free();
    this._stmtCache.clear();
  }

  /**
   * Wraps a function in BEGIN/COMMIT.
   * Returns a zero-arg callable — matches the better-sqlite3 pattern:
   *   const doInsert = db.transaction(() => { ... });
   *   doInsert();
   *
   * Skips per-statement flushDb() during the transaction (handled once
   * after COMMIT). ROLLBACK is guarded so a failed COMMIT doesn't trigger
   * "cannot rollback - no transaction is active".
   */
  transaction(fn) {
    return () => {
      rawDb.run('BEGIN');
      this._inTransaction = true;
      try {
        fn();
        rawDb.run('COMMIT');
      } catch (e) {
        try { rawDb.run('ROLLBACK'); } catch (_) { /* guard: no active txn */ }
        throw e;
      } finally {
        this._inTransaction = false;
      }
      flushDbSync();
    };
  }

  /**
   * Bulk-insert many rows into a table without flushing to disk after each row.
   * Uses a single prepared statement, binds each row, and flushes ONCE at the end.
   *
   * This is MUCH faster than calling .run() in a loop (which flushes per call).
   * For 100K rows, flushDb time drops from minutes to under a second.
   *
   * Manages its own transaction (not using this.transaction()) to avoid
   * statement free/allocate overhead per row. The _inTransaction flag is
   * set here so per-statement flushDb is skipped.
   *
   * @param {string} table  - Table name
   * @param {string[]} columns - Column names
   * @param {Array[]} rows   - Array of value arrays (one per row)
   */
  bulkInsert(table, columns, rows) {
    if (!rows.length) return;
    const placeholders = columns.map(() => '?').join(',');
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
    const stmt = rawDb.prepare(sql);
    rawDb.run('BEGIN');
    this._inTransaction = true;
    try {
      for (const row of rows) {
        stmt.bind(row);
        stmt.step();
        stmt.reset();
      }
      rawDb.run('COMMIT');
    } catch (e) {
      try { rawDb.run('ROLLBACK'); } catch (_) { /* guard: no active txn */ }
      stmt.free();
      throw e;
    } finally {
      this._inTransaction = false;
    }
    stmt.free();
    flushDbSync();
  }

  /** No-op — WAL journal mode is not meaningful for an in-memory WASM DB. */
  pragma() { }
}

const db = new Database();

// ── Schema + seed ────────────────────────────────────────────────────────────

export function initDb() {
  const t0 = Date.now();
  // ── Bulk init mode ───────────────────────────────────────────────────
  // Suppress all intermediate flushDb() / flushDbSync() calls during
  // schema creation, migrations, and seed inserts. A single flushDbSync()
  // at the end exports the initialized database to disk once.
  db._initMode = true;

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role         TEXT NOT NULL DEFAULT 'agent',
      active       INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gateways (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      token       TEXT,
      sim_carrier TEXT,
      status      TEXT DEFAULT 'unknown',
      last_beat   TEXT,
      last_online TEXT,
      device_info TEXT,
      sent_today  INTEGER DEFAULT 0,
      active      INTEGER DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gateway_tokens (
      id         TEXT PRIMARY KEY,
      gateway_id TEXT NOT NULL,
      token      TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      owner_id   TEXT,
      status     TEXT DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      body        TEXT NOT NULL,
      category    TEXT DEFAULT 'transactional',
      variables   TEXT DEFAULT '[]',
      created_by  TEXT,
      use_count   INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS broadcasts (
      id           TEXT PRIMARY KEY,
      agent_id     TEXT,
      campaign_id  TEXT,
      template_id  TEXT,
      gateway_id   TEXT,
      gateway_ids  TEXT NOT NULL DEFAULT '[]',
      distribution TEXT NOT NULL DEFAULT 'round-robin',
      message      TEXT NOT NULL,
      recipients   TEXT NOT NULL,
      total        INTEGER DEFAULT 0,
      sent         INTEGER DEFAULT 0,
      failed       INTEGER DEFAULT 0,
      status       TEXT DEFAULT 'pending',
      delay_ms     INTEGER DEFAULT 6000,
      started_at   TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      broadcast_id TEXT,
      to_number    TEXT NOT NULL,
      message      TEXT NOT NULL,
      status       TEXT DEFAULT 'queued',
      error        TEXT,
      gateway_id   TEXT,
      sent_at      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inbound (
      id          TEXT PRIMARY KEY,
      from_number TEXT NOT NULL,
      body        TEXT NOT NULL,
      flag        TEXT,
      read_at     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gateway_numbers (
      id           TEXT PRIMARY KEY,
      gateway_id   TEXT NOT NULL,
      gateway_name TEXT NOT NULL DEFAULT '',
      agent_name   TEXT DEFAULT '',
      number       TEXT,
      number2      TEXT,
      sim_carrier  TEXT,
      sim2_carrier TEXT,
      changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity (
      id         TEXT PRIMARY KEY,
      user_id    TEXT,
      action     TEXT NOT NULL,
      detail     TEXT,
      level      TEXT DEFAULT 'info',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- ── Performance indexes ────────────────────────────────────────────
    -- messages: the most heavily queried table
    CREATE INDEX IF NOT EXISTS idx_messages_broadcast_id    ON messages(broadcast_id);
    CREATE INDEX IF NOT EXISTS idx_messages_gateway_id_status ON messages(gateway_id, status);
    CREATE INDEX IF NOT EXISTS idx_messages_to_number       ON messages(to_number);
    CREATE INDEX IF NOT EXISTS idx_messages_status          ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_sent_at         ON messages(sent_at);

    -- broadcasts: filtered by agent, status, campaign, and time ranges
    CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_id      ON broadcasts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_status        ON broadcasts(status);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at    ON broadcasts(created_at);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_campaign_id   ON broadcasts(campaign_id);

    -- campaigns: owner-based filtering
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id    ON campaigns(owner_id);

    -- templates: creator-based filtering
    CREATE INDEX IF NOT EXISTS idx_templates_created_by  ON templates(created_by);

    -- users: role-based filtering for dashboards and agent management
    CREATE INDEX IF NOT EXISTS idx_users_role               ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_role_active        ON users(role, active);

    -- gateways: poller filtering and online/offline counting
    CREATE INDEX IF NOT EXISTS idx_gateways_status          ON gateways(status);
    -- idx_gateways_active_mode is created after migrations (below)
    -- since it references the 'mode' column added by migration.

    -- inbound: time-ordered listing, enrichment lookups
    -- idx_inbound_agent_id is created after migrations (below)
    -- since it references the 'agent_id' column added by migration.
    CREATE INDEX IF NOT EXISTS idx_inbound_created_at       ON inbound(created_at);
    CREATE INDEX IF NOT EXISTS idx_inbound_read_at          ON inbound(read_at);

    -- activity: user-scoped timeline queries
    CREATE INDEX IF NOT EXISTS idx_activity_user_id         ON activity(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created_at      ON activity(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_action          ON activity(action);

    -- gateway_tokens: per-gateway cleanup on logout
    CREATE INDEX IF NOT EXISTS idx_gateway_tokens_gateway_id ON gateway_tokens(gateway_id);
    -- gateway_numbers: search by gateway_id
    CREATE INDEX IF NOT EXISTS idx_gateway_numbers_gateway_id ON gateway_numbers(gateway_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_numbers_changed_at ON gateway_numbers(changed_at);
  `);

  // Seed default settings only on a fresh database. No demo/dummy accounts.
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (!existing || existing.c === 0) {
    // Default settings
    for (const [key, value] of [
      ['org_name', 'SMS Platform'],
      ['sender_id', 'SMSGATEWAY'],
      ['delay', '1000'],
      ['window_start', '00:00'],
      ['window_end', '23:59'],
      ['webhook_secret', 'whsec_' + uuidv4().replace(/-/g, '')],
      ['ngrok_url', ''],
      ['daily_cap', '100000'],
      ['max_concurrent_broadcasts', '3'],
      ['max_broadcasts_per_agent', '20'],
      ['max_recipients_per_broadcast', '50000'],
      ['max_broadcast_duration_minutes', '0'],
      ['max_broadcasts_per_day_per_agent', '50'],
      ['broadcasts_globally_paused', 'false'],
      ['turbo_delay', '50'],
      ['turbo_batch_size', '10'],
      ['timezone', 'Asia/Manila'],
      ['public_url', ''],
    ]) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }

    console.log('[db] Fresh database initialised — no dummy data');
  }

  // ── Migrations for existing databases ────────────────────────────────
  // These add new columns to tables that may have been created by an older version.
  // ALTER TABLE ADD COLUMN throws if the column already exists, so we catch silently.
  const migrations = [
    "ALTER TABLE gateways ADD COLUMN last_online TEXT",
    "ALTER TABLE gateways ADD COLUMN device_info TEXT",
    "ALTER TABLE broadcasts ADD COLUMN gateway_ids TEXT DEFAULT '[]'",
    "ALTER TABLE broadcasts ADD COLUMN distribution TEXT DEFAULT 'round-robin'",
    // 'push' = server POSTs to gateway.url (LAN). 'pull' = phone polls for work
    // (works across networks; gateway self-registers on login with no url).
    "ALTER TABLE gateways ADD COLUMN mode TEXT DEFAULT 'push'",
    // When a pull gateway last fetched its outbound queue.
    "ALTER TABLE gateways ADD COLUMN last_poll TEXT",
    // The SIM's own phone number (sender), used in send logs. May be set by the
    // admin or reported by the phone on login.
    "ALTER TABLE gateways ADD COLUMN number TEXT",
    // Link inbound messages to the agent who sent the broadcast they reply to.
    "ALTER TABLE inbound ADD COLUMN agent_id TEXT",
    // Agent contact list for admin-distributed recipient numbers
    "ALTER TABLE gateways ADD COLUMN consecutive_fails INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS agent_contacts (
      id           TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL,
      batch_id     TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      used         INTEGER DEFAULT 0,
      broadcast_id TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Link activity entries to campaigns for the admin Activity Log.
    "ALTER TABLE activity ADD COLUMN campaign_id TEXT",
    // Second SIM phone number for dual-SIM gateways
    "ALTER TABLE gateways ADD COLUMN number2 TEXT",
    // SIM 2 carrier name (auto-reported by Android gateway)
    "ALTER TABLE gateways ADD COLUMN sim2_carrier TEXT",
    // Whether turbo mode is allowed for this gateway
    "ALTER TABLE gateways ADD COLUMN turbo_enabled INTEGER DEFAULT 0",
    // Track consecutive delivery failures from carrier delivery reports
    "ALTER TABLE gateways ADD COLUMN delivery_fails INTEGER DEFAULT 0",
    // Human-readable last error message (e.g. "HTTP 401 Unauthorized", "Connection refused")
    "ALTER TABLE gateways ADD COLUMN last_error TEXT",
    // SIM mode for dual-SIM gateways: 'sim1' (SIM 1 only) or 'sim2' (SIM 2 only)
    "ALTER TABLE broadcasts ADD COLUMN sim_mode TEXT DEFAULT 'sim1'",
    // Per-broadcast scheduled send start/end time (stored as HH:MM)
    "ALTER TABLE broadcasts ADD COLUMN send_start_at TEXT",
    "ALTER TABLE broadcasts ADD COLUMN send_end_at TEXT",
    // Starting SIM for round-robin mode: 'sim1' or 'sim2'
    "ALTER TABLE broadcasts ADD COLUMN sim_round_start TEXT DEFAULT 'sim1'",
    // Which gateway received this inbound message
    "ALTER TABLE inbound ADD COLUMN gateway_id TEXT",
    // Track who owns/created this gateway (filters listing for non-admin users)
    "ALTER TABLE gateways ADD COLUMN owner_id TEXT",
    // SIM slot that received this inbound message (1 = SIM1, 2 = SIM2)
    "ALTER TABLE inbound ADD COLUMN sim_slot INTEGER DEFAULT 0",
    // Boss/notify numbers for campaign alerts
    "ALTER TABLE campaigns ADD COLUMN boss_numbers TEXT DEFAULT ''",
    // Boss/notify numbers — moved to templates from campaigns
    "ALTER TABLE templates ADD COLUMN boss_numbers TEXT DEFAULT ''",
    // DPD group label for agent contacts (e.g., "DPD 1")
    "ALTER TABLE agent_contacts ADD COLUMN dpd_group TEXT DEFAULT ''",
    // Category label above DPD (e.g., "PRIORITY", "INSUFFICIENT")
    "ALTER TABLE agent_contacts ADD COLUMN category TEXT DEFAULT ''",
    // Agent/owner name in gateway number history
    "ALTER TABLE gateway_numbers ADD COLUMN agent_name TEXT DEFAULT ''",
    // Track last login time so the admin panel can show who's actively using the system
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    // Associate templates with campaigns so admins can assign templates to specific campaigns
    "ALTER TABLE templates ADD COLUMN campaign_id TEXT",
    // Index for filtering templates by campaign
    "CREATE INDEX IF NOT EXISTS idx_templates_campaign_id ON templates(campaign_id)",
    // ── agent_contacts indexes: agent-scoped queries, batch views ─────
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_id ON agent_contacts(agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_id ON agent_contacts(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_phone ON agent_contacts(agent_id, phone_number)",
    // Composite index for agent listing queries: WHERE agent_id = ? ORDER BY category, dpd_group, created_at DESC
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_list ON agent_contacts(agent_id, category, dpd_group, created_at)",
    // Index for available/used COUNT queries: WHERE agent_id = ? AND used = 0/1
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_used ON agent_contacts(agent_id, used)",
    // Index for date-filtered queries: WHERE agent_id = ? AND created_at >= ? AND created_at < ?
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_created ON agent_contacts(agent_id, created_at)",
    // Index for batch agent grouping: WHERE batch_id = ? GROUP BY agent_id
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_agent ON agent_contacts(batch_id, agent_id)",
    // ── users: login query + admin/agent lookups ──────────────────────
    "CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, active)",
    // ── gateways: agent-scoped listing + owner checks ──────────────────
    "CREATE INDEX IF NOT EXISTS idx_gateways_owner_active ON gateways(owner_id, active, created_at)",
    // ── broadcasts: agent+status filters, daily cap, history listing ──
    "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_status ON broadcasts(agent_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_created ON broadcasts(agent_id, created_at)",
    // ── messages: broadcast-scoped status/ordering, recipient lookups ──
    "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_status ON messages(broadcast_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_created ON messages(broadcast_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_to_number_status ON messages(to_number, status)",
    "CREATE INDEX IF NOT EXISTS idx_messages_to_number_created ON messages(to_number, created_at)",
    // ── messages: stats queries filtering by status + time range ──
    "CREATE INDEX IF NOT EXISTS idx_messages_status_sent ON messages(status, sent_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at)",
    // ── inbound: number/flag filtering for conversation view ───────────
    "CREATE INDEX IF NOT EXISTS idx_inbound_from_number ON inbound(from_number)",
    "CREATE INDEX IF NOT EXISTS idx_inbound_flag ON inbound(flag)",
    // ── gateway_numbers: dedup check for saveNumberSnapshot ───────────
    "CREATE INDEX IF NOT EXISTS idx_gateway_numbers_dedup ON gateway_numbers(gateway_id, number, number2, sim_carrier, sim2_carrier)",
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  }

  // Create indexes that depend on migration-added columns
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_gateways_active_mode ON gateways(active, mode)");
  } catch (_) { }
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_inbound_agent_id ON inbound(agent_id)");
  } catch (_) { }

  // ── Backfill: normalize existing contact phone numbers ────────────
  // Contacts uploaded before the normalizePhone change may be in raw format
  // (e.g., "09171234567" instead of "+639171234567"). Re-normalize them so
  // the auto-mark feature works for all contacts.
  // Uses a settings flag to skip the scan once done — avoids scanning 81K
  // rows on every server boot.
  const alreadyDone = db.prepare("SELECT value FROM settings WHERE key = 'contacts_backfilled'").get();
  if (!alreadyDone) {
    try {
      const unnormalized = db.prepare(
        "SELECT id, phone_number FROM agent_contacts WHERE phone_number NOT LIKE '+%'"
      ).all();
      if (unnormalized.length > 0) {
        const fixStmt = db.prepare('UPDATE agent_contacts SET phone_number = ? WHERE id = ?');
        const fixAll = db.transaction(() => {
          for (const c of unnormalized) {
            const normalized = normalizePhone(c.phone_number);
            if (normalized !== c.phone_number) {
              fixStmt.run(normalized, c.id);
            }
          }
        });
        fixAll();
        console.log(`[db] Backfilled ${unnormalized.length} contact phone numbers to E.164 format`);
      }
      // Mark done regardless so this scan never runs again
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('contacts_backfilled', '1')").run();
    } catch (_) {
      // Silently skip if agent_contacts table doesn't exist yet
    }
  }

  // Guarantee a known admin login on EVERY boot (fresh DB or reinstall).
  ensureAdminAccount();

  // ── Exit bulk init mode ─────────────────────────────────────────────
  db._initMode = false;

  // ── Deferred flush + backup (non-critical, runs after server starts) ─
  // The final flushDbSync() exports the entire sql.js database to disk.
  // For large databases (>50 MB) this blocks the event loop for 1-4
  // seconds. Defer it so the server starts listening immediately.
  // If the server crashes before this flush, the on-disk DB is stale but
  // still valid — migrations will re-run on next boot (schema check:
  // ~36ms). Backup creation is also deferred since it's non-critical.
  setTimeout(() => {
    const t1 = Date.now();
    flushDbSync();
    console.log(`[db] Initial write to disk: ${Date.now() - t1}ms`);
  }, 0);

  setTimeout(() => {
    createInitialBackup();
  }, 10);

  startBackupSchedule();

  console.log('[db] Database ready at', DB_PATH);
}

/**
 * Make sure the admin account is usable after every install, so the operator
 * never has to hunt for credentials.
 *
 *  - If ADMIN_PASSWORD is set (baked into the build), the admin is created or
 *    its password is reset to EXACTLY that value on every launch — guaranteeing
 *    the documented login always works, even on a DB from a previous version.
 *  - If ADMIN_PASSWORD is not set, an admin is created only when missing, with a
 *    random password written to <dataDir>/INITIAL_ADMIN.txt.
 */
function ensureAdminAccount() {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const envPass = process.env.ADMIN_PASSWORD;
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);

  if (envPass) {
    const hash = bcrypt.hashSync(envPass, 10);
    if (row) {
      db.prepare('UPDATE users SET password_hash = ?, role = ?, active = 1 WHERE id = ?')
        .run(hash, 'super_admin', row.id);
    } else {
      db.prepare('INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), adminUser, hash, 'Admin', 'super_admin');
    }
    console.log(`[db] Super admin "${adminUser}" ensured from ADMIN_PASSWORD env.`);
    return;
  }

  if (!row) {
    const pass = randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare('INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), adminUser, hash, 'Admin', 'super_admin');
    const credFile = join(DATA_DIR, 'INITIAL_ADMIN.txt');
    const note =
      `SMS Platform — initial admin credentials\n` +
      `Generated: ${new Date().toISOString()}\n\n` +
      `  Username: ${adminUser}\n` +
      `  Password: ${pass}\n\n` +
      `Log in with these, then change the password (Agents page). Delete this file afterwards.\n`;
    try { writeFileSync(credFile, note); } catch (_) { }
    console.warn(`[db] Generated initial admin "${adminUser}". Credentials written to ${credFile}`);
  }
}

export default db;
