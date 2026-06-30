# SRMC Platform — Complete Function Reference

> Covers all functions, classes, and endpoints across the four components:
> **Web App (React) · Server (Express) · Desktop (Electron) · Android Gateway (Java)**

---

## 1. Web App — React Client (`packages/client/`)

### 1.1 Routing (`App.jsx`)

| Route | Component | Access | Description |
|-------|-----------|--------|-------------|
| `/login` | `Login` | Public | Authentication page |
| `/` | `RoleRedirect` | Auth | Redirects based on role (admin → `/admin`, agent → `/dashboard`) |
| `/dashboard` | `Dashboard` | Agent | Broadcast task dashboard with running broadcast status |
| `/compose` | `BlastDashboard` | Agent | Compose and send new blast broadcasts |
| `/history` | `History` | Agent | List of past broadcasts with status filters |
| `/templates` | `AgentTemplates` | Agent | View SMS templates with variable preview |
| `/inbound` | `Inbound` | Agent | Inbound SMS replies, linked to agent's broadcasts |
| `/gateway` | `Gateway` | Agent | Gateway connectivity, test, SIM load checks |
| `/admin` | `AdminDashboard` | Admin | Stats overview, active broadcasts, gateway status |
| `/admin/templates` | `AdminTemplates` | Admin | CRUD templates, usage stats |
| `/admin/inbound` | `AdminInbound` | Admin | All inbound messages, cross-agent view |
| `/admin/agents` | `AdminAgents` | Admin | Manage agent accounts (create, edit, activate/deactivate) |
| `/admin/admins` | `Admins` | Super Admin | Manage admin accounts, role management |
| `/admin/numbers` | `Numbers` | Admin | Gateway device management, SIM info, last_error display |
| `/admin/webhooks` | `Webhooks` | Admin | Ngrok tunnel management, webhook status, domain config |
| `/admin/activity` | `Activity` | Admin | System-wide activity log with level filters |
| `/admin/settings` | `Settings` | Admin | All system settings (timezone, caps, delays, pause, reset) |
| `/admin/analytics` | `AdminAnalytics` | Admin | Historical analytics — select period (Daily/Weekly/Monthly/Yearly) auto-calculates date range; optional campaign filter. Export as multi-sheet Excel (.xlsx) |
| `/admin/campaigns` | `Campaigns` | Admin | Campaign management |
| `/admin/billing` | `Billing` | Admin | Billing/usage page |

### 1.2 Components (`components/`)

| Component | Props | Description |
|-----------|-------|-------------|
| `AdminShell` | `children` | Admin layout: sidebar nav, user chip, connectivity status, system info |
| `AgentShell` | `children` | Agent layout: top nav with tabs, unread inbound badge, network popover, global pause banner |
| `LiveBadge` | `label` (default `'Live'`) | Animated live indicator dot |
| `Modal` | `title`, `onClose`, `children`, `width` | Reusable modal with ESC close and backdrop click |
| `Pill` | `status`, `label`, `className` | Color-coded status badge: `ok` (green), `warn` (amber), `err` (red), `idle` (grey), `info` (blue) |
| `PasswordInput` | `value`, `onChange`, `placeholder`, etc. | Password input with eye toggle |

### 1.3 Context (`AuthContext.jsx`)

| Function | Returns | Description |
|----------|---------|-------------|
| `useAuth()` → `{ user, login, logout, loading }` | Auth context | Login/logout, persists JWT in `localStorage`, auto-validates on mount |
| `login(username, password)` | User object | POSTs to `/api/auth/login`, stores token |
| `logout()` | void | Clears token from storage |
| `loading` | boolean | True while validating stored token on page load |

### 1.4 Lib (`lib/`)

| File | Function | Description |
|------|----------|-------------|
| `api.js` | `api.get(path)` | GET request with Bearer token from localStorage |
| | `api.post(path, body)` | POST request |
| | `api.put(path, body)` | PUT request |
| | `api.del(path)` | DELETE request |
| `format.js` | `setTimezone(tz)` | Override display timezone (IANA string, e.g. `'Asia/Manila'`) |
| | `getTimezone()` | Get current timezone |
| | `formatDate(iso)` | Full date: "25 Jan 2026, 02:30 PM" |
| | `formatDateShort(iso)` | Short date: "25 Jan 2026" |
| | `formatTime(iso)` | Time only: "02:30 PM" |
| | `formatRelative(iso)` | Relative: "2m ago", "5h ago", "3d ago" |
| | `formatNumber(n)` | Philippine locale number (123,456) |
| `export.js` | `exportAnalyticsXlsx(data, periodLabel)` | Builds and downloads a multi-sheet Excel workbook (.xlsx) using SheetJS. Sheets: Period Breakdown, By Campaign, By Agent (SIM 1 & SIM 2 numbers), By Gateway |
| `ws.js` | `useWS(handler)` | React hook — subscribes to WebSocket events from server; auto-reconnects every 3s |

