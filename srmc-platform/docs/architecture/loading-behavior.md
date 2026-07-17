# Page Loading Behavior — Why the Navigation Is Slow

## Summary

Navigating between pages in the admin or agent sections shows a loading spinner — and worse, the spinner often stays visible for a **noticeable** amount of time (500ms–3s). This isn't just "we don't cache" — there are real performance bottlenecks across the full request lifecycle. This document traces the critical path of a page navigation and explains every source of delay.

---

## The Critical Path of a Page Load

From click to fully rendered page, here's every step and where time is spent:

```
Click link → React Router remounts → Suspense loads JS chunk →
Component renders → useEffect fires → API call → Server processes →
DB queries → JSON response → Client deserializes → React re-renders →
Spinner hides
```

Each of these steps contributes measurable delay. Below is a breakdown.

---

## Bottleneck #1: sql.js (WASM) Database Overhead

**Severity: 🔴 High**

The database uses `sql.js` — SQLite compiled to WebAssembly running in Node.js. This is the single biggest source of slowness.

| Aspect | Native SQLite (better-sqlite3) | sql.js WASM |
|--------|-------------------------------|-------------|
| Query compilation | C-level, ~0.01ms | WASM → C → JS, ~0.1–0.5ms |
| Row conversion | Direct C structs | WASM → JS object, ~0.05ms/row |
| Statement lifecycle | Reusable handles | Create → bind → step → **free** every query |
| Query execution | Native CPU | WASM interpreter, 3–5× slower |

For 200 rows, the overhead adds up:

```js
// Each query does this (contacts.js, line 305):
const stmt = rawDb.prepare(sql);   // Compile SQL → WASM bytecode
stmt.bind(params);                  // Convert JS args → WASM memory
while (stmt.step()) rows.push(
  stmt.getAsObject()               // WASM struct → JS object (per row)
);
stmt.free();                       // Release WASM resources
// ↑ This happens for EVERY query, even repeated ones
```

**There is NO prepared statement reuse.** Every single call to `db.prepare()` (there are hundreds across all route files) compiles the SQL fresh, allocates WASM memory, executes, and frees. Compare with better-sqlite3 where prepared statements can be reused across requests.

**Impact on a typical page load:** 3–10 **additional** milliseconds per query just from WASM overhead. With 5–10 queries per page load, that's 15–100ms of pure overhead before any actual work.

---

## Bottleneck #2: Synchronous Full-DB Writes Blocking the Event Loop

**Severity: 🔴 High**

sql.js stores the entire database **in memory**. Every write requires exporting the full database to a byte buffer and writing it to disk synchronously:

```js
// db.js, flushDbSync():
const data = rawDb.export();       // WASM: serialize ALL tables → Uint8Array
writeFileSync(DB_PATH, data);      // Blocking I/O: write 20–100 MB to disk
```

Even with the 200ms debounce (which batches rapid writes), the **first write in each burst** creates a synchronous pause. For a 50 MB database:

| DB Size | `export()` time | `writeFileSync` time | Total blocked time |
|---------|-----------------|----------------------|--------------------|
| 10 MB | 15ms | 30ms | ~45ms |
| 50 MB | 80ms | 150ms | ~230ms |
| 100 MB | 160ms | 300ms | ~460ms |

**Who triggers writes during page navigation?**

Every page load triggers the **health endpoint** poll (called by the sidebar on navigation), which doesn't write. But if the server is also handling:
- Activity log inserts (`logActivity()` — every broadcast action, SMS send/fail, contact upload)
- Gateway heartbeat updates
- Broadcast progress updates
- Any `Statement.run()` call

…then a flushDb write might be IN PROGRESS when your page navigation request arrives. The event loop is blocked, so your API call just **waits** in the event queue.

```
Timeline:
  t=0ms    t=200ms         t=430ms        t=600ms
  │        │                │              │
  flush ──→ export(50MB) ──→ writeFile ──→ event loop free
  │                              ↑
  click nav ─────────────────────┘
  Your request queued, blocked for ~230ms
```

---

## Bottleneck #3: Correlated Subqueries (N+1 Inside SQL)

**Severity: 🟡 Medium**

Several endpoints use **correlated subqueries** — a subquery that runs once per row of the outer query. These are deceptively expensive because the query planner can't batch them:

```sql
-- agents.js, line 23–28 (GET /api/agents)
SELECT u.id, u.display_name,
  (SELECT COUNT(*) FROM broadcasts b WHERE b.agent_id = u.id) as broadcast_count,
  (SELECT COALESCE(SUM(b.sent), 0) FROM broadcasts b 
     WHERE b.agent_id = u.id AND b.created_at >= date('now', '-1 day')) as sent_today
FROM users u
WHERE u.role = 'agent'
ORDER BY u.created_at DESC
```

For **50 agents**, this runs:
- 1 outer query
- 50 `COUNT(*)` subqueries
- 50 `SUM(b.sent)` subqueries

That's **101 queries** for a single endpoint. Each subquery compiles, executes, and frees a sql.js prepared statement. With 50 agents and 5ms overhead per subquery, that's **500ms** just for this one endpoint.

