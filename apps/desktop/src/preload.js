const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - securely exposes a limited API to the renderer process.
 * This prevents direct access to Node.js APIs from the web content.
 */

contextBridge.exposeInMainWorld('dshDesktop', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  isServerReady: () => ipcRenderer.invoke('is-server-ready'),

  // Updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // App control
  quit: () => ipcRenderer.send('quit-app'),

  // Event listeners
  onUpdateAvailable: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('update-available', wrapped);
    return () => ipcRenderer.removeListener('update-available', wrapped);
  },

  onUpdateCheckResult: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('update-check-result', wrapped);
    return () => ipcRenderer.removeListener('update-check-result', wrapped);
  },

  onServerError: (callback) => {
    const wrapped = (_event, message) => callback(message);
    ipcRenderer.on('server-error', wrapped);
    return () => ipcRenderer.removeListener('server-error', wrapped);
  },
});