---

## 2. Server — Express (`packages/server/`)

### 2.1 Entry & Config

| File | Function | Description |
|------|----------|-------------|
| `app.js` | `app` (Express app) | Sets up all middleware (CORS, JSON, trust proxy), mounts routes, serves React static build, error handlers, health check at `/health` |
| | `initDb()` (called) | Initializes database schema and migrations |
| | `listLanIps()` | Lists all non-internal IPv4 LAN addresses |
| | `primaryLanIp()` | Uses UDP to discover the primary LAN IP (reaches 8.8.8.8) |
| | `checkInternet()` | Pings `clients3.google.com/generate_204` with a 4s timeout |
| | `GET /api/server-info` | Returns LAN IPs, primary URL |
| | `GET /api/server/connectivity` | Returns internet status, LAN, ngrok, central server config |
| | `GET /health` | Health check: `{status, time, port, ngrok}` |
| | `POST /api/stats/report-now` | Force immediate stats report to central server |
| | `POST /api/ngrok/start` | Start ngrok tunnel (admin only) |
| | `POST /api/ngrok/stop` | Stop ngrok tunnel (admin only) |
| | `GET /api/ngrok/status` | Get ngrok tunnel status |
| `db.js` | `initDb()` | Creates all 12 tables, indexes, default settings, runs migrations, ensures admin account |
| | `ensureAdminAccount()` | Creates/resets admin user from `ADMIN_PASSWORD` env, or generates random password |
| `secrets.js` | `loadOrGenerateSecrets()` | Loads or generates `JWT_SECRET` and `WEBHOOK_SECRET`; persists to `secrets.json` |
| | `resolveSecret(env, persisted, key)` | Resolves a secret: env → persisted → generate |
| `phone.js` | `normalizePhone(raw)` | Normalizes PH numbers to E.164: `+63...` from `09...`, `63...`, or `9...` |

### 2.2 Auth Middleware (`middleware/auth.js`)

| Function | Description |
|----------|-------------|
| `authMiddleware(req, res, next)` | Validates Bearer JWT from Authorization header; sets `req.user` |
| `adminOnly(req, res, next)` | Rejects non-admin/non-super_admin users with 403 |
| `superAdminOnly(req, res, next)` | Rejects non-super_admin users with 403 |

### 2.3 Auth Routes (`routes/auth.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `POST /api/auth/login` | `async (req, res)` | Validates username+password with bcrypt, returns JWT (24h expiry) |
| `GET /api/auth/me` | `(req, res)` | Returns current user profile (auth required) |

### 2.4 Gateway Auth Routes (`routes/gateway-auth.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `POST /api/auth/gateway/login` | `async (req, res)` | Android login: bcrypt verify, returns `inboundToken` (30d JWT) |
| `POST /api/auth/gateway/online` | `(req, res)` | Marks gateway online, captures SIM carrier info, device model |
| `POST /api/auth/gateway/offline` | `(req, res)` | Marks gateway offline |
| `POST /api/auth/gateway/heartbeat` | `(req, res)` | 60s heartbeat, returns per-gateway inbound webhook URL |
| `POST /api/auth/logout` | `(req, res)` | Revokes all gateway tokens |
| `GET /api/config` | `(req, res)` | Returns all settings + `INBOUND_WEBHOOK_URL` for Android discovery |
| `GET /api/ping` | `(req, res)` | Server presence check: `{message: "pong", time}` |

### 2.5 Gateway Outbound Routes (`routes/gateway-outbound.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/gateway/outbound?max=N` | `(req, res)` | Pull: claims pending messages for a gateway, marks as 'sending' with 120s timeout |
| `POST /api/gateway/outbound/ack` | `(req, res)` | ACK sent/failed results for claimed messages, updates broadcast progress |
| `POST /api/gateway/delivery-report` | `(req, res)` | Carrier delivery status: 'delivered' or 'delivery_failed'; tracks delivery_fails counter |

### 2.6 Gateway Routes (`routes/gateways.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/gateways` | `(req, res)` | List gateways with `in_use` flag (referenced by active broadcasts) |
| `POST /api/gateways` | `(req, res)` | Create new gateway (name, url, token, sim_carrier, number) |
| `PUT /api/gateways/:id` | `(req, res)` | Update gateway settings |
| `DELETE /api/gateways/:id` | `(req, res)` | Soft-delete (active=0) |
| `POST /api/gateways/:id/test` | `async (req, res)` | Test gateway connectivity (calls checkGatewayNow). Accepts optional `{ token }` in body to test with a form-field token instead of the saved DB token. Returns updated record with `last_error` |
| `DELETE /api/gateways/:id/log` | `async (req, res)` | Clear remote gateway's SMS log |
| `POST /api/gateways/:id/test-sim` | `async (req, res)` | Send test SMS through specified SIM (sim1/sim2) |

