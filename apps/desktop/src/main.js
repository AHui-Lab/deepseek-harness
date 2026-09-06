const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log');

const { checkForUpdates, getCurrentVersion } = require('./updater');

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Global state
let mainWindow = null;
let tray = null;
let dshProcess = null;
let serverReady = false;
let serverUrl = 'http://127.0.0.1:3080';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const APP_VERSION = getCurrentVersion();

// ─── Paths ───────────────────────────────────────────────────────────────

function getProjectRoot() {
  if (isDev) {
    // In dev, project root is 2 levels above apps/desktop
    return path.resolve(__dirname, '..', '..');
  }
  // In production, we bundle the built artifacts; assume dsh is in PATH
  // or bundled alongside the app
  return path.resolve(process.resourcesPath, '..');
}

function getDshCommand() {
  if (isDev) {
    const root = getProjectRoot();
    // Try pnpm dsh first
    return { cmd: 'pnpm', args: ['dsh', 'web', '--no-open'], cwd: root };
  }
  // Production: use bundled dsh or npx
  return { cmd: 'npx', args: ['@deepseek-ai/dsh', 'web', '--no-open'], cwd: os.homedir() };
}

// ─── Window Management ───────────────────────────────────────────────────

function createWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: `DeepSeek Harness v${APP_VERSION}`,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    show: false, // Show after server is ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  // Load splash / loading screen first
  mainWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => {
    // If splash.html doesn't exist, show a blank window
  });

  mainWindow.once('ready-to-show', () => {
    if (serverReady) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Dev tools in dev mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } else {
    // Fallback: create a simple 16x16 empty icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('DeepSeek Harness');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open DeepSeek Harness',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: `Version: ${APP_VERSION}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: async () => {
        const updateInfo = await checkForUpdates();
        if (mainWindow) {
          mainWindow.webContents.send('update-check-result', updateInfo);
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitApp();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow();
    }
  });
}

// ─── DSH Server ───────────────────────────────────────────────────────────

function startDshServer() {
  return new Promise((resolve, reject) => {
    if (dshProcess) {
      resolve();
      return;
    }

    const { cmd, args, cwd } = getDshCommand();
    log.info(`Starting DSH server: ${cmd} ${args.join(' ')} in ${cwd}`);

    dshProcess = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        log.warn('DSH server startup timeout - proceeding anyway');
        resolve();
      }
    }, 30000); // 30s timeout

    dshProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdoutBuffer += text;
      log.info('[dsh stdout]', text.trim());

      // Detect when server is ready
      if (text.includes('http://127.0.0.1:') || text.includes('listening on')) {
        const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          serverUrl = `http://127.0.0.1:${match[1]}`;
        }
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          serverReady = true;
          log.info(`DSH server ready at ${serverUrl}`);
          resolve();
        }
      }
    });

    dshProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrBuffer += text;
      log.warn('[dsh stderr]', text.trim());
    });

    dshProcess.on('error', (err) => {
      log.error('DSH process error:', err);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Don't reject - the server might already be running externally
        resolve();
      }
    });

    dshProcess.on('exit', (code) => {
      log.info(`DSH process exited with code ${code}`);
      dshProcess = null;
      serverReady = false;
    });

    // Fallback: if server is already running, we'll connect to it
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log.info('Assuming DSH server is ready (fallback)');
        serverReady = true;
        resolve();
      }
    }, 10000);
  });
}

function stopDshServer() {
  return new Promise((resolve) => {
    if (!dshProcess) {
      resolve();
      return;
    }

    log.info('Stopping DSH server...');

    // Try graceful shutdown first
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', dshProcess.pid, '/T', '/F']);
    } else {
      dshProcess.kill('SIGTERM');
    }

    const timeout = setTimeout(() => {
      if (dshProcess) {
        dshProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    dshProcess.on('exit', () => {
      clearTimeout(timeout);
      dshProcess = null;
      resolve();
    });
  });
}

// ─── Update Check ─────────────────────────────────────────────────────────

async function performUpdateCheck() {
  try {
    log.info('Checking for updates...');
    const updateInfo = await checkForUpdates();

    if (updateInfo.hasUpdate) {
      log.info(`Update available: ${updateInfo.latestVersion}`);

      if (mainWindow) {
        mainWindow.webContents.send('update-available', updateInfo);
      }

      // Also show a native notification via dialog
      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'info',
        title: 'Update Available',
        message: `DeepSeek Harness ${updateInfo.latestVersion} is available!`,
        detail: `You are currently running ${APP_VERSION}.\n\n${updateInfo.releaseNotes || ''}`,
        buttons: ['View Release', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (result.response === 0) {
        shell.openExternal(updateInfo.releaseUrl);
      }
    } else {
      log.info('No updates available');
    }

    return updateInfo;
  } catch (err) {
    log.error('Update check failed:', err);
    return { hasUpdate: false, error: err.message };
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────

function quitApp() {
  log.info('Quitting app...');

  if (tray) {
    tray.destroy();
    tray = null;
  }

  stopDshServer().then(() => {
    app.quit();
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => APP_VERSION);

ipcMain.handle('check-for-updates', performUpdateCheck);

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-server-url', () => serverUrl);

ipcMain.handle('is-server-ready', () => serverReady);

ipcMain.on('quit-app', quitApp);

// ─── App Events ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  log.info(`DeepSeek Harness Desktop v${APP_VERSION} starting...`);

  createWindow();
  createTray();

  // Start the DSH server in the background
  try {
    await startDshServer();

    // Load the Web UI once server is ready
    if (mainWindow) {
      // Small delay to ensure server is fully ready
      setTimeout(() => {
        mainWindow.loadURL(serverUrl).then(() => {
          log.info(`Loaded Web UI from ${serverUrl}`);
        }).catch((err) => {
          log.error('Failed to load Web UI:', err);
          // Stay on splash screen with error
          mainWindow.webContents.send('server-error', err.message);
        });
      }, 2000);
    }
  } catch (err) {
    log.error('Failed to start DSH server:', err);
    if (mainWindow) {
      mainWindow.webContents.send('server-error', err.message);
    }
  }

  // Check for updates on startup (after a delay)
  setTimeout(() => {
    performUpdateCheck();
  }, 15000); // 15s after startup

  // Periodic update check every 24 hours
  setInterval(() => {
    performUpdateCheck();
  }, 24 * 60 * 60 * 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitApp();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  await stopDshServer();
});

// Security: prevent new window creation
app.on('web-contents-created', (_event, contents) => {
  contents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });
});
