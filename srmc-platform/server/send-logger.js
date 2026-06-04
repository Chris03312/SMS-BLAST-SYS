/**
 * send-logger.js — Appends every outbound SMS attempt to plain-text log files
 * in the data directory, one line per message:
 *
 *     NAME: SENDER - RECEIVER : TIME
 *
 *   - sent.log   — successfully sent messages
 *   - failed.log — failed messages
 *
 * NAME   = gateway/device name
 * SENDER = the SIM's number (gateway.number), falling back to the sender ID / name
 * TIME   = ISO timestamp
 *
 * Works for both push (server → phone) and pull (phone polls) delivery.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = process.env.SRMC_DATA_DIR || join(__dirname, '..', 'data');

/** Resolve the sender label for a gateway row: number → sender ID → name. */
export function resolveSender(gateway) {
  if (!gateway) return 'unknown';
  if (gateway.number) return gateway.number;
  try {
    const s = db.prepare("SELECT value FROM settings WHERE key = 'sender_id'").get();
    if (s && s.value) return s.value;
  } catch (_) {}
  return gateway.name || 'unknown';
}

/**
 * Append one line to sent.log or failed.log.
 * @param {{name?:string, sender?:string, receiver:string, status:string, time?:string}} entry
 */
export function logSend({ name, sender, receiver, status, time }) {
  const ts   = time || new Date().toISOString();
  const line = `${name || 'Gateway'}: ${sender || 'unknown'} - ${receiver} : ${ts}\n`;
  const file = status === 'sent' ? 'sent.log' : 'failed.log';
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(join(DATA_DIR, file), line);
  } catch (_) { /* logging must never break sending */ }
}