### 2.7 Broadcast Routes (`routes/broadcasts.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/broadcasts` | `(req, res)` | List broadcasts with filters (status, search, campaign), includes agent/template/gateway/campaign names |
| `GET /api/broadcasts/running/list` | `(req, res)` | All broadcasts in pending/sending/paused status |
| `GET /api/broadcasts/running/count` | `(req, res)` | Count of running broadcasts |
| `GET /api/broadcasts/:id` | `(req, res)` | Single broadcast with all messages |
| `GET /api/broadcasts/:id/messages` | `(req, res)` | Paginated messages for a broadcast, filterable by status |
| `POST /api/broadcasts` | `async (req, res)` | Create broadcast: validates caps (per-agent, daily, max recipients, global pause), inserts recipients with round-robin/linear distribution, fires `startBroadcast` |
| `DELETE /api/broadcasts/:id` | `(req, res)` | Cancel broadcast |
| `POST /api/broadcasts/:id/pause` | `(req, res)` | Pause running broadcast |
| `POST /api/broadcasts/:id/resume` | `(req, res)` | Resume paused broadcast |

### 2.8 Inbound Routes (`routes/inbound.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/inbound` | `(req, res)` | List inbound messages (agents see only their own, admins see all). Enriches with linked broadcast context |
| `POST /api/webhook/inbound` | `handleInboundWebhook` | Main webhook (used by ngrok). Accepts Android format (`{sender,message}` with Bearer token) or legacy format |
| `POST /api/webhook/inbound/:gatewayId` | `(req, res)` | Per-gateway webhook URL for shared ngrok tunnel |
| `POST /api/inbound` | `handleInboundWebhook` | LAN fallback endpoint |
| `PUT /api/inbound/:id` | `(req, res)` | Update inbound message (flag, mark read) |
| `POST /api/inbound/:id/reply` | `async (req, res)` | Reply: pull gateways → queue as pending message; push gateways → POST directly |
| | `enrichInboundMessages(messages)` | Batch lookup: links each inbound message to the most recent outbound broadcast to that number |

### 2.9 Agent Routes (`routes/agents.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/agents` | `(req, res)` | List agents with broadcast count and today's sent count |
| `POST /api/agents` | `async (req, res)` | Create agent (username, password, display_name) |
| `PUT /api/agents/:id` | `async (req, res)` | Update agent (name, password, active status) |
| `DELETE /api/agents/:id` | `(req, res)` | Deactivate agent (soft delete) |
| `GET /api/agents/admins` | `(req, res)` | List admin users (super_admin only) |
| `PUT /api/agents/admins/:id` | `async (req, res)` | Update admin user (super_admin only) |
| `DELETE /api/agents/admins/:id` | `(req, res)` | Deactivate admin (super_admin only, protects last super_admin) |

### 2.10 Stats Routes (`routes/stats.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/stats` | `(req, res)` | Global stats: 7-day sent/failed, delivery rate, active agents, sent by gateway, daily series |
| `GET /api/status` | `(req, res)` | Simple sending status (Android polls this) |
| `GET /api/user/stats/:userId` | `(req, res)` | Per-user stats (Android polls this) |
| `POST /api/stats/report` | `(req, res)` | Receive stats report from remote installations (no auth) |
| `GET /api/stats/remote-installations` | `(req, res)` | List remote installations |
| `GET /api/stats/historical` | `(req, res)` | Analytics: time-series by day/week/month/year, per-user/per-gateway/per-campaign breakdowns. Includes `g.number` and `g.number2` (both SIM numbers) in per-gateway data |
| `GET /api/stats/remote-dashboard` | `(req, res)` | Aggregated dashboard summary of all remote installations |

### 2.11 Template Routes (`routes/templates.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/templates` | `(req, res)` | List all templates with creator name |
| `POST /api/templates` | `(req, res)` | Create template (name, body, category, variables) |
| `PUT /api/templates/:id` | `(req, res)` | Update template |
| `DELETE /api/templates/:id` | `(req, res)` | Delete template |

### 2.12 Campaign Routes (`routes/campaigns.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/campaigns` | `(req, res)` | List campaigns with broadcast count and total sent |
| `POST /api/campaigns` | `(req, res)` | Create campaign |
| `PUT /api/campaigns/:id` | `(req, res)` | Update campaign |

### 2.13 Settings Routes (`routes/settings.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/settings` | `(req, res)` | Get all settings |
| `PUT /api/settings` | `(req, res)` | Update settings in bulk (admin only) |
| `POST /api/settings/purge-activity` | `(req, res)` | Delete all activity log entries |
| `POST /api/settings/reset` | `(req, res)` | Reset all settings to factory defaults |
| `POST /api/settings/revoke-sessions` | `(req, res)` | Revoke all gateway tokens (force re-login) |
| `POST /api/settings/toggle-pause` | `(req, res)` | Toggle global broadcast pause |

