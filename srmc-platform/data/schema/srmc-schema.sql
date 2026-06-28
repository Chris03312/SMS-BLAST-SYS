-- ════════════════════════════════════════════════════════════════════════════
--  SRMC SMS Blast System — Database Schema
--  SQLite DDL (Data Definition Language)
--
--  Engine:    SQLite 3.x (via sql.js WASM)
--  Generated: June 2026
--  Source:    packages/server/db.js
--
--  This file contains the complete schema definition including all tables,
--  columns (base + migration-added), indexes, and default seed data.
--  It can be used to recreate the database from scratch.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Users (agents, admins, super admins) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,                          -- UUID
    username      TEXT UNIQUE NOT NULL,                     -- Login username
    password_hash TEXT NOT NULL,                            -- bcrypt hash
    display_name  TEXT,                                     -- Human-readable name
    role          TEXT NOT NULL DEFAULT 'agent',            -- 'super_admin', 'admin', 'agent'
    active        INTEGER NOT NULL DEFAULT 1,               -- 1=active, 0=inactive
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))    -- ISO timestamp
);

CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_role_active   ON users(role, active);


-- ── Gateways (Android SMS transceiver devices) ──────────────────────────

CREATE TABLE IF NOT EXISTS gateways (
    id                TEXT PRIMARY KEY,                     -- Gateway ID (UUID or user ID for self-registered)
    name              TEXT NOT NULL,                        -- Display name
    url               TEXT NOT NULL,                        -- HTTP URL (empty for pull gateways)
    token             TEXT,                                 -- API bearer token for push auth
    sim_carrier       TEXT,                                 -- SIM 1 carrier (e.g. "Globe", "Smart")
    sim2_carrier      TEXT,                                 -- SIM 2 carrier                   ← migration
    status            TEXT DEFAULT 'unknown',               -- 'online', 'offline', 'slow', 'unknown'
    last_beat         TEXT,                                 -- Last heartbeat timestamp
    last_online       TEXT,                                 -- Last online timestamp             ← migration
    last_poll         TEXT,                                 -- Last outbound poll timestamp      ← migration
    device_info       TEXT,                                 -- Android model + OS version        ← migration
    mode              TEXT DEFAULT 'push',                  -- 'push' (LAN) or 'pull' (remote)   ← migration
    number            TEXT,                                 -- SIM 1 phone number                ← migration
    number2           TEXT,                                 -- SIM 2 phone number                ← migration
    sim_carrier       TEXT,                                 -- SIM 1 carrier (aliased, kept for compat)
    sent_today        INTEGER DEFAULT 0,                    -- Messages sent today
    consecutive_fails INTEGER DEFAULT 0,                    -- Consecutive send failures         ← migration
    delivery_fails    INTEGER DEFAULT 0,                    -- Consecutive delivery failures     ← migration
    turbo_enabled     INTEGER DEFAULT 0,                    -- Turbo mode allowed                ← migration
    last_error        TEXT,                                 -- Human-readable last error detail  ← migration
    active            INTEGER DEFAULT 1,                    -- 1=active, 0=disabled
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gateways_status        ON gateways(status);
CREATE INDEX IF NOT EXISTS idx_gateways_active_mode    ON gateways(active, mode);


-- ── Gateway authentication tokens ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS gateway_tokens (
    id          TEXT PRIMARY KEY,
    gateway_id  TEXT NOT NULL,
    token       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_gateway_tokens_gateway_id ON gateway_tokens(gateway_id);


-- ── Campaigns (broadcast grouping) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    TEXT,
    status      TEXT DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON campaigns(owner_id);


-- ── SMS Templates ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    category    TEXT DEFAULT 'transactional',
    variables   TEXT DEFAULT '[]',                         -- JSON array of variable tokens
    created_by  TEXT,
    use_count   INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_created_by ON templates(created_by);


-- ── Broadcasts (bulk send operations) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS broadcasts (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT,                                    -- FK → users.id (who created)
    campaign_id   TEXT,                                    -- FK → campaigns.id
    template_id   TEXT,                                    -- FK → templates.id
    gateway_id    TEXT,                                    -- Legacy single-gateway
    gateway_ids   TEXT NOT NULL DEFAULT '[]',              -- JSON array of gateway IDs    ← migration
    distribution  TEXT NOT NULL DEFAULT 'round-robin',      -- 'round-robin' or 'linear'   ← migration
    message       TEXT NOT NULL,
    recipients    TEXT NOT NULL,                            -- JSON array of phone numbers
    total         INTEGER DEFAULT 0,
    sent          INTEGER DEFAULT 0,
    failed        INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'pending',                   -- 'pending','sending','paused','done','cancelled','failed'
    delay_ms      INTEGER DEFAULT 6000,
    started_at    TEXT,
    completed_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_agent_id     ON broadcasts(agent_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status       ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at   ON broadcasts(created_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_campaign_id  ON broadcasts(campaign_id);


-- ── Messages (individual SMS records) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    broadcast_id  TEXT,                                    -- FK → broadcasts.id
    to_number     TEXT NOT NULL,                           -- Recipient phone number
    message       TEXT NOT NULL,
    status        TEXT DEFAULT 'queued',                   -- 'queued','pending','sending','sent','failed','delivered'
    error         TEXT,                                    -- Error message if failed
    gateway_id    TEXT,                                    -- FK → gateways.id
    sent_at       TEXT,                                    -- When the message was sent
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_broadcast_id       ON messages(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_messages_gateway_id_status  ON messages(gateway_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_to_number          ON messages(to_number);
CREATE INDEX IF NOT EXISTS idx_messages_status             ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at            ON messages(sent_at);


-- ── Inbound SMS (replies from recipients) ──────────────────────────────

CREATE TABLE IF NOT EXISTS inbound (
    id           TEXT PRIMARY KEY,
    from_number  TEXT NOT NULL,                            -- Sender's phone number
    body         TEXT NOT NULL,
    flag         TEXT,                                     -- 'opt-out','confirmed','needs-reply','unread'
    agent_id     TEXT,                                     -- FK → users.id (linked agent)  ← migration
    read_at      TEXT,                                     -- When marked as read
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_agent_id    ON inbound(agent_id);
CREATE INDEX IF NOT EXISTS idx_inbound_created_at  ON inbound(created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_read_at     ON inbound(read_at);


-- ── Activity Log (audit trail) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,                                      -- FK → users.id
    action      TEXT NOT NULL,
    detail      TEXT,
    level       TEXT DEFAULT 'info',                       -- 'info','warn','error'
    campaign_id TEXT,                                      -- FK → campaigns.id            ← migration
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_user_id    ON activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_action     ON activity(action);


-- ── Settings (key-value configuration) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);



-- ════════════════════════════════════════════════════════════════════════════
--  Default Seed Data
--  These are the default settings inserted on a fresh database.
-- ════════════════════════════════════════════════════════════════════════════

-- The admin user is NOT seeded here. It is created at runtime by
-- ensureAdminAccount() in db.js, using either ADMIN_PASSWORD env
-- or a random password written to INITIAL_ADMIN.txt.

INSERT OR IGNORE INTO settings (key, value) VALUES ('org_name',                        'SRMC Credit Collection Services');
INSERT OR IGNORE INTO settings (key, value) VALUES ('sender_id',                       'SRMCCS');
INSERT OR IGNORE INTO settings (key, value) VALUES ('delay',                           '6000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('window_start',                    '00:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('window_end',                      '23:59');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ngrok_url',                       '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_cap',                       '10000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_concurrent_broadcasts',        '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_broadcasts_per_agent',         '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_recipients_per_broadcast',     '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_broadcast_duration_minutes',   '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_broadcasts_per_day_per_agent', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('broadcasts_globally_paused',       'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('turbo_delay',                     '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('turbo_batch_size',                 '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone',                        'Asia/Manila');
INSERT OR IGNORE INTO settings (key, value) VALUES ('public_url',                      '');

-- ════════════════════════════════════════════════════════════════════════════
--  Migration Notes
--
--  Columns marked ← migration were added after the initial schema via
--  ALTER TABLE and use IF NOT EXISTS patterns in the application code.
--  The CREATE TABLE statements above include them directly for a clean
--  schema view.
--
--  Indexes use CREATE INDEX IF NOT EXISTS and are idempotent — safe to
--  run multiple times.
-- ════════════════════════════════════════════════════════════════════════════
