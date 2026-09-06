const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getDshVersion: () => ipcRenderer.invoke('get-dsh-version'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  isServerReady: () => ipcRenderer.invoke('is-server-ready'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quit: () => ipcRenderer.send('quit-app'),

  onUpdateAvailable: (cb) => {
    const w = (_e, d) => cb(d);
    ipcRenderer.on('update-available', w);
    return () => ipcRenderer.removeListener('update-available', w);
  },
  onUpdateCheckResult: (cb) => {
    const w = (_e, d) => cb(d);
    ipcRenderer.on('update-check-result', w);
    return () => ipcRenderer.removeListener('update-check-result', w);
  },
  onServerError: (cb) => {
    const w = (_e, m) => cb(m);
    ipcRenderer.on('server-error', w);
    return () => ipcRenderer.removeListener('server-error', w);
  },
});