### 2.14 Activity Routes (`routes/activity.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `GET /api/activity` | `(req, res)` | List activity log with filters (level, user_id), joined with user/campaign names |

### 2.15 Services

#### config-service.js

| Function | Description |
|----------|-------------|
| `getPublicConfig()` | Returns all settings + `INBOUND_WEBHOOK_URL` (used by Android gateways at `/api/config`) |
| `getAllSettings()` | Returns all key-value settings from the `settings` table |
| `updateSettings(updates)` | Bulk upsert settings |

#### gateway-service.js

| Function | Description |
|----------|-------------|
| `gatewayLogin(userId)` | Authenticates gateway user, issues 30-day inbound JWT |
| `validateInboundToken(token)` | Verifies inbound token, returns payload or null |
| `gatewayOnline(userId, deviceInfo, number, simCarrier, number2, sim2Carrier)` | Marks gateway online, auto-registers as pull gateway, broadcasts `gateway:online` |
| `gatewayOffline(userId)` | Marks gateway offline, broadcasts `gateway:offline` |
| `gatewayHeartbeat(userId, extra)` | 60s heartbeat update, broadcasts `gateway:heartbeat` |
| `getInboundWebhookUrl(gatewayId)` | Returns ngrok or LAN webhook URL; per-gateway URL when gatewayId provided |
| `gatewayLogout(userId)` | Revokes all tokens and marks offline |
| `trackGatewayResult(gatewayId, success, gwName, agentId)` | Tracks consecutive send failures; alerts at 5+ consecutive fails |
| `registerNgrokWebhook(ngrokUrl)` | Stores ngrok URL in settings |

#### stats-service.js

| Function | Description |
|----------|-------------|
| `getGlobalStats()` | 7-day sent/failed, delivery rate, active agents, sent by gateway, daily series, gateway statuses |
| `getUserStats(userId)` | Today's sent/failed/queued per user, gateway info |
| `getSendingStatus()` | Whether any broadcasts are in progress |

### 2.16 Broadcast Engine (`broadcast-engine.js`)

| Function | Description |
|----------|-------------|
| `startBroadcast(broadcastId)` | Main broadcast execution engine: supports turbo mode (concurrent batches for push, fast-release for pull) and normal mode (one-at-a-time with delay). Enforces max concurrent, time windows, daily caps, global pause, max duration. Fix: `nowHHMM()` uses `.replace(/^24:/, '00:')` to handle midnight hours in `en-PH` locale |
| `sendViaSingleGateway(gateway, toNumber, message)` | Sends single SMS to push gateway with 15s timeout |
| `onMessageAcked(broadcastId)` | Recomputes broadcast progress from message rows; marks 'done' when nothing pending |
| `cancelBroadcast(broadcastId)` | Sets in-memory cancel flag |
| `pauseBroadcast(broadcastId)` | Sets in-memory pause flag, updates DB |
| `resumeBroadcast(broadcastId)` | Clears pause flag, resumes execution |
| `isBroadcastRunning(broadcastId)` | Checks if broadcast is in the running map |
| `getRunningBroadcasts()` | Returns all running broadcast IDs + pause status |
| `getRunningCount()` | Returns count of running broadcasts |

### 2.17 Gateway Poller (`gateway-poller.js`)

| Function | Description |
|----------|-------------|
| `checkGateway(gateway)` | Pings gateway with 5s timeout; categorizes errors (401→unauthorized, timeout→not responding, ECONNREFUSED→connection refused, etc.); stores `last_error` in DB; determines 'online'/'slow'/'offline' status |
| `startPoller()` | Runs every 30s: checks all non-pull gateways, counts sent_today |
| `checkGatewayNow(gatewayId, overrideToken?)` | Immediate single-gateway check (called by test endpoint). If `overrideToken` is provided, uses it instead of the DB-stored token so the Gateway form can test with an unsaved token. Returns updated gateway record |

### 2.18 Other Server Modules

