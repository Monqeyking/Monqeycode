const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, Tray } = require('electron');
const { badgeBitmap } = require('./attention.cjs');
const { execFileSync, spawn } = require('node:child_process');
const { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');
const { resolvePaths, repairRuntimeLinks } = require('./paths.cjs');

app.setName?.('Monqey Agent');

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
let pendingAttention = 0;
let unreadNotifications = 0;
let mobileAccess;
let appPaths;
let pathError;
const desktopNotifications = new Set();

// Resolve storage before Electron acquires its profile-specific instance lock.
try {
  appPaths = resolvePaths({ wrapperDir: __dirname, packaged: app.isPackaged, env: process.env, execPath: process.execPath });
  const electronData = appPaths.electronData;
  mkdirSync(electronData, { recursive: true });
  mkdirSync(appPaths.logs, { recursive: true });
  app.setPath('userData', electronData);
  app.setPath('sessionData', electronData);
  app.setPath('cache', path.join(electronData, 'cache'));
  app.setAppLogsPath?.(appPaths.logs);
  closeNoticePath = path.join(electronData, 'background-close-confirmed');
  closeNoticeAcknowledged = existsSync(closeNoticePath);
} catch (error) { pathError = error.message; }

function taskbarBadge(count) {
  const bitmap = badgeBitmap(count);
  return bitmap ? nativeImage.createFromBitmap(bitmap.buffer, { width: bitmap.width, height: bitmap.height }) : null;
}

function setTaskbarBadge(count) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'win32') return;
  const icon = taskbarBadge(count);
  mainWindow.setOverlayIcon(icon, icon ? `${count} Monqey Agent notification${count === 1 ? '' : 's'}` : 'No Monqey Agent notifications');
}

ipcMain.on('monqey-code:taskbar-badge', (event, count) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  unreadNotifications = Number.isFinite(count) ? Math.max(0, Math.min(99, Math.trunc(count))) : 0;
  setTaskbarBadge(Math.max(pendingAttention, unreadNotifications));
});

ipcMain.on('monqey-code:pending-attention', (event, count) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !Number.isFinite(count)) return;
  const next = Math.max(0, Math.min(99, Math.trunc(count)));
  if (next > pendingAttention && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  pendingAttention = next;
  setTaskbarBadge(Math.max(pendingAttention, unreadNotifications));
  if (!next) {
    mainWindow.flashFrame(false);
    for (const notification of desktopNotifications) if (notification.requiresInput) notification.close();
  }
});

ipcMain.on('monqey-code:desktop-notification', (event, message) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || mainWindow.isFocused()) return;
  if (!message || typeof message.title !== 'string' || typeof message.body !== 'string' || !Notification.isSupported()) return;
  const notification = new Notification({ title: message.title.slice(0, 100), body: message.body.slice(0, 300), icon: path.join(__dirname, 'assets', 'monqey.ico') });
  notification.requiresInput = message.requiresInput === true;
  desktopNotifications.add(notification);
  notification.on('click', () => { showMainWindow(); notification.close(); });
  notification.on('close', () => desktopNotifications.delete(notification));
  notification.on('failed', () => desktopNotifications.delete(notification));
  notification.show();
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
if (process.platform === 'win32') app.setAppUserModelId('com.monqey.code');

// Some Windows setups cannot load Electron's GPU subprocess dependencies.
// The DSH web UI does not need hardware acceleration, so keep startup reliable.
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('use-angle', 'swiftshader');
app.disableHardwareAcceleration();

function writeFailureLog(message) {
  try {
    const safe = message.replace(/([?&]token=)[^\s]+/gi, '$1<redacted>');
    if (appPaths) appendFileSync(path.join(appPaths.logs, 'startup-error.log'), `${new Date().toISOString()}\n${safe}\n`);
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

function qoderRuntimeEnvironment() {
  const sdkRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'qoder-agent-sdk')
    : path.join(appPaths.profile, 'node_modules', '@qoder-ai', 'qoder-agent-sdk', 'dist');
  const workerPath = path.join(sdkRoot, '_worker', 'qoder-worker-runtime.obf.mjs');
  const cliNames = process.platform === 'win32' ? ['qoder.exe', 'qodercli.exe'] : ['qoder', 'qodercli'];
  const cliPath = cliNames.map((name) => path.join(sdkRoot, '_bundled', name)).find((candidate) => existsSync(candidate));
  return {
    ...(existsSync(workerPath) ? { MONQEY_QODER_WORKER_RUNTIME_PATH: workerPath } : {}),
    ...(cliPath ? { MONQEY_QODER_CLI_PATH: cliPath } : {})
  };
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
    title: 'Quit Monqey Agent?',
    message: activeWork === true
      ? 'Monqey Agent reports work in progress or input waiting for you.'
      : 'Monqey Agent could not confirm whether work is still active.',
    detail: 'Quitting stops DSH and may interrupt that work.',
    buttons: ['Keep Monqey Agent open', 'Quit Monqey Agent'],
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
  tray.setToolTip('Monqey Agent');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Monqey Agent', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit Monqey Agent', click: quitFromTray }
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
      title: 'Monqey Agent',
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

  mainWindow.on('focus', () => {
    unreadNotifications = 0;
    setTaskbarBadge(pendingAttention);
    mainWindow.flashFrame(false);
    for (const notification of desktopNotifications) notification.close();
  });
  mainWindow.webContents.on('did-start-loading', () => {
    activeWork = undefined;
    pendingAttention = 0;
    unreadNotifications = 0;
    setTaskbarBadge(0);
    mainWindow.flashFrame(false);
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('Monqey Agent');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript("document.title = 'Monqey Agent';", true).catch(() => {});
  });
  if (!mobileAccess) {
    const { installMobileAccess } = require('./mobile-desktop.cjs');
    mobileAccess = installMobileAccess({
      app, ipcMain, safeStorage, getWindow: () => mainWindow, origin: url,
      relay: process.env.MONQEY_MOBILE_RELAY_URL || require('./package.json').mobileAccessRelayUrl
    });
  }
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
      title: 'Monqey Agent stays open',
      message: 'Closing this window keeps Monqey Agent running in the system tray. Your agent task continues in the background. Choose “Quit Monqey Agent” from the tray to stop it.',
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
  dialog.showErrorBox('Monqey Agent', message);
  shuttingDown = true;
  app.quit();
}

async function startDsh() {
  if (pathError) return fail(pathError);
  try { repairRuntimeLinks(appPaths); } catch (error) { return fail(`Cannot prepare the runtime in ${appPaths.home}.\n\n${error.message}`); }
  const port = await findFreePort(3080);
  const { home: dshHome, npmCache: dshNpmCache, localAppData: dshLocalAppData } = appPaths;
  const launcher = findNodeExecutable();
  const launcherArgs = [
    '--preserve-symlinks',
    appPaths.launcher,
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
        DSH_CLIENT_TITLE: 'Monqey Agent',
        ...qoderRuntimeEnvironment()
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
  mobileAccess?.close();
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
