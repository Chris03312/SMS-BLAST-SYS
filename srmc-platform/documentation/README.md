# SystemBlast — Monorepo

SMS broadcast & gateway-management platform.
This monorepo contains both a **desktop app** (Electron) and a **web server**
(Docker-friendly), sharing the same Express backend and React frontend via
npm workspaces.

> **Production deployment:** SRMC Credit Collection Services

## Architecture

```
SystemBlast (srmc-platform)/
├── packages/
│   ├── server/          @srmc/server — shared Express server
│   │   ├── app.js       Express app factory (middleware, routes, DB init)
│   │   ├── db.js        sql.js (WASM) database wrapper
│   │   ├── secrets.js   Auto-generates JWT & webhook secrets
│   │   ├── routes/      API route handlers
│   │   ├── services/    Business logic (gateway, stats, config)
│   │   └── middleware/  Auth middleware
│   └── client/          @srmc/client — shared React + Vite frontend
│       ├── src/         React components, pages, context
│       └── public/      Static assets & CSS
├── apps/
│   ├── desktop/         @srmc/desktop — Electron desktop app
│   │   └── electron/    main.js (embeds server), preload.cjs
│   └── web/             @srmc/web — standalone web server (Docker)
│       ├── index.js     Entry point (starts server, WebSocket, tunnel)
│       ├── Dockerfile   Multi-stage Docker build
│       └── docker-compose.yml
├── central-server/      Optional separate monitoring server
├── data/                Runtime SQLite DB + secrets (gitignored)
└── package.json         Root — npm workspaces config
```

The renderer loads the UI from `http://localhost:<PORT>` (served by the Express
server), so the app works identically in the browser and in Electron.

## Develop (monorepo)

```bash
# Install everything (one command — workspaces install all packages)
npm install

# Build the React frontend (needed before first launch)
npm run client:build

# ▶️ Run as web server (http://localhost:3001):
npm start

# ▶️ Run as desktop app (after client:build):
npm run start:desktop
```

For live UI development, run the Vite dev server separately:
```bash
npm run client:dev        # Runs Vite on port 5173, proxies /api to :3001
```

## Docker (web server)

```bash
# From the monorepo root:
docker compose -f apps/web/docker-compose.yml up -d --build

# Or set env vars via .env file:
cp .env.example .env
# Edit .env with your settings
docker compose -f apps/web/docker-compose.yml up -d
```

## Dependencies

- **`xlsx` (SheetJS)** — Used in `packages/client` for generating multi-sheet Excel exports (`.xlsx`) in the Analytics page

## Configuration

Copy `.env.example` → `.env`. All values are optional:

| Var               | Purpose                                                        |
|-------------------|----------------------------------------------------------------|
| `PORT`            | Server/UI port (default `3001`).                               |
| `JWT_SECRET`      | Auth-token signing key. Leave as placeholder → auto-generated. |
| `WEBHOOK_SECRET`  | Inbound webhook secret. Leave blank → auto-generated.          |
| `NGROK_AUTHTOKEN` | Auto-open an ngrok tunnel for the inbound-SMS webhook.         |
| `NGROK_URL`       | Use a fixed public URL instead of auto-tunneling.              |
| `ADMIN_PASSWORD`  | Set admin password on every launch (recommended for Docker).   |
| `CENTRAL_SERVER_URL` | URL of the central monitoring server to report stats to.   |

**Secrets:** if `JWT_SECRET`/`WEBHOOK_SECRET` are left as placeholders, strong
random secrets are generated on first run and persisted to `<dataDir>/secrets.json`.

## Writable data

All writable state is stored under the `data/` directory (or `SRMC_DATA_DIR`):

- `srmc.db` — SQLite database
- `secrets.json` — generated secrets
- `sent.log` / `failed.log` — SMS send logs

For the **desktop app**, data goes to the OS user data dir:
- Windows: `%APPDATA%\SRMC Platform`
- macOS: `~/Library/Application Support/SRMC Platform`
- Linux: `~/.config/SRMC Platform`

For the **web server** (Docker), mount a volume at `/data`.

## Build desktop installer

```bash
# From the monorepo root:
npm run build:desktop
```

## Admin account (first run)

On a fresh database the app seeds **one** admin account.

- Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` to choose credentials, **or**
- leave `ADMIN_PASSWORD` blank and a random password is written to `<dataDir>/INITIAL_ADMIN.txt`.

Log in with those, change the password on the **Agents** page, then delete the file.