| File | Function | Description |
|------|----------|-------------|
| `send-logger.js` | `resolveSender(gateway)` | Returns sender label: number → sender_id → gateway name |
| | `logSend({name, sender, receiver, status, time})` | Appends to `sent.log` or `failed.log` in data directory |
| `stats-reporter.js` | `startStatsReporter()` | Starts 5-minute periodic reporting to central server |
| | `stopStatsReporter()` | Stops the reporter |
| | `reportNow()` | Force immediate report |
| | `setCentralUrl(url)` | Updates central server URL and restarts reporter |
| | `collectStats()` | Gathers local stats (messages, gateways, users, broadcasts, system info) |
| `ngrok-tunnel.js` | `startNgrok(port, authtoken)` | Starts an ngrok tunnel with per-device auth/domain settings |
| | `stopNgrok()` | Stops the tunnel |
| | `getNgrokStatus()` | Returns `{running, url, webhookUrl}` |
| | `startNgrokAutoRetry(port)` | Retries tunnel every 30s until connected |
| | `stopNgrokAutoRetry()` | Stops retry loop |
| | `hasAuthtoken()` | Whether any ngrok auth token is available |
| `ws.js` | `initWss(server)` | Initializes WebSocket server on `/ws` path |
| | `broadcast(event)` | Sends JSON event to all connected WebSocket clients |

#### 2.19 Database Schema

Full reference: `data/schema/srmc-schema.sql`

| Table | Description |
|-------|-------------|
| `users` | User accounts (admin, super_admin, agent) with bcrypt hashed passwords |
| `gateways` | Gateway devices with URL, mode (push/pull), SIM info, status, error tracking |
| `gateway_tokens` | JWT token storage for gateway authentication |
| `campaigns` | Broadcast campaigns |
| `templates` | SMS templates with categories and variable support |
| `broadcasts` | Broadcast jobs with recipients, distribution mode, progress tracking |
| `messages` | Individual outbound messages (one per recipient per broadcast) |
| `inbound` | Inbound SMS messages with flags (opt-out, needs-reply, confirmed) |
| `activity` | System-wide activity log |
| `settings` | Key-value configuration store |
| `remote_installations` | Stats from connected remote servers (central server only) |
| `remote_stats_snapshots` | Historical snapshots of remote installation stats (central server only) |

### Indexes (created by db.js)

| Index | Table | Columns | Created |
|-------|-------|---------|---------|
| `idx_messages_broadcast_id` | messages | broadcast_id | Initial schema |
| `idx_messages_gateway_id_status` | messages | gateway_id, status | Initial schema |
| `idx_messages_to_number` | messages | to_number | Initial schema |
| `idx_messages_status` | messages | status | Initial schema |
| `idx_messages_sent_at` | messages | sent_at | Initial schema |
| `idx_broadcasts_agent_id` | broadcasts | agent_id | Initial schema |
| `idx_broadcasts_status` | broadcasts | status | Initial schema |
| `idx_broadcasts_created_at` | broadcasts | created_at | Initial schema |
| `idx_broadcasts_campaign_id` | broadcasts | campaign_id | Initial schema |
| `idx_campaigns_owner_id` | campaigns | owner_id | Initial schema |
| `idx_templates_created_by` | templates | created_by | Initial schema |
| `idx_users_role` | users | role | Initial schema |
| `idx_users_role_active` | users | role, active | Initial schema |
| `idx_gateways_status` | gateways | status | Initial schema |
| `idx_gateways_active_mode` | gateways | active, mode | After migration |
| `idx_inbound_created_at` | inbound | created_at | Initial schema |
| `idx_inbound_read_at` | inbound | read_at | Initial schema |
| `idx_inbound_agent_id` | inbound | agent_id | After migration |
| `idx_activity_user_id` | activity | user_id | Initial schema |
| `idx_activity_created_at` | activity | created_at | Initial schema |
| `idx_activity_action` | activity | action | Initial schema |
| `idx_gateway_tokens_gateway_id` | gateway_tokens | gateway_id | Initial schema |

**Note:** Indexes on `idx_gateways_active_mode` and `idx_inbound_agent_id` are created AFTER
migrations because they reference columns (`mode`, `agent_id`) that are added to existing
databases via ALTER TABLE.

---

## 3. Desktop App — Electron (`apps/desktop/electron/`)

### 3.1 Main Process (`main.js`)

| Function | Description |
|----------|-------------|
| `bootstrap()` | Main entry: init logging, register IPC, start server, create tray, create window, init auto-updater |
| `startServer()` | Dynamically imports server modules with `SRMC_DATA_DIR` set to `userData`; loads bundled `.env`; creates HTTP server; starts poller + stats reporter |
| `createWindow()` | Creates BrowserWindow (1280×800, min 900×600), loads `http://localhost:PORT`, opens links externally, minimizes to tray on close |
| `createTray()` | System tray with context menu: open window, check updates, port display, quit |
| `createTrayIcon()` | Generates tray icon (prefers `icon.ico`/`icon.png`, fallback to blue dot) |
| `registerIpc()` | IPC handlers: window minimize/maximize/close, show notification, app version |
| `shutdown()` | Graceful shutdown: stop stats reporter, close HTTP server, close log, quit |
| `initLogging()` | Redirects console.log/warn/error to file in `userData/logs/main.log` |
| `initAutoUpdater()` | Configures `electron-updater` with manual download, install-on-quit |
| `resolveIcon()` | Resolves app icon path (ico for Windows, png otherwise) |
| `showWindow()` | Shows main window (creates if null) |
| `getServerPort()` | Returns the running server port |
| `getServerUrl()` | Returns `http://localhost:{PORT}` |
| `addShutdownHook(hook)` | Registers a shutdown callback |

