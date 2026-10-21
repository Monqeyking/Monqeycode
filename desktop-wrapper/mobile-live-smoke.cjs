// Runs the installed web profile in disposable state and a hidden Electron window.
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { installMobileAccess } = require('./mobile-desktop.cjs');
const http = require('node:http');
const { attachRelay } = require('./mobile-relay.cjs');
const { createRuntimeBridge } = require('./mobile-runtime.cjs');
const { WebSocket } = require('ws');

const workspace = path.resolve(__dirname, '..');
const parent = path.join(workspace, 'electron-data');
fs.mkdirSync(parent, { recursive: true });
const home = fs.mkdtempSync(path.join(parent, 'mobile-smoke-'));
app.setPath('userData', path.join(home, 'electron'));
app.disableHardwareAcceleration();
for (const flag of ['disable-gpu', 'disable-gpu-compositing', 'in-process-gpu', 'disable-gpu-sandbox']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('use-angle', 'swiftshader');

let child;
let window;
let mobile;
let output = '';
let relayServer;
let localRelay;
function stop() {
  mobile?.close();
  void localRelay?.close();
  relayServer?.close();
  window?.destroy();
  if (child?.pid) {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {} }
    else child.kill('SIGTERM');
  }
}

async function waitFor(read, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Live smoke test timed out.');
}

