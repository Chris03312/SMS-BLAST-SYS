# SRMC Platform — Development Guide

How to work on this project efficiently without rebuilding Docker containers every time.

---

## The Golden Rule

**Only rebuild Docker when you're deploying.** For daily work, run locally — changes reflect instantly.

---

## Quick Reference

| What you changed | Local dev | Docker |
|------------------|-----------|--------|
| React component | Saves instantly via Vite HMR | Rebuild needed |
| CSS file | Saves instantly via Vite HMR | Rebuild needed |
| Server route handler | Server auto-restarts via `--watch` | Rebuild needed |
| Database migration (`db.js`) | Server auto-restarts | Rebuild needed |
| `package.json` | Run `npm install`, then restart | Rebuild needed |
| `Dockerfile` or `docker-compose.yml` | Not applicable | Rebuild needed |
| Environment variables (`.env`) | Restart the server process | Set in `docker-compose.yml` |
| `xlsx` (SheetJS) dependency | `npm install xlsx` in `packages/client` | Rebuild needed |

---

## Setup (first time)

```bash
# Install all dependencies (one command — workspaces install everything)
npm install

# Build the React frontend (needed before first launch)
npm run client:build
```

---

## Daily Development

### Option A: Server-only changes (API routes, database, services)

```bash
npm run dev
```

This runs the Express server with `node --watch`, which **auto-restarts** whenever you save a `.js` or `.json` file. No manual restart needed.

```
[db] Database ready at C:\...\data\srmc.db
[server] Listening on http://localhost:3001
[ws] WebSocket server started
[poller] Gateway poller started
— (edit a route) —
[dev] Restarting...
[server] Listening on http://localhost:3001   ← auto-restarted
```

### Option B: UI-only changes (React components, CSS, pages)

```bash
# Terminal 1: keep the server running
npm start

# Terminal 2: Vite dev server with hot module replacement
npm run client:dev
```

Open `http://localhost:5173` in your browser. Vite updates the page **instantly** when you save a component — no full reload, no page flicker.

### Option C: Both server and UI changes (most common)

```
Terminal 1:  npm run dev           # Server with auto-restart
Terminal 2:  npm run client:dev    # Vite HMR on port 5173
```

The Vite dev server auto-proxies `/api` and `/ws` requests to the Express server on `localhost:3001`, so everything works together seamlessly.

---

## Internet Demo Deployment (ngrok)

For a quick demo accessible over the internet — no LAN needed. Uses the built-in ngrok tunnel in the web server.

### Setup

```bash
# 1. Get a free ngrok authtoken
#    Go to https://dashboard.ngrok.com/authtokens

# 2. Copy and configure the env template
cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env → paste your NGROK_AUTHTOKEN

# 3. Deploy with the internet compose file
docker compose -f apps/web/docker-compose.internet.yml up -d --build

# 4. Find your public URL
docker logs srmc-web --tail 10
# Look for: ✅ Tunnel established: https://xxx.ngrok-free.app

# 5. Open in browser and login
# Username: admin
# Password: (from .env ADMIN_PASSWORD, or check INITIAL_ADMIN.txt)
```

### Configure Android Phone

1. Open the SRMCGateway app
2. Tap the gear icon on the login screen
3. Set Server to your ngrok URL: `https://xxx.ngrok-free.app`
4. Leave Port blank (not needed for full URLs)
5. Log in with an agent account

### Internet Compose File

Located at `apps/web/docker-compose.internet.yml` — identical to the regular compose file but sets up `NGROK_AUTHTOKEN` so the web server auto-creates an ngrok tunnel on startup. The tunnel URL is registered in the database and served to Android phones via `/api/config`.

---

## Docker Deployment (Standard)

### Rebuild a single service

```bash
docker compose -f apps/web/docker-compose.yml build srmc-web
docker compose -f apps/web/docker-compose.yml up -d
```

### Rebuild everything

```bash
docker compose -f apps/web/docker-compose.yml up -d --build
```

### Data persistence

Your SQLite database and configuration live in Docker volumes (`srmc-web-data`), **not** inside the image. Rebuilding doesn't touch them — all data, admin accounts, and settings survive intact.

### Sanity check after deploy

```bash
# Check containers are running
docker compose -f apps/web/docker-compose.yml ps

# Check server health
curl http://localhost:8080/health

# Check startup logs
docker compose -f apps/web/docker-compose.yml logs srmc-web --tail=20
```

---

## Adding a New npm Package

```bash
# Local dev
npm install <package-name>

# Then for Docker, rebuild
docker compose -f apps/web/docker-compose.yml build srmc-web
```

The Docker build uses layer caching — if you only changed `package.json`, only the `npm install` layer reruns (not the client build or file copy stages).

---

## Common Tasks

| Task | Command |
|------|---------|
| Start server (production mode) | `npm start` |
| Start server (dev mode, auto-restart) | `npm run dev` |
| Start Vite dev server (HMR) | `npm run client:dev` |
| Build client for production | `npm run client:build` |
| Start central monitoring server | `npm run central` |
| Build Docker images | `docker compose -f apps/web/docker-compose.yml build` |
| Start all Docker services | `docker compose -f apps/web/docker-compose.yml up -d` |
| Rebuild and restart Docker | `docker compose -f apps/web/docker-compose.yml up -d --build` |
| Deploy internet demo (ngrok) | `docker compose -f apps/web/docker-compose.internet.yml up -d --build` |
| View Docker logs | `docker compose -f apps/web/docker-compose.yml logs -f` |
| Stop Docker services | `docker compose -f apps/web/docker-compose.yml down` |

