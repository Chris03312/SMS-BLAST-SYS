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
const DB_PATH = join(DATA_DIR, 'srmc.db');

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

/**
 * Immediately flush the in-memory database to disk.
 * Called after every write so no data is lost on crash.
 * Can also be called externally for graceful shutdown or manual backup.
 */
export function flushDb() {
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
      console.log('[db] Backup saved to', backupPath.replace(DATA_DIR, ''));
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

// ── Statement wrapper ────────────────────────────────────────────────────────

class Statement {
  constructor(sql) {
    this._sql = sql;
  }

  // Normalize variadic positional args to a flat array.
  // Handles both .get(a, b, c) and .get(...arr) — both arrive as individual args.
  _params(args) {
    if (args.length === 0) return [];
    return args;
  }

  /** Returns the first row as a plain object, or undefined. */
  get(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  /** Returns all rows as an array of plain objects. */
  all(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  /** Executes INSERT / UPDATE / DELETE. Returns { changes }. */
  run(...args) {
    const stmt = rawDb.prepare(this._sql);
    const p = this._params(args);
    if (p.length) stmt.bind(p);
    stmt.step();
    const changes = rawDb.getRowsModified();
    stmt.free();
    // Skip disk flush inside a transaction — the transaction wrapper or
    // bulkInsert flushes once after COMMIT. Flushing during a transaction
    // writes uncommitted state to disk and is redundant.
    if (!db._inTransaction) flushDb();
    return { changes };
  }
}

// ── Database wrapper ─────────────────────────────────────────────────────────

class Database {
  /** Tracks whether we are inside a BEGIN/COMMIT transaction. */
  _inTransaction = false;

  /** Runs one or many SQL statements (DDL, bulk DML, etc.). */
  exec(sql) {
    rawDb.run(sql);
    flushDb();
  }

  /** Returns a Statement bound to the given SQL. */
  prepare(sql) {
    return new Statement(sql);
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
      flushDb();
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
    flushDb();
  }

  /** No-op — WAL journal mode is not meaningful for an in-memory WASM DB. */
  pragma() { }
}

const db = new Database();

// ── Schema + seed ────────────────────────────────────────────────────────────

export function initDb() {
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
  `);

  // Seed default settings only on a fresh database. No demo/dummy accounts.
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (!existing || existing.c === 0) {
    // Default settings
    for (const [key, value] of [
      ['org_name', 'SMS Platform'],
      ['sender_id', 'SMSGATEWAY'],
      ['delay', '6000'],
      ['window_start', '00:00'],
      ['window_end', '23:59'],
      ['webhook_secret', 'whsec_' + uuidv4().replace(/-/g, '')],
      ['ngrok_url', ''],
      ['daily_cap', '10000'],
      ['max_concurrent_broadcasts', '0'],
      ['max_broadcasts_per_agent', '5'],
      ['max_recipients_per_broadcast', '0'],
      ['max_broadcast_duration_minutes', '0'],
      ['max_broadcasts_per_day_per_agent', '0'],
      ['broadcasts_globally_paused', 'false'],
      ['turbo_delay', '100'],
      ['turbo_batch_size', '5'],
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
  } catch (_) {
    // Silently skip if agent_contacts table doesn't exist yet
  }

  // Guarantee a known admin login on EVERY boot (fresh DB or reinstall).
  ensureAdminAccount();

  // Start periodic database backups
  createInitialBackup();
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
