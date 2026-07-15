/**
 * fix-token.js — Write ngrok authtoken/domain into srmc.db on disk.
 *
 * Reads values from environment variables first, falling back to hardcoded
 * values below. This lets operators set NGROK_AUTHTOKEN / NGROK_DOMAIN
 * in their shell or .env and run this script without editing it.
 *
 * IMPORTANT: Stop your dev server (npm run dev) BEFORE running this,
 * and restart it AFTER — otherwise the running server will flush its
 * stale in-memory copy over your change.
 *
 * Usage:
 *   node scripts/fix-token.js
 */

import 'dotenv/config';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Values: env vars > hardcoded fallbacks ───────────────────────────
const NGROK_AUTHTOKEN = process.env.NGROK_AUTHTOKEN || '3AHnnGd9JErhBVo5IKr9tqByG6H_3SBnmt6bxN5DTkS11rqb8';
const NGROK_DOMAIN = process.env.NGROK_DOMAIN || 'unmouldy-roxann-commotive.ngrok-free.dev';
// ──────────────────────────────────────────────────────────────────────

// DB is at <projectRoot>/data/srmc.db
const DB_PATH = join(__dirname, '..', '..', 'data', 'srmc.db');

async function main() {
    if (!existsSync(DB_PATH)) {
        console.error(`❌ Could not find DB at ${DB_PATH}.`);
        process.exit(1);
    }

    console.log('Loading DB from', DB_PATH);
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(DB_PATH));

    // Show current values before the change
    const before = db.exec("SELECT key, value FROM settings WHERE key IN ('ngrok_authtoken','ngrok_domain')");
    console.log('BEFORE:', JSON.stringify(before));

    db.run("UPDATE settings SET value = ? WHERE key = 'ngrok_authtoken'", [NGROK_AUTHTOKEN]);
    db.run("UPDATE settings SET value = ? WHERE key = 'ngrok_domain'", [NGROK_DOMAIN]);

    // Show values after the change, straight from the in-memory DB
    const after = db.exec("SELECT key, value FROM settings WHERE key IN ('ngrok_authtoken','ngrok_domain')");
    console.log('AFTER:', JSON.stringify(after));

    writeFileSync(DB_PATH, Buffer.from(db.export()));
    console.log('✅ Written to disk. Now restart your dev server (npm run dev) and check the logs.');
}

main().catch((err) => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});