# System Improvement Proposals

> 📋 This document lists potential improvements to the SRMC Platform, ranked by impact. Review and decide which to implement.

---

## 🔴 High Impact (fastest wins)

### 1. Auto-cleanup of old broadcast data

**Problem:** The database grows indefinitely. Old messages, broadcasts, and activity logs are never deleted, causing the DB to bloat (currently 57MB). At 1GB+ the server becomes unusable.

**Solution:** Add a scheduled cleanup task that auto-deletes records older than a configurable threshold (e.g., 30/60/90 days).

**Files affected:**
- `packages/server/database/db.js` — add cleanup function
- `packages/server/app.js` — schedule cleanup on startup
- `packages/server/routes/settings.js` — add configurable retention setting
    
**Impact:** The database stays small forever. No more scaling problems.

---

### 2. Batch `saveProgress()` calls during broadcasts

**Problem:** Currently `saveProgress()` writes to the database AFTER EVERY SINGLE message. With 1000 recipients, that's 1000 separate writes. Each write creates unnecessary overhead.

**Solution:** Buffer progress updates and flush to disk every 10-20 messages instead of every message.

**Files affected:**
- `packages/server/services/broadcast-engine.js` — batch progress saves

**Impact:** ~90% reduction in DB writes during broadcasts. Faster sending, less server load.i 

---

### 3. Add skeletons to agent dashboard

**Problem:** Admin dashboard now shows shimmer skeletons during loading, but the agent dashboard may still show blank/empty states. Users stare at "No data" messages while data is actually loading.

**Solution:** Add `SkeletonStats`, `SkeletonTable`, and chart skeletons to the agent dashboard, matching what we did for the admin dashboard.

**Files affected:**
- `packages/client/src/pages/agent/Dashboard.jsx`

**Impact:** No more blank/empty flash on agent login.

---

## 🟡 Medium Impact

### 4. Track completed migrations

**Problem:** `initDb()` runs 50+ `ALTER TABLE` and `CREATE INDEX` migrations on EVERY server boot. Most throw harmless errors ("column already exists", "index already exists") that are caught silently. This wastes ~200ms on every restart and clutters error logs.

**Solution:** Create a `_migrations` table that tracks which migrations have already run. Only run pending migrations.

**Files affected:**
- `packages/server/database/db.js` — migration runner logic

**Impact:** Faster server restarts, cleaner error logs.

---

### 5. Faster gateway poller timeouts

**Problem:** If a gateway is offline, the poller waits 5 seconds for timeout. With 10 offline gateways, that's 50 seconds of blocked polling before the system moves on to other work.

**Solution:** Reduce the timeout to 2 seconds and/or poll gateways concurrently instead of sequentially.

**Files affected:**
- `packages/server/services/gateway-poller.js` — timeout and concurrency logic

**Impact:** Faster broadcast failures = less waiting when gateways are offline.

---

### 6. Toast notifications for user actions

**Problem:** Some operations (save, delete, cancel) don't show any feedback. Users click a button and don't know if it worked until they manually check.

**Solution:** Add a toast notification system for all user actions:
- ✅ "Broadcast cancelled successfully"
- ✅ "Template saved"
- ❌ "Failed to delete contact"

**Files affected:**
- New: `packages/client/src/components/Toast.jsx`
- Various page files — add toast calls after actions

**Impact:** The app feels more responsive and gives clear feedback even when there's network delay.

---

## 🟢 Nice to Have

### 7. Bulk select / batch cancel broadcasts

**Problem:** The "Cancel All" button cancels every running broadcast. But there's no way to cancel a specific set of broadcasts (e.g., cancel 3 out of 10).

**Solution:** Add checkboxes to the broadcasts table with a "Cancel Selected" button.

**Files affected:**
- `packages/client/src/pages/admin/Campaigns.jsx` or Broadcasts page
- `packages/server/routes/broadcasts.js` — batch cancel endpoint

**Impact:** More control over which broadcasts run.

---

### 8. Configurable auto-refresh interval

**Problem:** The admin dashboard uses a ~3s debounce for WebSocket-triggered refreshes. Users might want faster or slower updates depending on their network.

**Solution:** Make the refresh interval configurable via a slider or setting.

**Files affected:**
- `packages/client/src/pages/admin/Dashboard.jsx` — refresh logic
- `packages/client/src/context/SocketContext.jsx` — debounce setting

**Impact:** Power users can set faster updates during campaigns.

---

### 9. Dark mode

**Problem:** The app only has a light theme. Users working at night or in dark rooms get eye strain.

**Solution:** Add a dark mode toggle using CSS custom properties (the token CSS system makes this relatively easy).

**Files affected:**
- `packages/client/src/index.css` or theme tokens → add dark mode variables
- New: dark mode toggle component

**Impact:** Better user experience for night-time operators.

---

## Summary Table

| # | Improvement | Effort | Impact | Risk |
|---|------------|--------|--------|------|
| 1 | Auto-cleanup old data | 2-3 hours | 🔴 High | Low |
| 2 | Batch progress saves | 1-2 hours | 🔴 High | Low |
| 3 | Agent dashboard skeletons | 1 hour | 🔴 High | Low |
| 4 | Track completed migrations | 1-2 hours | 🟡 Medium | Low |
| 5 | Faster gateway timeouts | 30 min | 🟡 Medium | Low |
| 6 | Toast notifications | 2-3 hours | 🟡 Medium | Low |
| 7 | Bulk cancel broadcasts | 2 hours | 🟢 Nice | Low |
| 8 | Configurable refresh | 1 hour | 🟢 Nice | Low |
| 9 | Dark mode | 3-4 hours | 🟢 Nice | Low |

---

*Generated: July 17, 2026*
