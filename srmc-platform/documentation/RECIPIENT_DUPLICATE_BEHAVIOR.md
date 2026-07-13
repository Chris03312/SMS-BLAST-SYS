# Recipient Duplicate & Re-send Behavior

> **What happens when you select 200 numbers and some have already been sent to?**

## Two Contexts

The system behaves differently depending on **where** you select your recipients.

---

## 1. Compose Page (Manual Entry)

When you **paste or type numbers directly** into the recipients textarea on the Compose page and send a broadcast:

### ✅ Numbers are ALWAYS re-sent

- **There is no deduplication check.** Every new broadcast creates fresh `messages` records for all 200 numbers in the `messages` table.
- The broadcast engine will attempt to send to **every number you entered**, regardless of whether those numbers were messaged in previous broadcasts.
- The only exception: if a message record for **this specific broadcast** already has a status of `sent`, `delivered`, or `failed`, the engine will skip it — but that only applies within the same broadcast, not across broadcasts.

### Example

```
Broadcast #1 → sent to 200 numbers (all delivered)
Broadcast #2 (same 200 numbers) → sends again to all 200
```

### Summary

| Source | Cross-broadcast dedup? | Auto-mark used? |
|--------|----------------------|-----------------|
| Compose (manual entry) | **No** | ❌ Not applicable (no contact records) |
| Recipients (assigned contacts) | **No** | ✅ Yes — on successful send only |

---

## 2. Recipients Page (Assigned Contacts)

When you use the **Recipients/Contacts page** (contacts assigned by admin):

### ✅ The "Used" flag tracks whether a number was already sent

Each contact in the `agent_contacts` table has a `used` column (0 or 1). Once a contact is marked `used = 1`, it will show as **"Used"** in the UI.

### ✅ You can filter by "Available" vs "Used"

The Recipients page has a filter bar with three options:

- **All** — show every contact (both used and unused)
- **Available** — show only contacts where `used = 0` (never sent to)
- **Used** — show only contacts where `used = 1` (already sent to)

### ✅ Auto-mark is NOW ACTIVE

Contacts are **automatically marked as `used = 1`** when a message is **successfully sent**. Failed messages do NOT mark the contact as used.

This happens in all three send paths:

| Path | When it marks as used |
|------|----------------------|
| **PUSH send** (direct HTTP to gateway) | Immediately on success |
| **PULL ACK** (phone reports sent) | When phone ACKs with status `'sent'` |
| **Delivery report** (carrier confirms) | When carrier reports status `'delivered'` |

```
Admin uploads 200 contacts for you
  → All 200 show as "Available" (used = 0)

You select all 200 and send a broadcast
  → 200 messages sent
  → ✔ 180 sent successfully → marked as "Used"
  → ✘ 20 failed → stay "Available"

If you go to the Recipients page again:
  - Filter "Available" → shows 20 (the failed ones, can retry)
  - Filter "Used" → shows 180 (successful ones, won't re-send)
  - Filter "All" → shows all 200
```

---

## Technical Walkthrough

### Step-by-step: What happens when you click "Send"

1. **Client** (`BlastDashboard.jsx`): Sends the recipient numbers to `POST /broadcasts`
2. **Server** (`routes/broadcasts.js`):
   - Normalizes phone numbers
   - Creates a new `broadcasts` record
   - Inserts one `messages` row per recipient (all with status `queued`)
   - Sets `broadcast.status = 'pending'`
   - Calls `startBroadcast(broadcastId)` asynchronously
3. **Broadcast Engine** (`broadcast-engine.js`):
   - Loads the recipients array
   - For each recipient number, queries:
     ```
     SELECT * FROM messages 
     WHERE broadcast_id = ? AND to_number = ? 
     AND status IN ('queued', 'pending')
     ```
   - Since all rows for this broadcast start as `queued`, **every number matches** and gets sent
   - On success: `messages.status` → `'sent'`
   - On failure: `messages.status` → `'failed'`

### Key code snippet (broadcast-engine.js)

```js
const msgRecord = db.prepare(
  "SELECT * FROM messages WHERE broadcast_id = ? AND to_number = ? AND status IN ('queued', 'pending')"
).get(broadcastId, number);
if (!msgRecord) continue;  // Only skips if this broadcast's message is already sent/failed
```

This query only checks messages **within the same broadcast**. It does not check across broadcasts.

---

## How to Avoid Re-sending to the Same Numbers

### Option 1: Filter manually on the Recipients page

1. Go to the **Recipients** page
2. Set filter to **"Available"** (shows only unused contacts)
3. Select the numbers you want
4. Click **"Send to Compose"**

### Option 2: Track by campaign

If you assign broadcasts to a **campaign**, you can check the campaign's broadcast history to see which numbers were already messaged.

### Option 3: Check broadcast history

Before composing, check the **History** page to see which numbers were sent to in recent broadcasts.

---

## Implementation Details

The auto-mark feature is implemented via:

1. **`broadcast-engine.js`** — exports `markContactAsUsed(toNumber, agentId, broadcastId)` which runs:
   ```sql
   UPDATE agent_contacts SET used = 1, broadcast_id = ?
   WHERE agent_id = ? AND phone_number = ? AND used = 0
   ```
   Called on successful PUSH sends in both normal and turbo mode.

2. **`gateway-outbound.js`** — calls `markContactAsUsed` on PULL ACK (`status === 'sent'`) and delivery report (`status === 'delivered'`).

3. **`contacts.js`** — phone numbers are now normalized to E.164 format on upload so they match the broadcast format.

4. **`db.js`** — on startup, existing contacts are automatically backfilled to E.164 format via a migration.

5. **`contacts.js`** (upload dedup) — when uploading contacts, the system now checks for existing phone numbers per agent and skips duplicates. The response includes a `skipped` count.

6. **`broadcasts.js`** (check-recipients endpoint) — `POST /broadcasts/check-recipients` returns which numbers have been sent to before by this agent.

7. **`BlastDashboard.jsx`** (re-send warning) — when the Review modal opens, the Compose page checks if any recipients were previously messaged and shows a warning banner.
