const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { badgeBitmap } = require('./attention.cjs');

for (const value of [0, -1, NaN, Infinity, 0.4]) assert.equal(badgeBitmap(value), null);
for (const value of [1, 9, 10, 99, 1000]) {
  const bitmap = badgeBitmap(value);
  assert.equal(bitmap.buffer.length, 32 * 32 * 4);
  assert.equal(bitmap.buffer[3], 0);
  assert.ok(bitmap.buffer.includes(255));
}
assert.deepEqual(badgeBitmap(10).buffer, badgeBitmap(99).buffer);

const handlers = new Map();
const windowEvents = new Map();
const overlays = [];
const flashes = [];
const notifications = [];
let focused = false;
const win = {
  isDestroyed: () => false, isFocused: () => focused, isMinimized: () => false,
  webContents: { on() {}, executeJavaScript: () => Promise.resolve() },
  setOverlayIcon: (icon) => overlays.push(icon), flashFrame: value => flashes.push(value),
  on: (name, callback) => windowEvents.set(name, callback), loadURL() {},
  show() {}, focus() { focused = true; }, setTitle() {}
};
class FakeNotification {
  constructor(options) { this.options = options; this.handlers = {}; notifications.push(this); }
  static isSupported() { return true; }
  on(name, callback) { this.handlers[name] = callback; }
  show() { this.shown = true; }
  close() { this.closed = true; this.handlers.close?.(); }
}
const app = {
  requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }),
  commandLine: { appendSwitch() {} }, disableHardwareAcceleration() {},
  getPath: () => __dirname, setPath() {}, setAppUserModelId() {}
};
const sandbox = {
  require(name) {
    if (name === 'electron') return { app, Notification: FakeNotification, ipcMain: { on: (n, f) => handlers.set(n, f) }, nativeImage: { createFromBitmap: (buffer, options) => ({ buffer, options }) } };
    if (name === 'node:fs') return { existsSync: () => false, mkdirSync() {}, appendFileSync() {} };
    if (name === './mobile-desktop.cjs') return { installMobileAccess: () => ({ close() {} }) };
    return require(name);
  },
  __dirname, process: { platform: 'win32', env: {} }, console, clearTimeout, setTimeout
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') + '\nglobalThis.testWindow = value => {mainWindow = value; tray = {}; showHarness("http://localhost:3080");};', sandbox);
sandbox.testWindow(win);
const sender = { sender: win.webContents };
handlers.get('monqey-code:pending-attention')(sender, 1);
assert.ok(overlays.at(-1));
assert.equal(flashes.at(-1), true);
windowEvents.get('focus')();
assert.ok(overlays.at(-1), 'Focusing must preserve pending approval badge');
handlers.get('monqey-code:desktop-notification')(sender, { title: 'Goedkeuring nodig', body: 'Open Monqey Agent', requiresInput: true });
assert.equal(notifications.length, 1);
assert.equal(notifications[0].shown, true);
notifications[0].handlers.click();
assert.equal(focused, true);
handlers.get('monqey-code:desktop-notification')(sender, { title: 'Input', body: 'Waiting' });
assert.equal(notifications.length, 1, 'Focused window must not get native popup');
handlers.get('monqey-code:pending-attention')(sender, 0);
assert.equal(overlays.at(-1), null);
assert.equal(flashes.at(-1), false);
const before = overlays.length;
handlers.get('monqey-code:pending-attention')({ sender: {} }, 1);
assert.equal(overlays.length, before, 'Ignore messages from other renderers');
console.log('Desktop attention: badge raster, persistent pending count, popup, click, resolution and IPC isolation pass.');
