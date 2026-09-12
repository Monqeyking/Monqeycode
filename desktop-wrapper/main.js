const { app, BrowserWindow, dialog } = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const { appendFileSync, mkdirSync } = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');

let dshProcess;
let mainWindow;
let startupBuffer = '';
let startupTimer;
let shuttingDown = false;

// One DSH host must own the profile at a time. Without this guard, opening a
// second wrapper can start another host that tries to resume the same session.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
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

function findWebUrl(text) {
  const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\S*/i);
  return match?.[0]?.replace(/[),.;]+$/, '');
}

function showHarness(url) {
  if (!mainWindow || mainWindow.isDestroyed()) {
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
        nodeIntegration: false
      }
    });
  }

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('Monqey Code');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript("document.title = 'Monqey Code';", true).catch(() => {});
  });
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

function fail(message) {
  writeFailureLog(message);
  clearTimeout(startupTimer);
  dialog.showErrorBox('Monqey Code', message);
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
    path.join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    'web',
    '--no-open',
    '--port',
    String(port)
  ];
  try {
    dshProcess = spawn(launcher, launcherArgs, {
      cwd: dshHome,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        NPM_CONFIG_CACHE: dshNpmCache,
        npm_config_cache: dshNpmCache,
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
    if (url) {
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
