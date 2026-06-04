/**
 * server/secrets.js — Resolves / auto-generates JWT & webhook secrets.
 *
 * On first run, if JWT_SECRET / WEBHOOK_SECRET are left as their default
 * placeholders (or not set), strong random secrets are generated and
 * persisted to <dataDir>/secrets.json so no install ever runs on a known
 * default key.
 *
 * Environment variables (set in .env or baked into the build):
 *   JWT_SECRET      — Auth-token signing key.
 *   WEBHOOK_SECRET  — Inbound webhook secret.
 *
 * Exports:
 *   JWT_SECRET      — Always a real (resolved or generated) secret string.
 *   WEBHOOK_SECRET  — Always a real (resolved or generated) secret string.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Writable data directory — same logic as db.js.
// Electron sets SRMC_DATA_DIR before importing server modules.
const DATA_DIR = process.env.SRMC_DATA_DIR || join(__dirname, '..', 'data');
const SECRETS_FILE = join(DATA_DIR, 'secrets.json');

// ── Load or generate secrets ──────────────────────────────────────────────

function loadOrGenerateSecrets() {
  // Try loading persisted secrets first
  let persisted = {};
  if (existsSync(SECRETS_FILE)) {
    try {
      const raw = readFileSync(SECRETS_FILE, 'utf-8');
      persisted = JSON.parse(raw);
    } catch (e) {
      console.warn('[secrets] Could not parse secrets.json, will regenerate');
    }
  }

  const envJwt     = process.env.JWT_SECRET;
  const envWebhook = process.env.WEBHOOK_SECRET;

  // Determine JWT_SECRET:
  //   - Use the env value if it's set AND not the placeholder "change-me"
  //   - Use the persisted value if available
  //   - Otherwise generate a new random secret
  const JWT_SECRET = resolveSecret(envJwt, persisted.jwt_secret, 'jwt_secret');

  // Determine WEBHOOK_SECRET:
  //   - Use the env value if it's set AND not the placeholder
  //   - Use the persisted value if available
  //   - Otherwise generate a new random secret
  const WEBHOOK_SECRET = resolveSecret(envWebhook, persisted.webhook_secret, 'webhook_secret');

  return { JWT_SECRET, WEBHOOK_SECRET };
}

function resolveSecret(envValue, persistedValue, key) {
  // If env provides a real (non-placeholder) value, use it and persist
  if (envValue && envValue !== 'change-me' && envValue !== 'your-secret-here') {
    persistSecret(key, envValue);
    return envValue;
  }

  // Use persisted value if we have one
  if (persistedValue) {
    return persistedValue;
  }

  // Generate a strong random secret
  const generated = randomBytes(32).toString('hex');
  persistSecret(key, generated);
  console.log(`[secrets] Generated new ${key}`);
  return generated;
}

function persistSecret(key, value) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    let secrets = {};
    if (existsSync(SECRETS_FILE)) {
      try {
        secrets = JSON.parse(readFileSync(SECRETS_FILE, 'utf-8'));
      } catch (_) {}
    }
    secrets[key] = value;
    writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
  } catch (e) {
    console.warn('[secrets] Could not persist secrets:', e.message);
  }
}

const { JWT_SECRET, WEBHOOK_SECRET } = loadOrGenerateSecrets();

export { JWT_SECRET, WEBHOOK_SECRET };
