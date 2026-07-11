import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
// normalizePhone removed — numbers are stored as-uploaded

const router = Router();

router.use(authMiddleware);

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── Admin: Upload contacts (client sends pre-parsed JSON) ─────────────
// Expected body: { agents: [{ name: "Maria", numbers: ["+639171234567", ...] }, ...], fileName: "..." }

router.post('/admin/contacts/upload', adminOnly, (req, res) => {
  try {
    const { agents, fileName } = req.body;
    if (!Array.isArray(agents) || agents.length === 0) {
      return fail(res, 'No agent data provided');
    }

    // Look up agents by display_name
    const allAgents = db.prepare("SELECT id, display_name FROM users WHERE role = 'agent' AND active = 1").all();
    const agentMap = {};
    for (const a of allAgents) {
      agentMap[a.display_name?.toLowerCase().trim()] = a.id;
    }

    const batchId = uuidv4();
    const contacts = [];
    const matchedAgents = [];
    let totalNumbers = 0;

    for (const agent of agents) {
      const name = (agent.name || '').trim();
      const key = name.toLowerCase();
      const agentId = agentMap[key];
      if (!agentId) continue;

      const nums = Array.isArray(agent.numbers) ? agent.numbers : [];
      const validNums = [];
      for (const raw of nums) {
        const cleaned = String(raw).trim();
        const digitsOnly = cleaned.replace(/[\s\-().]/g, '');
        if (digitsOnly.length >= 7 && digitsOnly.length <= 16 && /^\+?\d+$/.test(digitsOnly)) {
          contacts.push({
            id: uuidv4(),
            agentId,
            batchId,
            phoneNumber: cleaned,
          });
          validNums.push(cleaned);
          totalNumbers++;
        }
      }
      if (validNums.length > 0) {
        matchedAgents.push({ name: agent.name, count: validNums.length });
      }
    }

    if (contacts.length === 0) {
      return fail(res, 'No valid phone numbers found. Make sure agent names match display names exactly.');
    }

    // Insert each contact — no transaction needed since insertStmt.run() auto-flushes
    const insertStmt = db.prepare(
      'INSERT INTO agent_contacts (id, agent_id, batch_id, phone_number, used) VALUES (?, ?, ?, ?, 0)'
    );
    for (const c of contacts) {
      insertStmt.run(c.id, c.agentId, c.batchId, c.phoneNumber);
    }

    // Log activity
    const detail = matchedAgents.map(a => `${a.name}: ${a.count}`).join(', ');
    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:upload', `Uploaded ${totalNumbers} contacts (${matchedAgents.length} agents) — ${detail}`);

    return ok(res, {
      batchId,
      total: totalNumbers,
      agents: matchedAgents.length,
      matched: matchedAgents,
    });
  } catch (e) {
    console.error('[contacts] Upload error:', e);
    return fail(res, e.message, 500);
  }
});

// ── Admin: List upload batches ─────────────────────────────────────────