---

## File Structure (What Goes Where)

```
srmc-platform/
├── packages/
│   ├── server/          # Express API, DB, routes, services
│   │   └── routes/      # Route handlers (gateways, broadcasts, etc.)
│   └── client/          # React frontend (Vite)
│       └── src/
│           ├── pages/   # Page components
│           └── components/  # Reusable UI components
├── apps/
│   └── web/             # Docker entry point + config
│       ├── .env.example          # Environment template (internet demo)
│       ├── docker-compose.yml         # Standard deployment
│       ├── docker-compose.internet.yml# Internet demo deployment (ngrok)
│       ├── Dockerfile
│       ├── index.js
│       └── nginx/
├── data/                # Runtime data (SQLite DB, logs, secrets)
│   ├── schema/          # Database schema DDL reference
│   │   ├── srmc-schema.sql     # Main server schema
│   │   └── central-schema.sql  # Central monitoring schema
│   └── INITIAL_ADMIN.txt
└── package.json         # Monorepo root (npm workspaces)
```

**Tip:** Server code is in `packages/server/`. UI code is in `packages/client/`. Docker config is in `apps/web/`.

---

---

## Central Monitoring Server

The optional central server aggregates stats from **multiple remote SRMC installations** — useful when you have servers deployed at different locations (branches, clients).

### How it works

```
┌──────────────────────┐     Every 5 minutes      ┌──────────────────────┐
│  SRMC Installation   │  ─── POST /api/stats/report ──►  │  Central Monitor   │
│  (Branch A - Manila) │  { messages_sent_today,    │  Port 4000           │
│                      │    gateways_online, ... }  │                      │
├──────────────────────┤                           │  Dashboard shows:    │
│  SRMC Installation   │  ─── POST /api/stats/report ──►  │  - All installations  │
│  (Branch B - Cebu)   │                           │  - Online/offline     │
├──────────────────────┤                           │  - Messages today     │
│  SRMC Installation   │  ─── POST /api/stats/report ──►  │  - All-time totals    │
│  (Branch C - Davao)  │                           │  - Per-install stats  │
└──────────────────────┘                           └──────────────────────┘
```

### Endpoints

| URL | What it does |
|-----|-------------|
| `http://localhost:4000/` | Full dashboard (HTML) |
| `http://localhost:4000/login` | Login page (if auth enabled) |
| `POST /api/stats/report` | Receives stats from remote servers (no auth) |
| `GET /api/dashboard` | Aggregated summary JSON |
| `GET /api/installations` | List all installations |
| `GET /api/installations/:id/stats` | Historical stats for one installation |

### Start / Stop

```bash
# Standalone (local dev)
npm run central
# → http://localhost:4000

# Via Docker (with the rest of the stack)
docker compose -f apps/web/docker-compose.yml up -d srmc-central
```

### Connecting a remote server

Set `CENTRAL_SERVER_URL` on the remote SRMC server to point it at this central server:

```bash
# In .env or docker-compose.yml on the remote machine:
CENTRAL_SERVER_URL=https://your-central-tunnel.ngrok-free.app
```

The remote server's **stats reporter** (runs every 5 minutes) will POST its metrics automatically. No other config needed.

### Authentication

Set the `CENTRAL_API_KEY` env var to password-protect the dashboard:

```bash
CENTRAL_API_KEY=my-secret-key
```

Without this, the dashboard is open (no login required).

### Its own database

The central server has its own SQLite database at:
```
apps/web/central-server/data/central.db
```

Schema reference: `data/schema/central-schema.sql`

---

## File Structure (What Goes Where)

```
srmc-platform/
├── packages/
│   ├── server/          # Express API, DB, routes, services
│   │   └── routes/      # Route handlers (gateways, broadcasts, etc.)
│   └── client/          # React frontend (Vite)
│       └── src/
│           ├── pages/   # Page components
│           └── components/  # Reusable UI components
├── apps/
│   └── web/
│       ├── index.js     # Docker entry point for main server
│       ├── central-server/  # Central monitoring server (separate process)
│       │   ├── index.js    # Express server + dashboard HTML
│       │   ├── db.js       # Its own SQLite database
│       │   └── Dockerfile  # Standalone Docker image
│       ├── Dockerfile
│       └── docker-compose.yml
├── data/                # Runtime data (SQLite DB, logs, secrets)
│   └── schema/          # Database schema DDL reference
├── DEVELOPMENT.md       # This file
└── package.json         # Monorepo root (npm workspaces)
```

**Tip:** Server code is in `packages/server/`. UI code is in `packages/client/`. Docker config is in `apps/web/`.

---

## TL;DR

```bash
# For development — just run these two:
npm run dev              # Terminal 1: server with auto-restart
npm run client:dev       # Terminal 2: UI with instant updates

# For deployment — rebuild Docker:
docker compose -f apps/web/docker-compose.yml up -d --build
```