### 3.2 Preload Script (`preload.cjs`)

| API | Description |
|-----|-------------|
| `electronAPI.getServerUrl()` | Returns the server URL for the renderer |
| `electronAPI.minimizeWindow()` | Minimizes the window |
| `electronAPI.maximizeWindow()` | Maximizes/unmaximizes the window |
| `electronAPI.closeWindow()` | Hides the window (minimizes to tray) |
| `electronAPI.onServerStatus(callback)` | Subscribe to server status events |
| `electronAPI.showNotification(title, body)` | Shows native OS notification |
| `electronAPI.getAppVersion()` | Returns app version via IPC |
| `electronAPI.isElectron` | `true` — flag for renderer to detect Electron environment |

---

## 4. Android Gateway — Java (`SRMCGateway/`)

### 4.1 Activities

#### LoginActivity

| Method | Description |
|--------|-------------|
| `onCreate(savedInstanceState)` | Checks for saved session (skips to MainActivity if logged in). Inflates login form, shows server info, sets up UI |
| `showServerSettingsDialog()` | Opens Material dialog for server IP + port configuration |
| `attemptLogin()` | Validates inputs then POSTs to `/api/auth/gateway/login` on background thread |
| `onLoginSuccess(userId, name, role, status, inboundToken, webhookUrl)` | Saves credentials + inbound token/webhook to SharedPreferences, calls `notifyGatewayOnline()`, launches MainActivity |
| `notifyGatewayOnline(userId)` | POSTs to `/api/auth/gateway/online` with device info and auto-detected SIM carriers |
| `saveServerConfig(ip, portStr)` | Persists server IP and port |
| `updateServerInfo()` | Updates UI with current server address |
| `showError(msg)` | Shows error card with message |
| `hideError()` | Hides error card |
| `setLoading(loading)` | Toggles loading state (progress bar + disabled inputs) |
| `showFatalOnScreen(t)` | Fallback UI: renders crash stack trace as scrollable text (no XML dependency) |

#### MainActivity

| Method | Description |
|--------|-------------|
| `onCreate(savedInstanceState)` | Restores session, starts heartbeat, binds views, initializes tabs/stats poller, detects SIMs, checks permissions |
| `setupUserHeader()` | Shows welcome name, role badge, active/inactive status, logout button |
| `updateStatusBadge(status)` | Colors status indicator green (Active) or grey (Inactive) |
| `confirmLogout()` | Shows confirmation dialog |
| `performLogout()` | Stops GatewayService + stats poller + heartbeat; POSTs offline + logout to server; clears SharedPreferences |
| `startGatewayHeartbeat()` | Starts 60s scheduled heartbeat via ScheduledExecutorService |
| `stopGatewayHeartbeat()` | Shuts down heartbeat executor |
| `refreshInboundWebhookUrl()` | GETs `/api/config` and updates stored webhook URL with the latest ngrok URL |
| `performWebhookTest()` | Full webhook test: resolve URL + token from prefs, POST test payload, show result |
| `sendHeartbeat(userId)` | POSTs heartbeat to `/api/auth/gateway/heartbeat` with SIM carrier info, then refreshes webhook URL |
| `initStatsPoller()` | Creates ServerStatsPoller, wires callback to UI fields |
| `toggleService()` | Starts/stops GatewayService foreground service |
| `updateStatusUi()` | Updates gateway status text, start/stop button |
| `toggleDualSim()` | Toggles dual SIM mode (round-robin SMS sending) |
| `detectSims()` | Reads SubscriptionManager for SIM1/SIM2 carriers and subscription IDs, auto-enables dual SIM if both detected |
| `checkPermissions()` | Requests SEND_SMS, RECEIVE_SMS, READ_SMS, READ_PHONE_STATE, POST_NOTIFICATIONS (API 33+) |
| `getLocalIp()` | Returns the device's LAN IP address |
| `generateApiKey()` | Generates 8-char alphanumeric API key for the embedded HTTP server (changed from 32 chars for easier copy-paste) |
| `savePort()` | Saves embedded HTTP server port from UI |
| `saveSrmcServer()` | Saves SRMC server IP + port |
| `checkSrmcServerNow()` | Pings SRMC server and shows result |
| `showBanner(reason)` | Shows error banner at top of screen |
| `hideBanner()` | Hides error banner |
| `refreshLog()` | Reloads message log from SharedPreferences |

### 4.2 Services

#### GatewayService (Foreground Service)