router.get('/admin/contacts/batches', adminOnly, (req, res) => {
  try {
    const batches = db.prepare(`
      SELECT 
        ac.batch_id,
        MIN(ac.created_at) as uploaded_at,
        COUNT(*) as total,
        COUNT(DISTINCT ac.agent_id) as agent_count,
        SUM(CASE WHEN ac.used = 1 THEN 1 ELSE 0 END) as used_count
      FROM agent_contacts ac
      GROUP BY ac.batch_id
      ORDER BY uploaded_at DESC
      LIMIT 50
    `).all();

    const batchDetails = batches.map(b => {
      const agents = db.prepare(`
        SELECT u.display_name as agent_name, COUNT(*) as count
        FROM agent_contacts ac
        JOIN users u ON ac.agent_id = u.id
        WHERE ac.batch_id = ?
        GROUP BY ac.agent_id
        ORDER BY count DESC
      `).all(b.batch_id);
      return { ...b, agents };
    });

    return ok(res, { batches: batchDetails });
  } catch (e) {
    console.error('[contacts] List batches error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Agent: Get my contacts ─────────────────────────────────────────────

router.get('/agent/contacts', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = parseInt(req.query.limit) || 200;
    const offset = page * limit;
    const dateFilter = req.query.date; // optional YYYY-MM-DD

    let contactsSql, contactsParams, totalSql, totalParams;

    if (dateFilter) {
      contactsSql = 'SELECT id, phone_number, batch_id, created_at FROM agent_contacts WHERE agent_id = ? AND used = 0 AND DATE(created_at) = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
      contactsParams = [req.user.id, dateFilter, limit, offset];
      totalSql = 'SELECT COUNT(*) as c FROM agent_contacts WHERE agent_id = ? AND used = 0 AND DATE(created_at) = ?';
      totalParams = [req.user.id, dateFilter];
    } else {
      contactsSql = 'SELECT id, phone_number, batch_id, created_at FROM agent_contacts WHERE agent_id = ? AND used = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?';
      contactsParams = [req.user.id, limit, offset];
      totalSql = 'SELECT COUNT(*) as c FROM agent_contacts WHERE agent_id = ? AND used = 0';
      totalParams = [req.user.id];
    }

    const contacts = db.prepare(contactsSql).all(...contactsParams);
    const total = db.prepare(totalSql).get(...totalParams);

    let usedSql, usedParams;
    if (dateFilter) {
      usedSql = 'SELECT COUNT(*) as c FROM agent_contacts WHERE agent_id = ? AND used = 1 AND DATE(created_at) = ?';
      usedParams = [req.user.id, dateFilter];
    } else {
      usedSql = 'SELECT COUNT(*) as c FROM agent_contacts WHERE agent_id = ? AND used = 1';
      usedParams = [req.user.id];
    }
    const usedTotal = db.prepare(usedSql).get(...usedParams);

    return ok(res, {
      contacts,
      total: total?.c || 0,
      used: usedTotal?.c || 0,
      page,
      limit,
    });
  } catch (e) {
    console.error('[contacts] Agent list error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Agent: Mark contacts as used ───────────────────────────────────────

router.put('/agent/contacts/mark-sent', (req, res) => {
  try {
    const { ids, broadcastId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 'No contact IDs provided');

    const markStmt = db.prepare(
      'UPDATE agent_contacts SET used = 1, broadcast_id = ? WHERE id = ? AND agent_id = ?'
    );
    const markAll = db.transaction(() => {
      for (const id of ids) {
        markStmt.run(broadcastId || null, id, req.user.id);
      }
    });
    markAll();

    return ok(res, { marked: ids.length });
  } catch (e) {
    console.error('[contacts] Mark sent error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Admin: List contacts in a batch ───────────────────────────────────

router.get('/admin/contacts/batch/:batchId', adminOnly, (req, res) => {
  try {
    const contacts = db.prepare(`
      SELECT ac.id, ac.phone_number, ac.used, ac.broadcast_id, ac.created_at,
             u.display_name as agent_name
      FROM agent_contacts ac
      JOIN users u ON ac.agent_id = u.id
      WHERE ac.batch_id = ?
      ORDER BY u.display_name, ac.created_at
    `).all(req.params.batchId);

    // Tally per agent
    const byAgent = {};
    for (const c of contacts) {
      if (!byAgent[c.agent_name]) byAgent[c.agent_name] = { total: 0, used: 0 };
      byAgent[c.agent_name].total++;
      if (c.used) byAgent[c.agent_name].used++;
    }

    return ok(res, {
      contacts,
      total: contacts.length,
      by_agent: byAgent,
    });
  } catch (e) {
    console.error('[contacts] Get batch error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Admin: Delete entire batch ─────────────────────────────────────────

router.delete('/admin/contacts/batch/:batchId', adminOnly, (req, res) => {
  try {
    const batch = db.prepare('SELECT COUNT(*) as c FROM agent_contacts WHERE batch_id = ?').get(req.params.batchId);
    if (!batch || batch.c === 0) return fail(res, 'Batch not found', 404);

    db.prepare('DELETE FROM agent_contacts WHERE batch_id = ?').run(req.params.batchId);

    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:delete-batch', `Deleted batch ${req.params.batchId.slice(0, 8)}… (${batch.c} contacts)`);

    return ok(res, { deleted: batch.c });
  } catch (e) {
    console.error('[contacts] Delete batch error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Admin: Delete a single contact ─────────────────────────────────────

router.delete('/admin/contacts/:id', adminOnly, (req, res) => {
  try {
    const contact = db.prepare('SELECT id FROM agent_contacts WHERE id = ?').get(req.params.id);
    if (!contact) return fail(res, 'Contact not found', 404);

    db.prepare('DELETE FROM agent_contacts WHERE id = ?').run(req.params.id);
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('[contacts] Delete contact error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

export default router;
