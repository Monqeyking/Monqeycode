const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');

let dshProcess;
let mainWindow;
let startupBuffer = '';
let startupTimer;
let harnessShown = false;
let shuttingDown = false;
let tray;
let closePromptOpen = false;
let quitConfirmationOpen = false;
let activeWork;
let closeNoticeAcknowledged = false;
let closeNoticePath;

function taskbarBadge(count) {
  const value = Number.isFinite(count) ? Math.max(0, Math.min(99, Math.trunc(count))) : 0;
  if (value === 0) return null;
  const label = value > 9 ? '9+' : String(value);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7.5" fill="#202124" stroke="#ffffff" stroke-width="1"/>
    <text x="8" y="11.2" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#ffffff">${label}</text>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).resize({ width: 16, height: 16 });
}

function setTaskbarBadge(count) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'win32') return;
  const icon = taskbarBadge(count);
  mainWindow.setOverlayIcon(icon, icon ? `${count} Monqey Code notification${count === 1 ? '' : 's'}` : 'No Monqey Code notifications');
}

ipcMain.on('monqey-code:taskbar-badge', (event, count) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  setTaskbarBadge(count);
});

ipcMain.on('monqey-code:active-work', (event, value) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  if (typeof value === 'boolean') activeWork = value;
});

// One DSH host must own the profile at a time. Without this guard, opening a
// second wrapper can start another host that tries to resume the same session.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// Some Windows setups cannot load Electron's GPU subprocess dependencies.
// The DSH web UI does not need hardware acceleration, so keep startup reliable.
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.disableHardwareAcceleration();

try {
  const electronData = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'electron-data');
  mkdirSync(electronData, { recursive: true });
  app.setPath('userData', electronData);
  app.setPath('cache', path.join(electronData, 'cache'));
  closeNoticePath = path.join(electronData, 'background-close-confirmed');
  closeNoticeAcknowledged = existsSync(closeNoticePath);
} catch {}

function writeFailureLog(message) {
  try {
    const home = process.env.USERPROFILE || process.env.HOME || app.getPath('home');
    const safe = message.replace(/([?&]token=)[^\s]+/gi, '$1<redacted>');
    appendFileSync(path.join(home, '.dsh', 'monqey-code-startup-error.log'), `${new Date().toISOString()}\n${safe}\n`);
  } catch {}
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : port;
      server.close(() => resolve(selected));
    });
  });
}

async function findFreePort(preferred) {
  try {
    return await reservePort(preferred);
  } catch {
    return reservePort(0);
  }
}

function findNodeExecutable() {
  if (process.platform !== 'win32') return 'node';
  try {
    return execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean) || 'node.exe';
  } catch {
    return 'node.exe';
  }
}

function findNpxNodeModulePaths(npmCache) {
  const root = path.join(npmCache, '_npx');
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'node_modules'))
      .filter((nodeModules) => existsSync(path.join(nodeModules, '@deepseek-ai', 'dsh')));
  } catch {
    return [];
  }
}

function findWebUrl(text) {
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\S*/i);
  return match?.[0]?.replace(/[),.;]+$/, '');
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitFromTray() {
  if (quitConfirmationOpen) return;
  if (activeWork === false) {
    app.quit();
    return;
  }
  quitConfirmationOpen = true;
  dialog.showMessageBox({
    type: 'warning',
    title: 'Quit Monqey Code?',
    message: activeWork === true
      ? 'Monqey Code reports work in progress or input waiting for you.'
      : 'Monqey Code could not confirm whether work is still active.',
    detail: 'Quitting stops DSH and may interrupt that work.',
    buttons: ['Keep Monqey Code open', 'Quit Monqey Code'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }).then(({ response }) => {
    if (response === 1) app.quit();
  }).catch(() => {}).finally(() => {
    quitConfirmationOpen = false;
  });
}

function ensureTray() {
  if (process.platform !== 'win32' || tray) return;
  tray = new Tray(path.join(__dirname, 'assets', 'monqey.ico'));
  tray.setToolTip('Monqey Code');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Monqey Code', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit Monqey Code', click: quitFromTray }
  ]));
  tray.on('click', showMainWindow);
}

