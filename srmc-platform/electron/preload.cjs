/**
 * electron/preload.js — Exposes safe APIs from the main process to the React renderer.
 *
 * Uses contextBridge to expose only specific methods, maintaining context isolation.
 * NOTE: Must use CommonJS (require) — Electron sandbox does not support ES imports.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App info ────────────────────────────────────────────────────────
  getServerUrl: () => `http://localhost:${process.env.SRMC_PORT || 3001}`,

  // ── Window controls ────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),

  // ── Server status ──────────────────────────────────────────────────
  onServerStatus: (callback) => {
    ipcRenderer.on('server-status', (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('server-status');
  },

  // ── Notifications ──────────────────────────────────────────────────
  showNotification: (title, body) => {
    ipcRenderer.send('notification:show', { title, body });
  },

  // ── App version ────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ── Is this running as Electron? ───────────────────────────────────
  isElectron: true,
});