| Method | Description |
|--------|-------------|
| `onCreate()` | Creates notification channel, acquires partial WakeLock |
| `onStartCommand(intent, flags, startId)` | Calls `startForeground()` (with type flag on API 34+), checks server via `ServerChecker`, starts SMS HTTP server + OutboundPoller if OK |
| `onTaskRemoved(rootIntent)` | Reschedules service via AlarmManager (1s delay) when user swipes app away |
| `onDestroy()` | Stops OutboundPoller, SMS HTTP server, releases WakeLock |

_Note: The embedded HTTP server (SmsHttpServer / NanoHTTPD) has been removed._

### 4.3 Pollers

#### OutboundPoller

| Method | Description |
|--------|-------------|
| `start()` | Starts polling every 5s: registers SmsDeliveryReceiver, runs `pollOnce()` on executor |
| `stop()` | Stops polling, unregisters receiver |
| `pollOnce()` | One cycle: GET `/api/gateway/outbound?max=10` → claim messages → send each via SMS (SIM1 or SIM2 round-robin) with 1.2s gap → POST ACK results to `/api/gateway/outbound/ack` |
| `registerDeliveryReceiver()` | Registers SmsDeliveryReceiver for sent/delivery intents (RECEIVER_EXPORTED on API 33+) |
| `unregisterDeliveryReceiver()` | Unregisters delivery receiver |

#### ServerStatsPoller

| Method | Description |
|--------|-------------|
| `start()` | Starts polling every 15s |
| `stop()` | Stops polling |
| `pollNow()` | Triggers immediate fetch |
| `fetchAndDeliver()` | GETs `/api/status` and `/api/user/stats/{userId}`, delivers Stats object to callback on main thread |
| `setUserId(userId)` | Sets user ID for user-scoped stats |

### 4.4 Receivers

#### InboundSmsReceiver (Broadcast Receiver)

| Method | Description |
|--------|-------------|
| `onReceive(context, intent)` | Intercepts `SMS_RECEIVED` intent, extracts sender + message body, forwards to server on background thread |
| `forwardToServer(context, sender, message)` | POSTs to stored webhook URL (ngrok) or LAN fallback with Bearer token auth |

#### SmsDeliveryReceiver (Broadcast Receiver)

| Method | Description |
|--------|-------------|
| `onReceive(context, intent)` | Handles `SMS_SENT` and `SMS_DELIVERED` intents: reports failures (generic, no service, null PDU, radio off) to server via `POST /api/gateway/delivery-report` |
| `reportToServer(context, messageId, toNumber, status, error, simSlot)` | POSTs delivery report to server |

#### BootReceiver (Broadcast Receiver)

| Method | Description |
|--------|-------------|
| `onReceive(ctx, intent)` | On `BOOT_COMPLETED`, starts GatewayService if `auto_start` preference is enabled |

### 4.5 Utilities

#### ServerChecker

| Method | Description |
|--------|-------------|
| `check(ctx, callback)` | Pings `GET /api/ping` with 5s timeout; delivers result on main thread |

#### ServerConfig

| Method | Description |
|--------|-------------|
| `getIp(ctx)` | Returns stored server IP (default: `192.168.3.239`) |
| `getPort(ctx)` | Returns stored server port (default: 3001) |
| `getBaseUrl(ctx)` | Returns full URL: accepts full http/https URLs (for internet servers) or builds `http://{ip}:{port}` |
| `getPingUrl(ctx)` | Returns `{baseUrl}/api/ping` |
| `setIp(ctx, ip)` | Saves server IP |
| `setPort(ctx, port)` | Saves server port |

#### SmsSender

| Method | Description |
|--------|-------------|
| `send(ctx, toNumber, message)` | Send SMS via default SIM |
| `sendWithTracking(ctx, toNumber, message, sentIntent, deliveryIntent)` | Send with delivery tracking PendingIntents |
| `sendViaSubIdWithTracking(ctx, toNumber, message, subId, sentIntent, deliveryIntent)` | Send via specific SIM subscription with tracking |
| `sendViaSubId(ctx, toNumber, message, subId)` | Send via specific SIM subscription |
| `sendAlternating(ctx, toNumber, message)` | Alternate SIM round-robin |
| `sendBothSims(ctx, to1, msg1, to2, msg2)` | Send two messages concurrently via both SIMs |
| _(removed)_ | Flash SMS functionality has been removed |
| `sendRegular(ctx, toNumber, message, subId, sentIntent, deliveryIntent)` | Send regular SMS via `sendTextMessage` or `sendMultipartTextMessage` with API level handling |
| _(removed)_ | Flash SMS PDU building has been removed |
| `getSmsManager(ctx, subId)` | Factory: returns SmsManager for specific subscription ID |
| `getDefaultSubId(ctx)` | Returns SIM 1 subscription ID |
| `getSim1SubId(ctx)` | Returns SIM 1 subscription ID from prefs |
| `getSim2SubId(ctx)` | Returns SIM 2 subscription ID from prefs |
| `isDualSimEnabled(ctx)` | Checks dual SIM preference + SIM 2 availability |
| `getAlternatingSubId(ctx)` | Round-robin between SIM 1 and SIM 2 |

