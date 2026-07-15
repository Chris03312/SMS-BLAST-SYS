import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

function fail(res, error, status = 400) {
  return res.status(status).json({ success: false, error });
}

// ── Admin: Upload contacts (client sends pre-parsed JSON) ─────────────
// Expected body: { agents: [{ name: "Maria", numbers: ["..."], dpd_group: "DPD 1", category: "PRIORITY" }, ...], fileName: "..." }

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
    const dpdGroups = new Set();
    const unmatchedNames = [];
    // Build a sorted list of system display names for suggestions
    const systemNames = allAgents.map(a => a.display_name).sort();

    for (const agent of agents) {
      const name = (agent.name || '').trim();
      const key = name.toLowerCase();
      const agentId = agentMap[key];
      if (!agentId) {
        const nums = Array.isArray(agent.numbers) ? agent.numbers : [];
        unmatchedNames.push({ name, count: nums.length });
        continue;
      }

      const dpdGroup = agent.dpd_group || '';
      if (dpdGroup) dpdGroups.add(dpdGroup);
      const category = agent.category || '';

      const nums = Array.isArray(agent.numbers) ? agent.numbers : [];
      for (const raw of nums) {
        const rawStr = String(raw).trim();
        const cleaned = rawStr.replace(/[\s\-().;]/g, '');
        // Store the raw number as-is from the Excel file (with semicolons).
        // Normalization to E.164 happens later in the broadcast engine.
        if (cleaned.length >= 7 && cleaned.length <= 16 && /^\+?\d+$/.test(cleaned)) {
          contacts.push({
            id: uuidv4(),
            agentId,
            batchId,
            phoneNumber: rawStr,
            dpdGroup,
            category,
          });
        }
      }
    }

    if (contacts.length === 0) {
      const unmatchedDetail = unmatchedNames.map(u => `"${u.name}" (${u.count} nums)`).join(', ');
      const suggestion = unmatchedNames.length > 0
        ? ` Unmatched: ${unmatchedDetail}. System agents: ${systemNames.join(', ')}`
        : '';
      return fail(res, `No valid phone numbers found.${suggestion} Make sure agent names match display names exactly.`);
    }

    // ── Dedup: skip phone numbers that already exist for each agent ──
    const agentIds = [...new Set(contacts.map(c => c.agentId))];
    const existingByAgent = {};
    for (const aid of agentIds) {
      const rows = db.prepare('SELECT phone_number FROM agent_contacts WHERE agent_id = ?').all(aid);
      // Strip semicolons from existing values so "09918933458" matches new "09918933458;"
      existingByAgent[aid] = new Set(rows.map(r => r.phone_number.replace(/;/g, '')));
    }
    const beforeDedup = contacts.length;
    const afterDedup = contacts.filter(c => !existingByAgent[c.agentId]?.has(c.phoneNumber.replace(/;/g, '')));
    const skippedCount = beforeDedup - afterDedup.length;

    if (afterDedup.length === 0) {
      return fail(res, `All ${skippedCount} numbers already exist for their assigned agents. No new contacts to add.`);
    }

    // Recalculate counts after dedup
    const totalNumbers = afterDedup.length;
    const dedupAgentCounts = {};
    const dedupMatched = [];
    for (const c of afterDedup) {
      const key = c.agentId;
      if (!dedupAgentCounts[key]) {
        const agentRow = db.prepare('SELECT display_name FROM users WHERE id = ?').get(key);
        dedupAgentCounts[key] = { name: agentRow?.display_name || 'Unknown', dpd_group: c.dpdGroup, count: 0 };
      }
      dedupAgentCounts[key].count++;
    }
    for (const val of Object.values(dedupAgentCounts)) {
      dedupMatched.push(val);
    }

    // Bulk-insert all contacts — uses a single prepared statement + one flushDb()
    // instead of 100K individual flushDb() calls. ~100x faster for large uploads.
    const rows = afterDedup.map(c => [c.id, c.agentId, c.batchId, c.phoneNumber, 0, c.dpdGroup, c.category]);
    db.bulkInsert('agent_contacts', ['id', 'agent_id', 'batch_id', 'phone_number', 'used', 'dpd_group', 'category'], rows);

    // Log activity
    const detail = dedupMatched.map(a => `${a.name}: ${a.count}`).join(', ');
    const skipNote = skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : '';
    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:upload', `Uploaded ${totalNumbers} contacts (${dedupMatched.length} agents)${skipNote} — ${detail}`);

    return ok(res, {
      batchId,
      total: totalNumbers,
      agents: dedupMatched.length,
      matched: dedupMatched,
      unmatched: unmatchedNames,
      system_agents: systemNames,
      skipped: skippedCount,
      dpd_groups: [...dpdGroups],
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

      // Get unique DPD groups for this batch
      const dpdGroups = db.prepare(`
        SELECT DISTINCT dpd_group FROM agent_contacts WHERE batch_id = ? AND dpd_group != '' ORDER BY dpd_group
      `).all(b.batch_id).map(r => r.dpd_group);

      // Get unique categories for this batch
      const categories = db.prepare(`
        SELECT DISTINCT category FROM agent_contacts WHERE batch_id = ? AND category != '' ORDER BY category
      `).all(b.batch_id).map(r => r.category);

      return { ...b, agents, dpd_groups: dpdGroups, categories };
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
    const dateFilter = req.query.date; // optional YYYY-MM-DD
    const usedFilter = req.query.used || 'all'; // 'all', 'available', 'used'

    // Build WHERE clauses
    const conditions = ['agent_id = ?'];
    const params = [req.user.id];

    if (dateFilter) {
      conditions.push('DATE(created_at) = ?');
      params.push(dateFilter);
    }

    if (usedFilter === 'available') {
      conditions.push('used = 0');
    } else if (usedFilter === 'used') {
      conditions.push('used = 1');
    }
    // 'all' — no used filter

    const whereClause = conditions.join(' AND ');

    // Fetch contacts with used field included
    const contactsSql = `SELECT id, phone_number, used, batch_id, created_at, dpd_group, category FROM agent_contacts WHERE ${whereClause} ORDER BY category, dpd_group, created_at DESC`;
    const contacts = db.prepare(contactsSql).all(...params);

    // Total count matching filter
    const totalSql = `SELECT COUNT(*) as c FROM agent_contacts WHERE ${whereClause}`;
    const total = db.prepare(totalSql).get(...params);

    // Available (unused) count
    const availConditions = ['agent_id = ?', 'used = 0'];
    const availParams = [req.user.id];
    if (dateFilter) {
      availConditions.push('DATE(created_at) = ?');
      availParams.push(dateFilter);
    }
    const availableTotal = db.prepare(`SELECT COUNT(*) as c FROM agent_contacts WHERE ${availConditions.join(' AND ')}`).get(...availParams);

    // Used count
    const usedConditions = ['agent_id = ?', 'used = 1'];
    const usedParams = [req.user.id];
    if (dateFilter) {
      usedConditions.push('DATE(created_at) = ?');
      usedParams.push(dateFilter);
    }
    const usedTotal = db.prepare(`SELECT COUNT(*) as c FROM agent_contacts WHERE ${usedConditions.join(' AND ')}`).get(...usedParams);

    return ok(res, {
      contacts,
      total: total?.c || 0,
      available: availableTotal?.c || 0,
      used: usedTotal?.c || 0,
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
             u.display_name as agent_name, ac.dpd_group, ac.category
      FROM agent_contacts ac
      JOIN users u ON ac.agent_id = u.id
      WHERE ac.batch_id = ?
      ORDER BY ac.category, ac.dpd_group, u.display_name, ac.created_at
    `).all(req.params.batchId);

    // Tally per agent + category combo
    const byAgent = {};
    for (const c of contacts) {
      const key = `${c.agent_name}__${c.category || ''}`;
      if (!byAgent[key]) byAgent[key] = { total: 0, used: 0, dpd_group: c.dpd_group || '', category: c.category || '' };
      byAgent[key].total++;
      if (c.used) byAgent[key].used++;
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

// ── Admin: Get all active agents (for dropdowns) ─────────────────────

router.get('/admin/contacts/agents', adminOnly, (req, res) => {
  try {
    const agents = db.prepare("SELECT id, display_name FROM users WHERE role = 'agent' AND active = 1 ORDER BY display_name").all();
    return ok(res, { agents });
  } catch (e) {
    console.error('[contacts] List agents error:', e);
    return fail(res, 'Internal server error', 500);
  }
});

// ── Admin: Update a single contact ─────────────────────────────────────

router.put('/admin/contacts/:id', adminOnly, (req, res) => {
  try {
    const { id } = req.params;
    const { category, agent_id, dpd_group } = req.body;

    const contact = db.prepare('SELECT id FROM agent_contacts WHERE id = ?').get(id);
    if (!contact) return fail(res, 'Contact not found', 404);

    const updates = [];
    const params = [];

    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }
    if (agent_id !== undefined) {
      // Verify agent exists
      const agent = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'agent' AND active = 1").get(agent_id);
      if (!agent) return fail(res, 'Agent not found or inactive', 400);
      updates.push('agent_id = ?');
      params.push(agent_id);
    }
    if (dpd_group !== undefined) {
      updates.push('dpd_group = ?');
      params.push(dpd_group);
    }

    if (updates.length === 0) return fail(res, 'No fields to update', 400);

    params.push(id);
    db.prepare(`UPDATE agent_contacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:update', `Updated contact ${id.slice(0, 8)}…`);

    return ok(res, { updated: true });
  } catch (e) {
    console.error('[contacts] Update contact error:', e);
    return fail(res, e.message, 500);
  }
});

// ── Admin: Bulk update contacts ────────────────────────────────────────

router.put('/admin/contacts/bulk-update', adminOnly, (req, res) => {
  try {
    const { ids, category, agent_id, dpd_group } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 'No contact IDs provided');

    const updates = [];
    const params = [];

    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }
    if (agent_id !== undefined) {
      const agent = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'agent' AND active = 1").get(agent_id);
      if (!agent) return fail(res, 'Agent not found or inactive', 400);
      updates.push('agent_id = ?');
      params.push(agent_id);
    }
    if (dpd_group !== undefined) {
      updates.push('dpd_group = ?');
      params.push(dpd_group);
    }

    if (updates.length === 0) return fail(res, 'No fields to update', 400);

    const setClause = updates.join(', ');
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE agent_contacts SET ${setClause} WHERE id IN (${placeholders})`);
    stmt.run(...params, ...ids);

    const fieldLabels = [];
    if (category !== undefined) fieldLabels.push('category');
    if (agent_id !== undefined) fieldLabels.push('agent');
    if (dpd_group !== undefined) fieldLabels.push('DPD group');

    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:bulk-update', `Updated ${ids.length} contacts (${fieldLabels.join(', ')})`);

    return ok(res, { updated: ids.length });
  } catch (e) {
    console.error('[contacts] Bulk update error:', e);
    return fail(res, e.message, 500);
  }
});

// ── Admin: Rename category across a batch ──────────────────────────────

router.put('/admin/contacts/rename-category', adminOnly, (req, res) => {
  try {
    const { batch_id, old_name, new_name } = req.body;
    if (!batch_id || !old_name || !new_name) return fail(res, 'batch_id, old_name, and new_name are required');
    if (old_name === new_name) return fail(res, 'New name must be different', 400);

    const result = db.prepare(
      'UPDATE agent_contacts SET category = ? WHERE batch_id = ? AND category = ?'
    ).run(new_name, batch_id, old_name);

    if (result.changes === 0) return fail(res, 'No contacts found with that category in this batch', 404);

    db.prepare(
      'INSERT INTO activity (id, user_id, action, detail) VALUES (?, ?, ?, ?)'
    ).run(uuidv4(), req.user.id, 'contacts:rename-category', `Renamed category "${old_name}" → "${new_name}" (${result.changes} contacts)`);

    return ok(res, { renamed: result.changes });
  } catch (e) {
    console.error('[contacts] Rename category error:', e);
    return fail(res, e.message, 500);
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