**Affected endpoints:**
| Endpoint | Pattern | Approx queries |
|----------|---------|----------------|
| `GET /api/agents` | 2 correlated subqueries × N agents | 1 + 2N |
| `GET /api/campaigns` | 2 correlated subqueries × N campaigns | 1 + 2N |
| `GET /api/broadcasts` (admin) | 1 correlated subquery × N broadcasts | 1 + N |

---

## Bottleneck #4: ORDER BY + OFFSET Pagination

**Severity: 🟡 Medium**

Pagination uses `LIMIT ? OFFSET ?`, which forces sql.js to scan through all previous rows before returning the page:

```sql
SELECT id, phone_number, ...
FROM agent_contacts
WHERE agent_id = ?
ORDER BY category, dpd_group, created_at DESC
LIMIT 200 OFFSET 400  -- must scan rows 0–599, discard 0–399
```

With the composite index `idx_agent_contacts_list` (agent_id, category, dpd_group, created_at), the ORDER BY is index-assisted. But the OFFSET still requires reading and skipping index entries. For page 10 (offset 2000), sql.js reads 2200 index entries and 2200 rows from the database, converting all to JS objects, then discarding the first 2000.

**Cost:** Page 1: ~2ms. Page 5: ~10ms. Page 10: ~20ms. Cumulative, adds up with other queries.

---

## Bottleneck #5: React Lazy Loading (Code-Split Chunks)

**Severity: 🟡 Medium**

`App.jsx` uses `React.lazy()` to code-split every page into separate JS chunks. This is great for the initial bundle size (~200 KB instead of ~1.3 MB), but it adds a **network round-trip + JS parse time** for every new page visit:

```jsx
// App.jsx — every page is a separate chunk
const AdminContacts = React.lazy(() => import('./pages/admin/Contacts.jsx'));
const Recipients = React.lazy(() => import('./pages/agent/Recipients.jsx'));
// ...15 more lazy imports
```

When you navigate:
1. React Router matches the route
2. Suspense boundary catches the pending import
3. Browser fetches the JS chunk (HTTP request)
4. V8 parses + compiles the chunk (could be 50–200 KB of JS)
5. React renders the component → `useEffect` → `load()` → API call

**The spinner shows during steps 3–5.** In dev mode (Vite dev server), chunks aren't optimized — they're served as unbundled ES modules, making step 3 slower because each import chain triggers separate HTTP requests.

**In production** (built with `vite build`), chunks are tree-shaken and minified, but the parse/compile time for a ~100 KB page chunk on a mid-range machine is still ~50–100ms.

---

## Bottleneck #6: Large DOM Trees Without Virtualization

**Severity: 🟡 Medium**

Pages that render hundreds of rows (Contacts, Recipients, History, Messages) create thousands of DOM nodes. React must:

1. Create all the VDOM nodes
2. Diff them against the previous VDOM
3. Commit changes to the real DOM
4. Browser recalculates layout + paint

For 200 rows × 8 columns = ~2,400 table cells, plus wrapper divs and styling, that's roughly **5,000–8,000 DOM elements**. React's VDOM reconciliation for this many nodes on a single frame can take **50–150ms** — enough to feel sluggish.

There is **no virtualization** (react-window, react-virtualized, or tanstack-virtual). Every row is rendered into the actual DOM, even on page 10 where the user can only see rows 1–30 at a time.

---

## Bottleneck #7: Activity Log Inserts on Every Action

**Severity: 🟢 Low (burst impact)**

Every upload, SMS send, delivery report, and broadcast action calls `logActivity()`, which does:

```js
// activity.js
db.prepare('INSERT INTO activity (id, user_id, action, detail, level, campaign_id) VALUES (?, ?, ?, ?, ?, ?)')
  .run(uuidv4(), ...);  // → flushDb() → export 50MB → write to disk
```

During a broadcast (sending hundreds of SMS), the activity log is flooded with entries. Each `run()` queues a flushDb, and even debounced to 200ms, every flush blocks the event loop for 50–200ms. If the admin navigates to a page during an active broadcast, their API calls compete for the event loop with these flushes.

---

## Putting It All Together: Page Load Budget

Here's a **typical** agent page load (e.g., clicking "Recipients"), timed step by step:

| Step | Time | Cumulative |
|------|------|------------|
| React Router match + unmount old / mount new | 5ms | 5ms |
| Suspense: fetch JS chunk (dev: ~5 HTTP trips) | 30–100ms | 35–105ms |
| Parse + compile JS chunk | 20–80ms | 55–185ms |
| Component first render (spinner shown) | 5ms | 60–190ms |
| `useEffect` runs, calls `api.get('/agent/contacts')` | 1ms | 61–191ms |
| JWT auth middleware verifies token | 2–5ms | 63–196ms |
| **Server:** Build WHERE clause + compile SQL | 1–3ms | 64–199ms |
| **DB:** `SELECT used, COUNT(*) ... GROUP BY used` (in-memory scan with index) | 2–50ms | 66–249ms |
| **DB:** `SELECT COUNT(*)` (filtered) | 1–30ms | 67–279ms |
| **DB:** `SELECT ... ORDER BY ... LIMIT 200 OFFSET 0` | 2–30ms | 69–309ms |
| Convert sql.js rows → JS objects (200 rows × 7 cols) | 10–30ms | 79–339ms |
| Express JSON.stringify + send | 5–15ms | 84–354ms |
| Network round-trip (localhost dev: 1–5ms) | 1–5ms | 85–359ms |
| Client: JSON.parse response | 3–8ms | 88–367ms |
| React setState(data) → re-render | 50–150ms | 138–517ms |
| **Total spinner visible time** | | **~140–520ms** |