app.whenReady().then(async () => {
  const profile = path.join(home, 'profiles', 'web');
  const modules = path.join(profile, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'profiles', 'web', 'package.json'), 'utf8'));
  manifest.dsh.profile.patchReload = 'startup';
  for (const name of Object.keys(manifest.dependencies)) {
    const installed = path.join(workspace, 'profiles', 'web', 'node_modules', name);
    if (!fs.existsSync(installed)) continue;
    const link = path.join(modules, name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fs.realpathSync(installed), link, 'junction');
  }
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n');
  const cacheModules = fs.readdirSync(path.join(workspace, 'npm-cache', '_npx')).map(name => path.join(workspace, 'npm-cache', '_npx', name, 'node_modules'));
  // The fallback closure omits optional native packages; project installed ones only into this disposable home.
  for (const name of ['@koromix/koffi-win32-x64', '@img/sharp-win32-x64']) {
    const target = cacheModules.map(dir => path.join(dir, name)).find(candidate => fs.existsSync(candidate));
    if (!target) continue;
    const link = path.join(home, 'profiles', 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'junction');
  }
  child = spawn('node', ['--preserve-symlinks', path.join(workspace, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'web', '--no-open', '--port', '0'], {
    cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: cacheModules.join(path.delimiter) }
  });
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  child.on('error', error => { output += error.message; });
  const url = await waitFor(() => {
    if (child.exitCode !== null) throw new Error(output.replace(/([?&]token=)[^\s]+/g, '$1<redacted>').slice(-2200));
    return output.match(/http:\/\/127\.0\.0\.1:\d+\/?\?token=[A-Za-z0-9_-]+/)?.[0];
  });
  window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') } });
  mobile = installMobileAccess({ app, ipcMain, safeStorage, getWindow: () => window, origin: url });
  const errors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  await window.loadURL(url);
  await waitFor(() => window.webContents.executeJavaScript('Boolean(document.querySelector("button"))'));
  await new Promise(resolve => setTimeout(resolve, 1500));
  await window.webContents.executeJavaScript(`(() => {
    const notice = [...document.querySelectorAll('button')].find(node => node.innerText.trim() === 'Continue');
    notice?.click();
  })()`);
  await waitFor(() => window.webContents.executeJavaScript('!document.body.innerText.includes("Internal Testing Notice")'));
  console.log('Initial live page:', await window.webContents.executeJavaScript('document.body.innerText.slice(0, 900)'));
  const opened = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => /settings/i.test([node.innerText,node.getAttribute('aria-label'),node.title].join(' ')));
    if (!button) return false; button.click(); return true;
  })()`);
  if (!opened) throw new Error('Settings button was not found in the installed runtime.');
  await waitFor(() => window.webContents.executeJavaScript('document.body.innerText.includes("Mobile Access")'));
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.innerText.trim() === 'Mobile Access');
    if (!button) throw new Error('Mobile Access navigation is missing.'); button.click();
  })()`);
  await waitFor(() => window.webContents.executeJavaScript('document.body.innerText.includes("No phone paired")'));
  const status = await window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.getStatus()');
  if (status.serviceConfigured || status.enabled || status.device) throw new Error('Unconfigured service must remain disabled and unpaired.');
  if (status.error) throw new Error(status.error);
  console.log('Settings page:', await window.webContents.executeJavaScript('document.body.innerText.slice(-1600)'));
  await new Promise(resolve => setTimeout(resolve, 700));
  const screenshot = path.join(parent, 'mobile-access-settings.png');
  fs.writeFileSync(screenshot, (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  console.log('Mobile Access live section: disabled, Not configured, no phone paired; native IPC and safeStorage initialized.');
  console.log('Screenshot:', screenshot);
  const cookies = await window.webContents.session.cookies.get({ url: new URL(url).origin });
  let runtimeReply;
  const abort = new AbortController();
  const runtimeBridge = createRuntimeBridge({
    origin: new URL(url).origin, WebSocket, signal: abort.signal,
    getCookie: async () => cookies.filter(cookie => cookie.name.startsWith('dsh-auth-')).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    send: reply => { runtimeReply = reply; }
  });
  await runtimeBridge.receive({ type: 'rpc', id: 'providers', path: '/api/llm/listProviders', payload: { type: 'client-request', rpcId: 'mobile-smoke', method: 'llm/listProviders', payload: { args: {} } } });
  const providers = JSON.parse(runtimeReply.body).result;
  if (!providers.ok) throw new Error(`Runtime provider directory could not be queried: ${providers.error?.message}`);
  console.log('Live runtime provider IDs:', JSON.stringify(providers.value.map(provider => provider.id)));
  abort.abort();
  runtimeBridge.close();
  mobile.close();
  relayServer = http.createServer();
  localRelay = attachRelay(relayServer);
  await new Promise(resolve => relayServer.listen(0, '127.0.0.1', resolve));
  mobile = installMobileAccess({ app, ipcMain, safeStorage, getWindow: () => window, origin: url, relay: `ws://127.0.0.1:${relayServer.address().port}` });
  await window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.setEnabled(true)');
  await waitFor(() => window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.getStatus().then(state => state.serviceStatus === "connected")'));
  await window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.pairPhone()');
  await waitFor(() => window.webContents.executeJavaScript('Boolean(document.querySelector("img[alt=\\"Phone pairing QR code\\"]"))'));
  await new Promise(resolve => setTimeout(resolve, 700));
  fs.writeFileSync(path.join(parent, 'mobile-access-pairing.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  await window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.cancelPairing()');
  await window.webContents.executeJavaScript('window.monqeyDesktop.mobileAccess.setEnabled(false)');
  console.log('Native secure storage + local relay + Settings QR pairing path: pass.');
  if (errors.length) console.log('Renderer errors:', JSON.stringify(errors.slice(0, 5)));
  console.log('Smoke state:', home);
  stop();
  app.exit(0);
}).catch(async error => {
  console.error(error.message);
  console.error(output.replace(/([?&]token=)[^\s]+/g, '$1<redacted>').slice(-2200));
  if (window && !window.isDestroyed()) fs.writeFileSync(path.join(parent, 'mobile-access-smoke-error.png'), (await window.webContents.capturePage()).toPNG());
  stop();
  app.exit(1);
});
app.on('window-all-closed', () => {});
setTimeout(() => { console.error('Live smoke hard timeout.'); stop(); app.exit(1); }, 90000).unref();
