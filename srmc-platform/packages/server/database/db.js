/**
 * db.js — better-sqlite3 wrapper for the SMS Platform.
 *
 * Previously used sql.js (WASM-based SQLite) which required exporting the
 * entire database to disk on every write — extremely slow for a 57 MB DB.
 *
 * better-sqlite3 is a native Node.js addon that writes to disk incrementally.
 * No more flushDbSync(), no more rawDb.export(), no more 2-second freezes.
 *
 * Public API (matches the old sql.js wrapper — drop-in replacement):
 *   db.prepare(sql)           → Statement
 *   db.exec(sql)              → void
 *   db.transaction(fn)        → () => void    (BEGIN/COMMIT wrapper)
 *   db.pragma(str)            → void
 *
 * Statement API:
 *   stmt.get(...params)       → first row as plain object, or undefined
 *   stmt.all(...params)       → all rows as array of plain objects
 *   stmt.run(...params)       → { changes, lastInsertRowid }
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '../utils/phone.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Writable data directory.
const DATA_DIR = process.env.SRMC_DATA_DIR || join(__dirname, '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'srmc.db');

mkdirSync(DATA_DIR, { recursive: true });

// ── Open database with WAL mode ─────────────────────────────────────────────
// WAL (Write-Ahead Log) allows concurrent reads during writes — no more
// event-loop blocking on DB exports.
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Periodic backups ─────────────────────────────────────────────────
// Every 15 minutes, write a copy of the DB to a numbered backup file.
// Keeps the last 6 backups (90 minutes of history).
// Uses better-sqlite3's built-in backup API (incremental, non-blocking).
const BACKUP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKUPS = 6;

function startBackupSchedule() {
  setInterval(() => {
    // Defer backup I/O so it doesn't block ongoing requests
    setImmediate(() => {
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
        // Use better-sqlite3's backup API (incremental, much faster than full export)
        const backupPath = DB_PATH.replace('.db', '.backup.1.db');
        db.backup(backupPath);
      } catch (e) {
        console.error('[db] Backup failed:', e.message);
      }
    });
  }, BACKUP_INTERVAL_MS);
}

// ── Backup on boot ─────────────────────────────────────────────
function createInitialBackup() {
  const backupPath = DB_PATH.replace('.db', '.backup.1.db');
  if (!existsSync(backupPath)) {
    setImmediate(() => {
      try {
        db.backup(backupPath);
        console.log('[db] Initial backup created');
      } catch (e) {
        console.error('[db] Initial backup failed:', e.message);
      }
    });
  }
}

// ── Schema + seed ────────────────────────────────────────────────────────────

export function initDb() {
  const t0 = Date.now();

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
    CREATE INDEX IF NOT EXISTS idx_messages_broadcast_id    ON messages(broadcast_id);
    CREATE INDEX IF NOT EXISTS idx_messages_gateway_id_status ON messages(gateway_id, status);
    CREATE INDEX IF NOT EXISTS idx_messages_to_number       ON messages(to_number);
    CREATE INDEX IF NOT EXISTS idx_messages_status          ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_sent_at         ON messages(sent_at);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_id      ON broadcasts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_status        ON broadcasts(status);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at    ON broadcasts(created_at);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_campaign_id   ON broadcasts(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id    ON campaigns(owner_id);
    CREATE INDEX IF NOT EXISTS idx_templates_created_by  ON templates(created_by);
    CREATE INDEX IF NOT EXISTS idx_users_role               ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_role_active        ON users(role, active);
    CREATE INDEX IF NOT EXISTS idx_gateways_status          ON gateways(status);
    CREATE INDEX IF NOT EXISTS idx_inbound_created_at       ON inbound(created_at);
    CREATE INDEX IF NOT EXISTS idx_inbound_read_at          ON inbound(read_at);
    CREATE INDEX IF NOT EXISTS idx_activity_user_id         ON activity(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created_at      ON activity(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_action          ON activity(action);
    CREATE INDEX IF NOT EXISTS idx_gateway_tokens_gateway_id ON gateway_tokens(gateway_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_numbers_gateway_id ON gateway_numbers(gateway_id);
    CREATE INDEX IF NOT EXISTS idx_gateway_numbers_changed_at ON gateway_numbers(changed_at);
  `);

  // Seed default settings only on a fresh database.
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (!existing || existing.c === 0) {
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

  // ── Migrations ────────────────────────────────────────────────
  const migrations = [
    "ALTER TABLE gateways ADD COLUMN last_online TEXT",
    "ALTER TABLE gateways ADD COLUMN device_info TEXT",
    "ALTER TABLE broadcasts ADD COLUMN gateway_ids TEXT DEFAULT '[]'",
    "ALTER TABLE broadcasts ADD COLUMN distribution TEXT DEFAULT 'round-robin'",
    "ALTER TABLE gateways ADD COLUMN mode TEXT DEFAULT 'push'",
    "ALTER TABLE gateways ADD COLUMN last_poll TEXT",
    "ALTER TABLE gateways ADD COLUMN number TEXT",
    "ALTER TABLE inbound ADD COLUMN agent_id TEXT",
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
    "ALTER TABLE activity ADD COLUMN campaign_id TEXT",
    "ALTER TABLE gateways ADD COLUMN number2 TEXT",
    "ALTER TABLE gateways ADD COLUMN sim2_carrier TEXT",
    "ALTER TABLE gateways ADD COLUMN turbo_enabled INTEGER DEFAULT 0",
    "ALTER TABLE gateways ADD COLUMN delivery_fails INTEGER DEFAULT 0",
    "ALTER TABLE gateways ADD COLUMN last_error TEXT",
    "ALTER TABLE broadcasts ADD COLUMN sim_mode TEXT DEFAULT 'sim1'",
    "ALTER TABLE broadcasts ADD COLUMN send_start_at TEXT",
    "ALTER TABLE broadcasts ADD COLUMN send_end_at TEXT",
    "ALTER TABLE broadcasts ADD COLUMN sim_round_start TEXT DEFAULT 'sim1'",
    "ALTER TABLE inbound ADD COLUMN gateway_id TEXT",
    "ALTER TABLE gateways ADD COLUMN owner_id TEXT",
    "ALTER TABLE inbound ADD COLUMN sim_slot INTEGER DEFAULT 0",
    "ALTER TABLE campaigns ADD COLUMN boss_numbers TEXT DEFAULT ''",
    "ALTER TABLE templates ADD COLUMN boss_numbers TEXT DEFAULT ''",
    "ALTER TABLE agent_contacts ADD COLUMN dpd_group TEXT DEFAULT ''",
    "ALTER TABLE agent_contacts ADD COLUMN category TEXT DEFAULT ''",
    "ALTER TABLE gateway_numbers ADD COLUMN agent_name TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    "ALTER TABLE templates ADD COLUMN campaign_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_templates_campaign_id ON templates(campaign_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_id ON agent_contacts(agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_id ON agent_contacts(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_phone ON agent_contacts(agent_id, phone_number)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_list ON agent_contacts(agent_id, category, dpd_group, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_used ON agent_contacts(agent_id, used)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_created ON agent_contacts(agent_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_agent ON agent_contacts(batch_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, active)",
    "CREATE INDEX IF NOT EXISTS idx_gateways_owner_active ON gateways(owner_id, active, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_status ON broadcasts(agent_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_created ON broadcasts(agent_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_status ON messages(broadcast_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_created ON messages(broadcast_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_to_number_status ON messages(to_number, status)",
    "CREATE INDEX IF NOT EXISTS idx_messages_to_number_created ON messages(to_number, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_status_sent ON messages(status, sent_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_inbound_from_number ON inbound(from_number)",
    "CREATE INDEX IF NOT EXISTS idx_inbound_flag ON inbound(flag)",
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
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('contacts_backfilled', '1')").run();
    } catch (_) { }
  }

  // Guarantee a known admin login on EVERY boot
  ensureAdminAccount();

  // Start periodic backups
  setTimeout(() => createInitialBackup(), 10);
  startBackupSchedule();

  console.log(`[db] Database ready at ${DB_PATH} (${(Date.now() - t0)}ms)`);
}

/**
 * Make sure the admin account is usable after every install.
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

// ── Backward-compatible exports ──────────────────────────────────────
// These were needed by sql.js but are no-ops with better-sqlite3.

/** @deprecated No-op with better-sqlite3 — data is written incrementally. */
export function flushDb() {}

/** @deprecated No-op with better-sqlite3 — data is written incrementally. */
export function flushDbSync() {}

/** @deprecated No-op with better-sqlite3 — data is written incrementally. */
export function flushDbSyncNow() {}

export default db;
