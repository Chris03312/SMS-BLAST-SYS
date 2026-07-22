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
      ['data_retention_days', '90'],
      ['timezone', 'Asia/Manila'],
      ['public_url', ''],
    ]) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
    console.log('[db] Fresh database initialised — no dummy data');
  }

  // ── Migration tracking table (must be first) ────────────────
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ── Migrations (tracked with _migrations table) ────────────────────
  // Each entry has { name, sql }. Only runs migrations that haven't been
  // applied yet (checked against the _migrations table). On upgrade from
  // the old untracked system, these will all run but silently fail if the
  // column already exists — same as before. New servers will record them
  // properly and skip on subsequent boots.
  const migrations = [
    { name: 'add_column_last_online', sql: "ALTER TABLE gateways ADD COLUMN last_online TEXT" },
    { name: 'add_column_device_info', sql: "ALTER TABLE gateways ADD COLUMN device_info TEXT" },
    { name: 'add_column_gateway_ids', sql: "ALTER TABLE broadcasts ADD COLUMN gateway_ids TEXT DEFAULT '[]'" },
    { name: 'add_column_distribution', sql: "ALTER TABLE broadcasts ADD COLUMN distribution TEXT DEFAULT 'round-robin'" },
    { name: 'add_column_gateway_mode', sql: "ALTER TABLE gateways ADD COLUMN mode TEXT DEFAULT 'push'" },
    { name: 'add_column_last_poll', sql: "ALTER TABLE gateways ADD COLUMN last_poll TEXT" },
    { name: 'add_column_gateway_number', sql: "ALTER TABLE gateways ADD COLUMN number TEXT" },
    { name: 'add_column_inbound_agent_id', sql: "ALTER TABLE inbound ADD COLUMN agent_id TEXT" },
    { name: 'add_column_consecutive_fails', sql: "ALTER TABLE gateways ADD COLUMN consecutive_fails INTEGER DEFAULT 0" },
    { name: 'create_table_agent_contacts', sql: `CREATE TABLE IF NOT EXISTS agent_contacts (
      id           TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL,
      batch_id     TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      used         INTEGER DEFAULT 0,
      broadcast_id TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )` },
    { name: 'add_column_activity_campaign_id', sql: "ALTER TABLE activity ADD COLUMN campaign_id TEXT" },
    { name: 'add_column_gateway_number2', sql: "ALTER TABLE gateways ADD COLUMN number2 TEXT" },
    { name: 'add_column_sim2_carrier', sql: "ALTER TABLE gateways ADD COLUMN sim2_carrier TEXT" },
    { name: 'add_column_turbo_enabled', sql: "ALTER TABLE gateways ADD COLUMN turbo_enabled INTEGER DEFAULT 0" },
    { name: 'add_column_delivery_fails', sql: "ALTER TABLE gateways ADD COLUMN delivery_fails INTEGER DEFAULT 0" },
    { name: 'add_column_last_error', sql: "ALTER TABLE gateways ADD COLUMN last_error TEXT" },
    { name: 'add_column_sim_mode', sql: "ALTER TABLE broadcasts ADD COLUMN sim_mode TEXT DEFAULT 'sim1'" },
    { name: 'add_column_send_start_at', sql: "ALTER TABLE broadcasts ADD COLUMN send_start_at TEXT" },
    { name: 'add_column_send_end_at', sql: "ALTER TABLE broadcasts ADD COLUMN send_end_at TEXT" },
    { name: 'add_column_sim_round_start', sql: "ALTER TABLE broadcasts ADD COLUMN sim_round_start TEXT DEFAULT 'sim1'" },
    { name: 'add_column_inbound_gateway_id', sql: "ALTER TABLE inbound ADD COLUMN gateway_id TEXT" },
    { name: 'add_column_owner_id', sql: "ALTER TABLE gateways ADD COLUMN owner_id TEXT" },
    { name: 'add_column_inbound_sim_slot', sql: "ALTER TABLE inbound ADD COLUMN sim_slot INTEGER DEFAULT 0" },
    { name: 'add_column_boss_numbers', sql: "ALTER TABLE campaigns ADD COLUMN boss_numbers TEXT DEFAULT ''" },
    { name: 'add_column_template_boss_numbers', sql: "ALTER TABLE templates ADD COLUMN boss_numbers TEXT DEFAULT ''" },
    { name: 'add_column_dpd_group', sql: "ALTER TABLE agent_contacts ADD COLUMN dpd_group TEXT DEFAULT ''" },
    { name: 'add_column_category', sql: "ALTER TABLE agent_contacts ADD COLUMN category TEXT DEFAULT ''" },
    { name: 'add_column_agent_name', sql: "ALTER TABLE gateway_numbers ADD COLUMN agent_name TEXT DEFAULT ''" },
    { name: 'add_column_last_login_at', sql: "ALTER TABLE users ADD COLUMN last_login_at TEXT" },
    { name: 'add_column_template_campaign_id', sql: "ALTER TABLE templates ADD COLUMN campaign_id TEXT" },
    { name: 'create_index_templates_campaign_id', sql: "CREATE INDEX IF NOT EXISTS idx_templates_campaign_id ON templates(campaign_id)" },
    { name: 'create_index_agent_contacts_agent_id', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_id ON agent_contacts(agent_id)" },
    { name: 'create_index_agent_contacts_batch_id', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_id ON agent_contacts(batch_id)" },
    { name: 'create_index_agent_contacts_agent_phone', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_phone ON agent_contacts(agent_id, phone_number)" },
    { name: 'create_index_agent_contacts_list', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_list ON agent_contacts(agent_id, category, dpd_group, created_at)" },
    { name: 'create_index_agent_contacts_agent_used', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_used ON agent_contacts(agent_id, used)" },
    { name: 'create_index_agent_contacts_agent_created', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent_created ON agent_contacts(agent_id, created_at)" },
    { name: 'create_index_agent_contacts_batch_agent', sql: "CREATE INDEX IF NOT EXISTS idx_agent_contacts_batch_agent ON agent_contacts(batch_id, agent_id)" },
    { name: 'create_index_users_username_active', sql: "CREATE INDEX IF NOT EXISTS idx_users_username_active ON users(username, active)" },
    { name: 'create_index_gateways_owner_active', sql: "CREATE INDEX IF NOT EXISTS idx_gateways_owner_active ON gateways(owner_id, active, created_at)" },
    { name: 'create_index_broadcasts_agent_status', sql: "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_status ON broadcasts(agent_id, status)" },
    { name: 'create_index_broadcasts_agent_created', sql: "CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_created ON broadcasts(agent_id, created_at)" },
    { name: 'create_index_messages_broadcast_status', sql: "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_status ON messages(broadcast_id, status)" },
    { name: 'create_index_messages_broadcast_created', sql: "CREATE INDEX IF NOT EXISTS idx_messages_broadcast_created ON messages(broadcast_id, created_at)" },
    { name: 'create_index_messages_to_number_status', sql: "CREATE INDEX IF NOT EXISTS idx_messages_to_number_status ON messages(to_number, status)" },
    { name: 'create_index_messages_to_number_created', sql: "CREATE INDEX IF NOT EXISTS idx_messages_to_number_created ON messages(to_number, created_at)" },
    { name: 'create_index_messages_status_sent', sql: "CREATE INDEX IF NOT EXISTS idx_messages_status_sent ON messages(status, sent_at)" },
    { name: 'create_index_messages_status_created', sql: "CREATE INDEX IF NOT EXISTS idx_messages_status_created ON messages(status, created_at)" },
    { name: 'create_index_inbound_from_number', sql: "CREATE INDEX IF NOT EXISTS idx_inbound_from_number ON inbound(from_number)" },
    { name: 'create_index_inbound_flag', sql: "CREATE INDEX IF NOT EXISTS idx_inbound_flag ON inbound(flag)" },
    { name: 'create_index_gateway_numbers_dedup', sql: "CREATE INDEX IF NOT EXISTS idx_gateway_numbers_dedup ON gateway_numbers(gateway_id, number, number2, sim_carrier, sim2_carrier)" },
  ];

  const alreadyRan = db.prepare('SELECT name FROM _migrations').all().map(r => r.name);
  const pendingMigrations = migrations.filter(m => !alreadyRan.includes(m.name));

  if (pendingMigrations.length > 0) {
    const applyMigration = db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');
    const runMigrations = db.transaction(() => {
      for (const m of pendingMigrations) {
        try {
          db.exec(m.sql);
          applyMigration.run(m.name);
        } catch (_) {
          // Column/index already exists — safe to ignore on upgrade
          applyMigration.run(m.name);
        }
      }
    });
    runMigrations();
    console.log(`[db] Applied ${pendingMigrations.length} pending migration(s)`);
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

  // Start daily data cleanup (old messages/broadcasts/activity)
  scheduleDataCleanup();

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

// ── Data Cleanup ──────────────────────────────────────────────────────
// Deletes old messages, completed broadcasts, and activity logs.
// Retention is configurable via the 'data_retention_days' setting (default: 90).

export function cleanupOldData() {
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'data_retention_days'").get();
    const retentionDays = parseInt(setting?.value) || 90;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    console.log(`[db] Running data cleanup — deleting records older than ${retentionDays} days (before ${cutoff.slice(0, 10)})...`);

    // Delete old messages from completed broadcasts only
    const oldBroadcastIds = db.prepare(
      "SELECT id FROM broadcasts WHERE status IN ('done', 'cancelled', 'failed', 'deleted') AND completed_at < ?"
    ).all(cutoff).map(r => r.id);

    if (oldBroadcastIds.length > 0) {
      const placeholders = oldBroadcastIds.map(() => '?').join(',');
      const msgDeleted = db.prepare(
        `DELETE FROM messages WHERE broadcast_id IN (${placeholders})`
      ).run(...oldBroadcastIds);

      const bcDeleted = db.prepare(
        `DELETE FROM broadcasts WHERE id IN (${placeholders})`
      ).run(...oldBroadcastIds);

      console.log(`[db] Cleanup: deleted ${msgDeleted.changes} messages and ${bcDeleted.changes} broadcasts`);
    }

    // Delete old activity logs
    const actDeleted = db.prepare("DELETE FROM activity WHERE created_at < ?").run(cutoff);
    if (actDeleted.changes > 0) {
      console.log(`[db] Cleanup: deleted ${actDeleted.changes} activity log entries`);
    }

    console.log(`[db] Data cleanup complete`);
  } catch (e) {
    console.error('[db] Cleanup error:', e.message);
  }
}

function scheduleDataCleanup() {
  // Run cleanup once on startup (after a short delay to let server settle)
  setTimeout(() => cleanupOldData(), 30_000);

  // Then run every 24 hours
  setInterval(() => {
    setImmediate(() => cleanupOldData());
  }, 24 * 60 * 60 * 1000);

  console.log('[db] Data cleanup scheduled (every 24 hours)');
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