#### MessageLog

| Method | Description |
|--------|-------------|
| `load(ctx)` | Loads last 100 log entries from SharedPreferences |
| `add(ctx, entry)` | Prepends entry to log (max 100), persists |
| `clear(ctx)` | Clears all log entries |
| `toJson(ctx)` | Returns log entries as JSON string |

#### LogAdapter (RecyclerView)

| Method | Description |
|--------|-------------|
| `update(items)` | Replaces dataset and refreshes |
| `onCreateViewHolder(parent, viewType)` | Inflates item_log layout |
| `onBindViewHolder(holder, pos)` | Binds Entry data to views: status icon, recipient, message, type/note, timestamp |

#### App (Application subclass)

| Method | Description |
|--------|-------------|
| `onCreate()` | Installs global uncaught-exception handler that writes crash reports to internal + external storage (`last_crash.txt`) |

---

## 5. Central Monitoring Server (`apps/web/central-server/`)

### 5.1 Server (`index.js`)

| Endpoint | Handler | Description |
|----------|---------|-------------|
| `POST /api/stats/report` | `(req, res)` | Receives stats from remote installations (no auth). Upserts installation record, inserts stats snapshot, updates counters |
| `GET /api/installations` | `(req, res)` | Lists all known remote installations (auth required) |
| `GET /api/installations/:id/stats` | `(req, res)` | Returns stats history for a specific installation (auth required) |
| `GET /api/dashboard` | `(req, res)` | Aggregated dashboard: total/online installations, messages sent today/all-time (auth required) |
| `GET /api/auth/status` | `(req, res)` | Returns auth status: `{auth_enabled, authenticated}` |
| `GET /login` | `(req, res)` | Login page (HTML) — enter API key |
| `GET /` | `(req, res)` | Dashboard (HTML) — shows all installations with live status table, auto-refreshes every 30s |

### 5.2 Database (`db.js`)

| Table | Description |
|-------|-------------|
| `installations` | Remote server installations with org info, system specs, message counters, last seen |
| `stats_snapshots` | Periodic stat snapshots (5-min intervals) per installation |

---

## 6. Web App Server Entry (`apps/web/index.js`)

| Call | Description |
|------|-------------|
| `createServer(app)` | Creates HTTP server from Express app |
| `initWss(server)` | Attaches WebSocket |
| `server.listen(PORT)` | Starts server on configured port |
| `startNgrok(PORT)` | Auto-starts ngrok tunnel if auth token available |
| `startNgrokAutoRetry(PORT)` | Retries ngrok every 30s until connected |
| `startPoller()` | Starts gateway health check poller |
| `startStatsReporter()` | Starts central server stats reporter |
| `SIGINT`/`SIGTERM` handlers | Graceful shutdown |

## 7. Docker Deployment Files (`apps/web/`)

### Standard Deployment (`docker-compose.yml`)

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `srmc-nginx` | nginx:alpine | 8080 → 80 | Reverse proxy + static file serving |
| `srmc-web` | (build) | 3001 (internal) | Express API + React frontend |

Usage:
```bash
docker compose -f apps/web/docker-compose.yml up -d --build
```

### Internet Demo Deployment (`docker-compose.internet.yml`)

Same as standard but configures `NGROK_AUTHTOKEN` so the web server auto-creates an
ngrok tunnel on startup. The tunnel URL is registered in the database and served
to Android phones via `/api/config`.

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `srmc-nginx` | nginx:alpine | 8080 → 80 | Reverse proxy + static file serving |
| `srmc-web` | (build) | 3001 (internal) | Express + React + auto ngrok tunnel |

Usage:
```bash
cp apps/web/.env.example apps/web/.env
# Edit .env with NGROK_AUTHTOKEN, ADMIN_PASSWORD
docker compose -f apps/web/docker-compose.internet.yml up -d --build
# Get URL: docker logs srmc-web --tail 10
```

### Environment Template (`apps/web/.env.example`)

| Variable | Purpose |
|----------|---------|
| `NGROK_AUTHTOKEN` | ngrok authtoken for internet tunnel |
| `ADMIN_USERNAME` | Admin login username (default: admin) |
| `ADMIN_PASSWORD` | Admin login password (default: demo123) |
| `JWT_SECRET` | JWT signing key (auto-generated if blank) |
| `WEBHOOK_SECRET` | Webhook secret (auto-generated if blank) |