function showHarness(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    ensureTray();
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      title: 'Monqey Code',
      icon: path.join(__dirname, 'assets', 'monqey.ico'),
      backgroundColor: '#171717',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js')
      }
    });
  }

  mainWindow.on('focus', () => setTaskbarBadge(0));
  mainWindow.webContents.on('did-start-loading', () => { activeWork = undefined; });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('Monqey Code');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript("document.title = 'Monqey Code';", true).catch(() => {});
  });
  mainWindow.loadURL(url);
  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32' || shuttingDown) return;
    event.preventDefault();
    if (closeNoticeAcknowledged) {
      mainWindow.hide();
      return;
    }
    if (closePromptOpen) return;
    closePromptOpen = true;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Monqey Code stays open',
      message: 'Closing this window keeps Monqey Code running in the system tray. Your agent task continues in the background. Choose “Quit Monqey Code” from the tray to stop it.',
      buttons: ['Hide to tray', 'Keep open'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response !== 0 || !mainWindow || mainWindow.isDestroyed()) return;
      closeNoticeAcknowledged = true;
      if (closeNoticePath) {
        try {
          writeFileSync(closeNoticePath, new Date().toISOString(), 'utf8');
        } catch {}
      }
      mainWindow.hide();
    }).catch(() => {}).finally(() => {
      closePromptOpen = false;
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

function fail(message) {
  writeFailureLog(message);
  clearTimeout(startupTimer);
  dialog.showErrorBox('Monqey Code', message);
  shuttingDown = true;
  app.quit();
}

async function startDsh() {
  const port = await findFreePort(3080);
  const userHome = process.env.USERPROFILE || process.env.HOME || app.getPath('home');
  const dshHome = path.join(userHome, '.dsh');
  const dshNpmCache = path.join(dshHome, 'npm-cache');
  const dshLocalAppData = path.join(dshHome, 'local-appdata');
  const launcher = findNodeExecutable();
  const launcherArgs = [
    '--preserve-symlinks',
    path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    'web',
    '--no-open',
    '--port',
    String(port)
  ];
  const nodePath = [...findNpxNodeModulePaths(dshNpmCache), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  try {
    dshProcess = spawn(launcher, launcherArgs, {
      cwd: dshHome,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        NPM_CONFIG_CACHE: dshNpmCache,
        npm_config_cache: dshNpmCache,
        NODE_PATH: nodePath,
        LOCALAPPDATA: dshLocalAppData,
        DSH_CLIENT_TITLE: 'Monqey Code'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    fail(`Kon DSH niet starten.\n\n${error.message}`);
    return;
  }

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    startupBuffer += text;
    const url = findWebUrl(startupBuffer);
    if (url && !harnessShown) {
      harnessShown = true;
      clearTimeout(startupTimer);
      showHarness(url);
    }
  };

  dshProcess.stdout.on('data', handleOutput);
  dshProcess.stderr.on('data', handleOutput);
  dshProcess.on('error', (error) => fail(`Kon DSH niet starten.\n\n${error.message}`));
  dshProcess.on('exit', (code) => {
    if (!shuttingDown && !mainWindow && code !== 0) {
      fail(`DSH is gestopt met foutcode ${code ?? 'onbekend'}.\n\n${startupBuffer.slice(-1200)}`);
    }
  });

  startupTimer = setTimeout(() => {
    fail('DSH gaf binnen 60 seconden geen lokale web-URL terug.\n\nControleer of Node.js en npx beschikbaar zijn.');
  }, 180_000);
}

if (hasSingleInstanceLock) app.whenReady().then(startDsh);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shuttingDown = true;
  clearTimeout(startupTimer);
  if (!dshProcess || dshProcess.killed) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(dshProcess.pid), '/t', '/f'], { windowsHide: true });
    } catch {}
  } else {
    dshProcess.kill('SIGTERM');
  }
});