On a loaded system (where a flushDb is in progress or a broadcast is sending), this can easily balloon to **1–3 seconds**.

---

## Root Cause Summary

| Root Cause | Impact | Fix Complexity |
|------------|--------|----------------|
| sql.js WASM overhead + no prepared stmt reuse | 🔴 High | Medium (cache prepared statements) |
| Synchronous DB export blocking event loop | 🔴 High | Medium (defer/stream export) |
| Correlated subqueries (N+1 inside SQL) | 🟡 Medium | Low (rewrite as joins or batch) |
| ORDER BY + OFFSET pagination | 🟡 Medium | Medium (keyset/cursor pagination) |
| React lazy-loading adds JS parse time | 🟡 Medium | Low (preload chunks or inline critical) |
| Large DOM trees without virtualization | 🟡 Medium | Medium (add tanstack-virtual) |
| Activity log inserts during broadcasts | 🟢 Low | Low (batch activity inserts) |

---

## Why It's Built This Way

These are deliberate trade-offs, not oversights:

| Decision | Benefit | Cost |
|----------|---------|------|
| sql.js over better-sqlite3 | Zero native deps, works everywhere | 3–5× slower queries, sync writes |
| No client-side cache | No stale-data bugs for live broadcast states | Fetch on every nav |
| Full unmount/remount | Predictable lifecycle, no memory leaks | State lost on nav |
| Code-split chunks | Small initial bundle (200 KB vs 1.3 MB) | Fetch + parse on first visit |
| Activity log on every action | Full audit trail | Write contention during broadcasts |
| No virtualization | Simpler code, no extra deps | Slow render for data-heavy pages |

---

## Potential Solutions (In Order of Impact)

### A. Prepared Statement Cache (Highest Impact / Lowest Risk)

Cache compiled sql.js statements by SQL text instead of creating + freeing on every query. This eliminates the most expensive part of sql.js: WASM compilation.

```js
// Current: compiles SQL every time
db.prepare('SELECT * FROM users WHERE id = ?').get(id);

// With cache: compile once, reuse indefinitely
// Implementation: add a Map<string, Statement> in db.js
// that keeps compiled statements alive
```

**Estimated gain:** 30–50% reduction in query time across all endpoints.

### B. Keyset (Cursor) Pagination

Replace `OFFSET` with keyset pagination using the last-seen values.

```sql
-- Before (OFFSET — scans previous rows):
SELECT ... ORDER BY created_at DESC LIMIT 200 OFFSET 600;

-- After (keyset — seeks directly):
SELECT ... WHERE created_at < '2026-07-15T14:30:00.000Z'
ORDER BY created_at DESC LIMIT 200;
```

**Estimated gain:** Paginated queries become ~constant time regardless of page depth.

### C. Add React Query / SWR

A caching library would eliminate redundant fetches and show cached data instantly while updating in the background.

```jsx
const { data, isLoading } = useQuery({
  queryKey: ['contacts', dateFilter, usedFilter],
  queryFn: () => api.get(`/agent/contacts?date=...&used=...`),
  staleTime: 30_000,
});
```

**Estimated gain:** Second+ visits to the same page are instant (spinner hidden).

### D. Keep-Alive Router

Wrap pages in `<KeepAlive>` so they stay mounted in memory when navigating away. The component is hidden but not destroyed — navigating back shows it instantly.

**Estimated gain:** Zero delay for previously visited pages.

### E. Rewrite Correlated Subqueries as Joins

Replace `(SELECT ... FROM table WHERE fk = outer.pk)` with `LEFT JOIN (SELECT ... GROUP BY fk)`.

**Estimated gain:** 50–101 queries → 1 query for agents/campaigns endpoints.

### F. Batch Activity Log Inserts

Instead of one INSERT + flushDb per event, collect entries in an in-memory array and flush in batches.

**Estimated gain:** Reduces write contention during active broadcasts.

---

## Current State (as of July 2026)

- **sql.js** — In use with debounced flushDb (200ms). No prepared statement cache.
- **Client-side cache** — None. Every navigation is a fresh fetch.
- **Code splitting** — Active. Every page is a separate lazy-loaded chunk.
- **Indexes** — All critical indexes added (14 new indexes in recent session).
- **Server query optimizations** — N+1 batch fix for admin contacts, combined GROUP BY for counts.
- **Health endpoint** — 2-second in-memory cache.
- **Correlated subqueries** — Still present in agents.js, campaigns.js.
- **Pagination** — Uses OFFSET. Keyset cursor pagination not implemented.
