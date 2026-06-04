/**
 * electron/main.js — SRMC Platform Desktop App (Electron main process).
 *
 * Embeds the Express server inside Electron so no separate Node.js setup is
 * needed. The app lives in the system tray when the window is closed.
 *
 * Production notes:
 *   - The app bundle (app.asar / Program Files) is READ-ONLY. All writable
 *     state (SQLite DB, generated secrets, logs) goes under app.getPath('userData').
 *     We set SRMC_DATA_DIR *before* the server modules are imported (dynamic
 *     import) so db.js / secrets.js pick it up.
 *   - A single-instance lock prevents a second launch from fighting over the port.
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog, shell } from 'electron';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

// electron-updater is CommonJS — use createRequire so it works inside the bundled portable exe
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

let mainWindow    = null;
let tray          = null;
let httpServer    = null;
let shutdownHooks = [];
let ngrokUrl      = null;
let logStream     = null;

// These are populated from the dynamically-imported server module.
let server = {};
let PORT   = parseInt(process.env.PORT, 10) || 3001;

// ── Single-instance lock ──────────────────────────────────────────────────
// Acquire before anything else; a second launch just focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
  bootstrap();
}

// ── Logging to a file in userData (console still works in dev) ─────────────

function initLogging() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, 'main.log'), { flags: 'a' });

    const wrap = (orig, level) => (...args) => {
      const line = `[${new Date().toISOString()}] [${level}] ` +
        args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
      try { logStream.write(line); } catch (_) {}
      orig(...args);
    };
    console.log   = wrap(console.log.bind(console),   'info');
    console.warn  = wrap(console.warn.bind(console),  'warn');
    console.error = wrap(console.error.bind(console), 'error');
  } catch (e) {
    // Logging is best-effort — never block startup on it.
  }
}

// ── Start the embedded Express server ──────────────────────────────────────

async function startServer() {
  // CRITICAL: set the writable data dir BEFORE importing any server module,
  // because db.js/secrets.js read SRMC_DATA_DIR at import time.
  process.env.SRMC_DATA_DIR = app.getPath('userData');

  // Load the BUNDLED .env explicitly from the app folder. `dotenv/config`
  // (used by app.js) only reads from the current working directory, which is
  // NOT the app folder for an installed app — so without this the baked-in
  // ADMIN_PASSWORD / NGROK / CENTRAL_SERVER_URL would be ignored once installed.
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(ROOT, '.env') });
    console.log('[electron] Loaded env from', path.join(ROOT, '.env'));
  } catch (e) {
    console.warn('[electron] Could not load bundled .env:', e.message);
  }

  // Dynamic import so the env vars above are in place first.
  const appMod = await import('../server/app.js');
  const { initWss }                            = await import('../server/ws.js');
  const { startNgrok, startNgrokAutoRetry, stopNgrok, hasAuthtoken } = await import('../server/ngrok-tunnel.js');
  const { startStatsReporter, stopStatsReporter } = await import('../server/stats-reporter.js');
  const { startPoller }                        = await import('../server/gateway-poller.js');

  server = {
    serverApp: appMod.default,
    NGROK_URL: appMod.NGROK_URL,
    NGROK_AUTHTOKEN: appMod.NGROK_AUTHTOKEN,
    initWss, startNgrok, startNgrokAutoRetry, stopNgrok, hasAuthtoken, startStatsReporter, stopStatsReporter, startPoller,
  };
  PORT = appMod.PORT;

  return new Promise((resolve, reject) => {
    try {
      httpServer = createServer(server.serverApp);
      server.initWss(httpServer);

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${PORT} is already in use. Close the other instance or set a different PORT.`));
        } else {
          reject(err);
        }
      });

      // Bind to all interfaces (0.0.0.0) so Android gateways on the same LAN can
      // reach this PC by its LAN IP (e.g. http://192.168.1.20:3001) — no ngrok
      // needed when the phone and PC are on the same network.
      httpServer.listen(PORT, '0.0.0.0', async () => {
        console.log(`[electron] Embedded server on http://localhost:${PORT}`);
        process.env.SRMC_PORT = String(PORT);

        await startTunnel();
        server.startPoller();
        server.startStatsReporter();
        resolve(httpServer);
      });
    } catch (err) {
      console.error('[electron] Failed to start server:', err);
      reject(err);
    }
  });
}

// ── ngrok tunnel (so Android gateways reach inbound webhook off-LAN) ───────

async function startTunnel() {
  if (server.NGROK_URL) {
    ngrokUrl = server.NGROK_URL;
    console.log(`[ngrok] Using configured URL: ${server.NGROK_URL}/api/webhook/inbound`);
    return;
  }
  if (!server.hasAuthtoken()) {
    console.log('[ngrok] No auth token — add one in Settings (or NGROK_AUTHTOKEN env) to enable inbound tunneling');
    return;
  }
  console.log('[ngrok] Auto-starting this device\'s own tunnel…');
  try {
    const tunnel = await server.startNgrok(PORT);
    ngrokUrl = tunnel.url;
    console.log(`[ngrok] Public URL: ${tunnel.url}`);
    addShutdownHook(server.stopNgrok);
  } catch (err) {
    console.error('[ngrok] Auto-start failed:', err.message);
    console.log('[ngrok] Will keep retrying in background — no internet yet');
    server.startNgrokAutoRetry(PORT);
  }
}

// ── Main window ─────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SRMC Platform',
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  const serverUrl = `http://localhost:${PORT}`;
  mainWindow.loadURL(serverUrl);
  console.log(`[electron] Loading client from ${serverUrl}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // Minimize to tray instead of closing.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function resolveIcon() {
  const ico = path.join(ROOT, 'electron', 'icon.ico');
  const png = path.join(ROOT, 'electron', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

// ── System tray ──────────────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(createTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open SRMC Platform', click: showWindow },
    { type: 'separator' },
    {
      label: `v${app.getVersion()} — Check for updates`,
      click: () => { autoUpdater.checkForUpdatesAndNotify(); },
    },
    { type: 'separator' },
    { label: `Port: ${PORT}`, enabled: false },
    { label: ngrokUrl ? `Public: ${ngrokUrl}` : 'Public: tunnel off', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; shutdown(); } },
  ]);

  tray.setToolTip('SRMC Platform — SMS Gateway Server');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', showWindow);
}

function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
}

function createTrayIcon() {
  // Prefer a real icon file; fall back to a generated blue dot.
  const iconPath = resolveIcon();
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  }
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      if (Math.sqrt(dx * dx + dy * dy) < size / 2 - 1) {
        canvas[idx] = 0x1A; canvas[idx + 1] = 0x73; canvas[idx + 2] = 0xC8; canvas[idx + 3] = 0xFF;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

// ── IPC handlers (match electron/preload.cjs) ──────────────────────────────

function registerIpc() {
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow && mainWindow.hide());

  ipcMain.on('notification:show', (_e, { title, body } = {}) => {
    if (Notification.isSupported()) {
      new Notification({ title: title || 'SRMC Platform', body: body || '' }).show();
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());
}

// ── Shutdown ──────────────────────────────────────────────────────────────

async function shutdown() {
  console.log('[electron] Shutting down…');
  try { server.stopStatsReporter && server.stopStatsReporter(); } catch (_) {}

  for (const hook of shutdownHooks) {
    try { await hook(); } catch (e) { console.warn('[electron] Shutdown hook error:', e); }
  }
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (logStream) { try { logStream.end(); } catch (_) {} }
  app.quit();
}

// ── App lifecycle ───────────────────────────────────────────────────────────

// ── Auto-updater config ─────────────────────────────────────────────────────

function initAutoUpdater() {
  // Allow overriding the update feed URL via env var (set at build time or in .env)
  if (process.env.UPDATE_FEED_URL) {
    autoUpdater.setFeedURL(process.env.UPDATE_FEED_URL);
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version (v${info.version}) is available.`,
      detail: 'Download and install now? The app will restart after installation.',
      buttons: ['Download & Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No updates available.');
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Download ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] Update downloaded — will install on quit');
  });

  // Check for updates silently on startup (no notification if none found)
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 10000);
}

function bootstrap() {
  app.whenReady().then(async () => {
    initLogging();
    registerIpc();
    try {
      await startServer();
      createTray();
      createWindow();
      initAutoUpdater();
    } catch (err) {
      console.error('[electron] Startup failed:', err);
      dialog.showErrorBox(
        'SRMC Platform — Startup Error',
        `Failed to start the server:\n\n${err.message}\n\nPlease check the logs in:\n${path.join(app.getPath('userData'), 'logs')}`
      );
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
  });

  app.on('before-quit', () => { app.isQuitting = true; });
}

// On non-macOS, keep running in the tray when all windows are closed.
app.on('window-all-closed', () => { /* stay alive in tray */ });

// ── Exports for preload / renderer ──────────────────────────────────────────

export function getServerPort() { return PORT; }
export function getServerUrl()  { return `http://localhost:${PORT}`; }
export function addShutdownHook(hook) { shutdownHooks.push(hook); }
