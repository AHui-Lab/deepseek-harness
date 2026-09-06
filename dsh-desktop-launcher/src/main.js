const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const https = require('https');

// ─── Simple Logger (no external deps) ────────────────────────────────────

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const LOG_FILE = path.join(LOG_DIR, 'dsh-desktop.log');

function writeLog(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console[level === 'error' ? 'error' : 'log'](line.trim());
}
const log = {
  info: (...a) => writeLog('info', ...a),
  warn: (...a) => writeLog('warn', ...a),
  error: (...a) => writeLog('error', ...a),
};

// ─── Config ──────────────────────────────────────────────────────────────

const APP_VERSION = '1.0.0';
const DSH_PACKAGE = '@deepseek-ai/dsh';
const DEFAULT_PORT = 3080;
const SERVER_TIMEOUT = 45000;

const UPSTREAM_OWNER = 'deepseek-ai';
const UPSTREAM_REPO = 'deepseek-harness';

// Global state
let mainWindow = null;
let tray = null;
let dshProcess = null;
let serverReady = false;
let serverUrl = `http://127.0.0.1:${DEFAULT_PORT}`;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── Paths ───────────────────────────────────────────────────────────────

function getAssetPath(name) {
  if (isDev) return path.join(__dirname, '..', 'assets', name);
  return path.join(process.resourcesPath, 'assets', name);
}

// ─── Window ──────────────────────────────────────────────────────────────

function createWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'DeepSeek Harness Desktop',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
    icon: getAssetPath('icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => {});

  mainWindow.once('ready-to-show', () => { if (serverReady) mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') { event.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) mainWindow.webContents.openDevTools();
}

// ─── Tray ─────────────────────────────────────────────────────────────────

function createTray() {
  let trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('DeepSeek Harness');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open DeepSeek Harness',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else { createWindow(); }
      },
    },
    { type: 'separator' },
    { label: `Launcher v${APP_VERSION}`, enabled: false },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => performUpdateCheck(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); }
    else { createWindow(); }
  });
}

// ─── DSH Server ───────────────────────────────────────────────────────────

function findNodeExecutable() {
  const candidates = [
    process.execPath,
    'node',
    'node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
    path.join(process.env.ProgramFiles || '', 'Kimi', 'resources', 'resources', 'runtime', 'node.exe'),
    '/usr/bin/node',
    '/usr/local/bin/node',
  ];

  for (const cmd of candidates) {
    try {
      if (cmd === 'node' || cmd === 'node.exe') {
        const result = require('child_process').execSync(`${cmd} --version`, { encoding: 'utf8', timeout: 3000 });
        if (result.startsWith('v')) return cmd;
      } else if (fs.existsSync(cmd)) {
        return cmd;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function findNpx() {
  const nodePath = findNodeExecutable();
  if (!nodePath) return null;

  const nodeDir = path.dirname(nodePath);
  const npxPath = path.join(nodeDir, 'npx.cmd');
  const npxPath2 = path.join(nodeDir, 'npx');

  if (fs.existsSync(npxPath)) return npxPath;
  if (fs.existsSync(npxPath2)) return npxPath2;

  try {
    require('child_process').execSync('npx --version', { encoding: 'utf8', timeout: 3000 });
    return 'npx';
  } catch { return null; }
}

async function checkDshInstalled() {
  return new Promise((resolve) => {
    const nodePath = findNodeExecutable();
    if (!nodePath) { resolve(false); return; }
    const check = spawn(nodePath, ['-e', `require.resolve('${DSH_PACKAGE}/package.json')`], { shell: true, stdio: 'pipe' });
    check.on('exit', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });
}

function startDshServer() {
  return new Promise(async (resolve, reject) => {
    if (dshProcess) { resolve(); return; }

    const npxPath = findNpx();
    if (!npxPath) {
      reject(new Error('Node.js / npx not found. Please install Node.js from https://nodejs.org/'));
      return;
    }

    const dshInstalled = await checkDshInstalled();
    let cmd, args, cwd;

    if (dshInstalled) {
      log.info('DSH is installed locally, using npx');
      cmd = npxPath;
      args = ['dsh', 'web', '--no-open'];
      cwd = os.homedir();
    } else {
      log.info('DSH not installed, will use npx to run it');
      cmd = npxPath;
      args = ['-y', DSH_PACKAGE, 'web', '--no-open'];
      cwd = os.homedir();
    }

    log.info(`Starting DSH: ${cmd} ${args.join(' ')}`);

    dshProcess = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log.warn('DSH startup timeout - proceeding anyway');
        serverReady = true;
        resolve();
      }
    }, SERVER_TIMEOUT);

    dshProcess.stdout.on('data', (data) => {
      const text = data.toString();
      log.info('[dsh]', text.trim());

      if (text.includes('http://127.0.0.1:') || text.includes('listening on')) {
        const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) serverUrl = `http://127.0.0.1:${match[1]}`;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          serverReady = true;
          log.info(`DSH ready at ${serverUrl}`);
          resolve();
        }
      }
    });

    dshProcess.stderr.on('data', (data) => {
      log.warn('[dsh stderr]', data.toString().trim());
    });

    dshProcess.on('error', (err) => {
      log.error('DSH process error:', err);
      if (!resolved) { resolved = true; clearTimeout(timeout); resolve(); }
    });

    dshProcess.on('exit', (code) => {
      log.info(`DSH exited with code ${code}`);
      dshProcess = null;
      serverReady = false;
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log.info('Proceeding with fallback (server may already be running)');
        serverReady = true;
        resolve();
      }
    }, 12000);
  });
}

