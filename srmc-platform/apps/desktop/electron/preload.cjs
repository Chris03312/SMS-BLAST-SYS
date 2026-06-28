/**
 * electron/preload.js — Exposes safe APIs from the main process to the React renderer.
 *
 * Uses contextBridge to expose only specific methods, maintaining context isolation.
 * NOTE: Must use CommonJS (require) — Electron sandbox does not support ES imports.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App info ────────────────────────────────────────────────────────
  getServerUrl: () => ipcRenderer.invoke('settings:getServerUrl'),
  saveServerUrl: (url) => ipcRenderer.invoke('settings:saveServerUrl', url),

  // ── Window controls ────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),

  // ── Server connection ──────────────────────────────────────────────
  checkConnection: (url) => ipcRenderer.invoke('app:checkConnection', url),
  openSettings:    () => ipcRenderer.send('app:openSettings'),
  retryConnection: () => ipcRenderer.invoke('app:retryConnection'),

  // ── Ngrok ──────────────────────────────────────────────────────────
  getNgrokUrl: () => ipcRenderer.invoke('app:getNgrokUrl'),

  // ── Connection status (pushed from main) ───────────────────────────
  onConnectionStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('connection-status', handler);
    return () => { try { ipcRenderer.removeListener('connection-status', handler); } catch (_) {} };
  },
  // ── Notifications ──────────────────────────────────────────────────
  showNotification: (title, body) => {
    ipcRenderer.send('notification:show', { title, body });
  },

  // ── App version ────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ── App control ────────────────────────────────────────────────────
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // ── Is this running as Electron? ───────────────────────────────────
  isElectron: true,
});
