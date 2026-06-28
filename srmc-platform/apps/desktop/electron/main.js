/**
 * electron/main.js — SRMC Platform Desktop App (thin client).
 *
 * Thin client that connects to a remote SRMC web server instead of
 * running one locally. User enters the server URL on first launch.
 * Settings are saved in app.getPath('userData').
 *
 * Production notes:
 *   - A single-instance lock prevents a second launch.
 *   - On first launch (no settings file), the settings dialog opens.
 *   - If the server is unreachable, an error screen is shown with a
 *     "Settings" button so the user can change the URL.
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog, shell } from 'electron';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

let mainWindow = null;
let tray = null;
let logStream = null;
let connected = false;
let ngrokUrl = null;

// ── Settings ───────────────────────────────────────────────────────────────

const SETTINGS_FILE = 'settings.json';
let settings = { serverUrl: 'http://localhost:3001' };

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    settings = { ...settings, ...JSON.parse(raw) };
  } catch (_) {
    // File doesn't exist yet — use defaults
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[electron] Failed to save settings:', e.message);
  }
}

function getServerUrl() {
  let url = settings.serverUrl || 'http://localhost:8081';
  return url.replace(/\/+$/, ''); // Remove trailing slash
}

// ── Ngrok detection ───────────────────────────────────────────────────────

async function checkNgrok() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) { ngrokUrl = null; return; }
    const data = await res.json();
    const tunnel = data.tunnels?.find(t => t.public_url?.startsWith('https'));
    ngrokUrl = tunnel?.public_url || null;
    if (ngrokUrl) console.log(`[electron] ngrok tunnel: ${ngrokUrl}`);
  } catch (_) {
    if (ngrokUrl) console.log('[electron] ngrok tunnel lost');
    ngrokUrl = null;
  }
}

// ── Connection check ──────────────────────────────────────────────────────

async function checkConnection(url) {
  checkNgrok();

  const checkUrl = `${(url || getServerUrl()).replace(/\/+$/, '')}/api/ping`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(checkUrl, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// ── Single-instance lock ──────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  bootstrap();
}

// ── Logging ────────────────────────────────────────────────────────────────

function initLogging() {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, 'main.log'), { flags: 'a' });

    const wrap = (orig, level) => (...args) => {
      const line = `[${new Date().toISOString()}] [${level}] ` +
        args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
      try { logStream.write(line); } catch (_) { }
      orig(...args);
    };
    console.log = wrap(console.log.bind(console), 'info');
    console.warn = wrap(console.warn.bind(console), 'warn');
    console.error = wrap(console.error.bind(console), 'error');
  } catch (e) {
    // Best-effort
  }
}

// ── Settings window (inline HTML) ─────────────────────────────────────────

function createSettingsWindow(parentWin) {
  const win = new BrowserWindow({
    width: 520,
    height: 380,
    resizable: false,
    title: 'SRMC Platform — Server Settings',
    parent: parentWin || null,
    modal: !!parentWin,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; padding: 28px; background: #1a1a2e; color: #e0e0e0; }
h2 { margin: 0 0 6px; color: #fff; font-size: 20px; }
p.desc { color: #9090a0; font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
label { display: block; margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #b0b0c0; }
input { width: 100%; padding: 10px 12px; border: 1px solid #333a50; border-radius: 6px; background: #16213e; color: #e0e0e0; font-size: 14px; }
input:focus { outline: none; border-color: #1a73c8; box-shadow: 0 0 0 2px rgba(26,115,200,0.2); }
.hint { font-size: 12px; color: #707080; margin: 6px 0 18px; line-height: 1.4; }
.buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
button { padding: 9px 22px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; transition: background .15s; }
.btn-primary { background: #1a73c8; color: #fff; }
.btn-primary:hover { background: #1557a0; }
.btn-secondary { background: #2a2a40; color: #c0c0d0; }
.btn-secondary:hover { background: #3a3a50; }
#status { margin-top: 14px; padding: 8px 12px; border-radius: 6px; font-size: 13px; display: none; }
#status.error { display: block; background: #3d1f1f; color: #ff6b6b; border: 1px solid #5a2d2d; }
#status.success { display: block; background: #1a3d1a; color: #6bff6b; border: 1px solid #2d5a2d; }
#status.checking { display: block; background: #1a2d3d; color: #6bb5ff; border: 1px solid #2d4d5a; }
</style></head><body>
<h2>⚙️ Server Settings</h2>
<p class="desc">Configure which SRMC web server this desktop app connects to. The server must be running and reachable.</p>
<label for="url">Server URL</label>
<input type="text" id="url" placeholder="http://localhost:3001" />
<div class="hint">Examples: <code>http://192.168.1.20:3001</code> (local network) or <code>https://abc123.ngrok.io</code> (remote via ngrok)</div>
<div id="status"></div>
<div class="buttons">
  <button class="btn-secondary" id="btnCancel">Cancel</button>
  <button class="btn-primary" id="btnSave">Save &amp; Connect</button>
</div>
<script>
let currentUrl = '';
window.electronAPI.getServerUrl().then(url => { currentUrl = url; document.getElementById('url').value = url; });

document.getElementById('btnSave').onclick = async () => {
  const url = document.getElementById('url').value.trim();
  if (!url) { showStatus('Please enter a server URL.', 'error'); return; }
  showStatus('Checking connection…', 'checking');
  const result = await window.electronAPI.checkConnection(url);
  if (result.ok) {
    await window.electronAPI.saveServerUrl(url);
    showStatus('✅ Connected successfully!', 'success');
    setTimeout(() => window.close(), 600);
  } else {
    showStatus('❌ Cannot reach server at this URL. Make sure the server is running and the URL is correct.', 'error');
  }
};
document.getElementById('btnCancel').onclick = () => window.close();
function showStatus(msg, cls) {
  const el = document.getElementById('status'); el.textContent = msg; el.className = 'status ' + (cls || '');
}
</script></body></html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}

// ── Main window ─────────────────────────────────────────────────────────────

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SRMC Platform',
    icon: resolveIcon(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Maximize on first launch for a full-screen feel
  mainWindow.maximize();

  const loadUrl = url || getServerUrl();
  mainWindow.loadURL(loadUrl);
  console.log(`[electron] Loading dashboard from ${loadUrl}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Run a periodic health check
    startHealthCheck();
  });

  // Open external links in the user's browser
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http')) { shell.openExternal(linkUrl); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Health check timer ─────────────────────────────────────────────────────

let healthInterval = null;

function startHealthCheck() {
  if (healthInterval) clearInterval(healthInterval);
  healthInterval = setInterval(async () => {
    const lastConnected = connected;
    const lastNgrok = ngrokUrl;
    const result = await checkConnection();
    connected = result.ok;
    if (connected !== lastConnected || ngrokUrl !== lastNgrok) {
      updateTray();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-status', { connected, ngrokUrl });
      }
    }
  }, 15000);
}

function stopHealthCheck() {
  if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
}

// ── Error screen ────────────────────────────────────────────────────────────

function showErrorScreen(errMsg, canRetry) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 640,
      height: 520,
      resizable: true,
      title: 'SRMC Platform — Cannot Connect',
      icon: resolveIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      show: false,
    });
  }

  const title = '🔌 Cannot Connect';
  const message = errMsg
    ? `Could not reach the SRMC web server.\n\n${errMsg}`
    : `Could not reach the SRMC web server at:\n${getServerUrl()}\n\nMake sure the server is running and the URL is correct.`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; padding: 40px; background: #1a1a2e; color: #e0e0e0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; }
.icon { font-size: 48px; margin-bottom: 16px; }
h2 { font-size: 20px; color: #fff; margin-bottom: 12px; }
p { color: #a0a0b0; font-size: 14px; line-height: 1.6; max-width: 440px; margin-bottom: 8px; }
.url { color: #6bb5ff; font-family: monospace; font-size: 13px; background: #16213e; padding: 6px 12px; border-radius: 4px; display: inline-block; margin-bottom: 20px; }
.buttons { display: flex; gap: 10px; }
button { padding: 10px 24px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; transition: background .15s; }
.btn-primary { background: #1a73c8; color: #fff; }
.btn-primary:hover { background: #1557a0; }
.btn-secondary { background: #2a2a40; color: #c0c0d0; }
.btn-secondary:hover { background: #3a3a50; }
.retry { background: #2d5a2d; color: #6bff9b; margin-top: 16px; }
.retry:hover { background: #3a6a3a; }
</style></head><body>
<div class="icon">🔌</div>
<h2>${title}</h2>
<p>${message.replace(/\n/g, '<br>')}</p>
<div class="url">${getServerUrl()}</div>
<div class="buttons">
  ${canRetry ? '<button class="retry" id="btnRetry">🔄 Retry Connection</button>' : ''}
  <button class="btn-primary" onclick="window.electronAPI.openSettings()">⚙️ Settings</button>
  <button class="btn-secondary" onclick="window.electronAPI.quitApp()">Quit</button>
</div>
<script>
document.getElementById('btnRetry')?.addEventListener('click', async () => {
  const btn = document.getElementById('btnRetry');
  btn.disabled = true; btn.textContent = 'Connecting…';
  const result = await window.electronAPI.retryConnection();
  if (result.connected) { window.location.href = result.url; }
  else { btn.disabled = false; btn.textContent = '🔄 Retry Connection'; }
});
</script></body></html>`;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(createTrayIcon());

  updateTray();

  tray.on('double-click', showWindow);
}

function updateTray() {
  if (!tray) return;

  tray.setToolTip(connected
    ? `SRMC Platform — Connected to ${getServerUrl()}`
    : 'SRMC Platform — Disconnected');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open SRMC Platform', click: showWindow },
    { type: 'separator' },
    {
      label: connected ? '✅ Connected' : '❌ Disconnected',
      enabled: false,
    },
    { label: `Server: ${getServerUrl()}`, enabled: false },
    {
      label: ngrokUrl ? `🌐 ngrok: ${ngrokUrl}` : '🌐 ngrok: not running',
      enabled: !!ngrokUrl,
      click: ngrokUrl ? () => shell.openExternal(ngrokUrl) : undefined,
    },
    { type: 'separator' },
    {
      label: '⚙️ Settings',
      click: () => { createSettingsWindow(mainWindow); },
    },
    {
      label: `v${app.getVersion()} — Check for updates`,
      click: () => { autoUpdater.checkForUpdatesAndNotify(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; shutdown(); } },
  ]);

  tray.setContextMenu(contextMenu);
}

function showWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Check if it's the error screen — reload if connected
    mainWindow.show();
    mainWindow.focus();
  } else {
    startApp();
  }
}

function resolveIcon() {
  const ico = path.join(ROOT, 'apps', 'desktop', 'electron', 'icon.ico');
  const png = path.join(ROOT, 'apps', 'desktop', 'electron', 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return undefined;
}

function createTrayIcon() {
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

// ── IPC handlers ────────────────────────────────────────────────────────────

function registerIpc() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow && mainWindow.hide());

  // Notifications
  ipcMain.on('notification:show', (_e, { title, body } = {}) => {
    if (Notification.isSupported()) {
      new Notification({ title: title || 'SRMC Platform', body: body || '' }).show();
    }
  });

  // App version
  ipcMain.handle('app:version', () => app.getVersion());

  // Settings
  ipcMain.handle('settings:getServerUrl', () => getServerUrl());
  ipcMain.handle('settings:saveServerUrl', (_e, url) => {
    settings.serverUrl = url;
    saveSettings();
    console.log(`[electron] Server URL saved: ${url}`);
  });

  // Connection check
  ipcMain.handle('app:checkConnection', async (_e, url) => {
    return await checkConnection(url);
  });

  // Ngrok status
  ipcMain.handle('app:getNgrokUrl', () => ngrokUrl);

  // Open settings window
  ipcMain.on('app:openSettings', () => {
    createSettingsWindow(mainWindow);
  });

  // Retry connection
  ipcMain.handle('app:retryConnection', async () => {
    const result = await checkConnection();
    connected = result.ok;
    updateTray();
    return { connected, url: getServerUrl() };
  });

  // Quit
  ipcMain.handle('app:quit', () => { app.isQuitting = true; shutdown(); });
}

// ── Auto-updater ────────────────────────────────────────────────────────────

function initAutoUpdater() {
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
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-not-available', () => console.log('[updater] No updates available.'));
  autoUpdater.on('error', (err) => console.error('[updater] Error:', err.message));
  autoUpdater.on('download-progress', (p) => console.log(`[updater] Download ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded', () => console.log('[updater] Update downloaded'));

  setTimeout(() => autoUpdater.checkForUpdates(), 10000);
}

// ── Shutdown ──────────────────────────────────────────────────────────────

async function shutdown() {
  console.log('[electron] Shutting down…');
  stopHealthCheck();
  if (logStream) { try { logStream.end(); } catch (_) { } }
  app.quit();
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function startApp() {
  loadSettings();
  console.log(`[electron] Configured server URL: ${getServerUrl()}`);

  // Check connection
  const result = await checkConnection();
  connected = result.ok;

  if (connected) {
    console.log('[electron] Server reachable — loading dashboard');
    createWindow();
    createTray();
  } else {
    console.log('[electron] Server unreachable — showing error screen');
    createTray();
    showErrorScreen(
      connected === false && result.status === 0
        ? 'Connection refused or timed out.'
        : `Server returned status ${result.status}.`,
      true
    );
  }
}

function bootstrap() {
  app.whenReady().then(async () => {
    initLogging();
    registerIpc();
    initAutoUpdater();
    await startApp();
  });

  app.on('activate', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) startApp();
    else mainWindow.show();
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('window-all-closed', () => { /* stay alive in tray */ });
}

// ── Exports ────────────────────────────────────────────────────────────────

export function getServerUrlExport() { return getServerUrl(); }