function stopDshServer() {
  return new Promise((resolve) => {
    if (!dshProcess) { resolve(); return; }
    log.info('Stopping DSH server...');

    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', dshProcess.pid, '/T', '/F']); } catch {}
    } else {
      dshProcess.kill('SIGTERM');
    }

    const timeout = setTimeout(() => {
      if (dshProcess) dshProcess.kill('SIGKILL');
      resolve();
    }, 5000);

    dshProcess.on('exit', () => { clearTimeout(timeout); dshProcess = null; resolve(); });
  });
}

// ─── Update Checker ───────────────────────────────────────────────────────

function compareVersions(v1, v2) {
  const a = v1.replace(/^v/, '').split('.').map(Number);
  const b = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'DeepSeek-Harness-Desktop/1.0',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function checkUpstreamUpdates() {
  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`
    );
    const latestVersion = (release.tag_name || '').replace(/^v/, '');
    const dshVersion = await getDshVersion();

    return {
      hasUpdate: latestVersion && compareVersions(latestVersion, dshVersion || '0.0.0') > 0,
      currentVersion: dshVersion,
      latestVersion,
      latestTag: release.tag_name,
      releaseUrl: release.html_url,
      releaseNotes: release.body || '',
      publishedAt: release.published_at || '',
    };
  } catch (err) {
    return { hasUpdate: false, error: err.message };
  }
}

async function getDshVersion() {
  return new Promise((resolve) => {
    const nodePath = findNodeExecutable();
    if (!nodePath) { resolve(null); return; }

    const child = spawn(nodePath, ['-e', `
      try { const pkg = require.resolve('@deepseek-ai/dsh/package.json'); console.log(require(pkg).version); }
      catch { console.log(''); }
    `], { shell: true, stdio: 'pipe' });

    let out = '';
    child.stdout.on('data', (d) => out += d.toString());
    child.on('exit', () => resolve(out.trim() || null));
    child.on('error', () => resolve(null));
  });
}

async function performUpdateCheck(manual = false) {
  try {
    const info = await checkUpstreamUpdates();

    if (info.hasUpdate) {
      log.info(`Update available: ${info.latestVersion}`);
      if (mainWindow) mainWindow.webContents.send('update-available', info);

      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        title: 'DeepSeek Harness Update Available',
        message: `Version ${info.latestVersion} is available!`,
        detail: `You are running ${info.currentVersion || 'unknown'}.\n\n${info.releaseNotes.substring(0, 500)}...`,
        buttons: ['View Release', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (result.response === 0) shell.openExternal(info.releaseUrl);
    } else if (manual) {
      await dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
        detail: `Current: ${info.currentVersion || 'unknown'}`,
      });
    }
    return info;
  } catch (err) {
    log.error('Update check failed:', err);
    return { hasUpdate: false, error: err.message };
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => APP_VERSION);
ipcMain.handle('get-dsh-version', getDshVersion);
ipcMain.handle('check-for-updates', () => performUpdateCheck(true));
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('get-server-url', () => serverUrl);
ipcMain.handle('is-server-ready', () => serverReady);
ipcMain.on('quit-app', quitApp);

// ─── App Lifecycle ────────────────────────────────────────────────────────

function quitApp() {
  log.info('Quitting...');
  if (tray) { tray.destroy(); tray = null; }
  stopDshServer().then(() => app.quit());
}

app.whenReady().then(async () => {
  log.info(`DSH Desktop Launcher v${APP_VERSION} starting...`);

  createWindow();
  createTray();

  const nodePath = findNodeExecutable();
  if (!nodePath) {
    log.error('Node.js not found');
    if (mainWindow) {
      mainWindow.webContents.send('server-error',
        'Node.js not found. Please install Node.js 22+ from https://nodejs.org/'
      );
    }
    return;
  }
  log.info(`Found Node.js at: ${nodePath}`);

  try {
    await startDshServer();

    if (mainWindow) {
      setTimeout(() => {
        mainWindow.loadURL(serverUrl).then(() => {
          log.info(`Loaded Web UI from ${serverUrl}`);
        }).catch((err) => {
          log.error('Failed to load Web UI:', err);
          mainWindow.webContents.send('server-error', err.message);
        });
      }, 2000);
    }
  } catch (err) {
    log.error('Failed to start DSH:', err);
    if (mainWindow) mainWindow.webContents.send('server-error', err.message);
  }

  setTimeout(() => performUpdateCheck(), 15000);
  setInterval(() => performUpdateCheck(), 24 * 60 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') quitApp(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (mainWindow) mainWindow.show();
});
app.on('before-quit', async () => { await stopDshServer(); });
