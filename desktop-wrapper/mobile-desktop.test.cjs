const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Mobile management IPC only accepts the trusted desktop main frame', async () => {
  const handlers = new Map();
  const calls = [];
  const frame = { url: 'http://127.0.0.1:3080/' };
  const webContents = { mainFrame: frame };
  const win = { webContents, isDestroyed: () => false };
  const state = { enabled: false, pairing: null, device: null };
  let stopped = false;
  class FakeManager {
    start() {}
    snapshot() { return { ...state }; }
    enable(value) { calls.push(['enable', value]); }
    pair() { state.pairing = { uri: 'monqeycode://pair?v=1', expiresAt: Date.now() + 10000 }; }
    cancelPairing() { state.pairing = null; }
    approve(value) { calls.push(['approve', value]); }
    revoke() { calls.push(['revoke']); }
    close() { stopped = true; }
  }
  const sandbox = { module: { exports: {} }, Buffer, URL, require(name) {
    if (name === './mobile-access.cjs') return { MobileAccess: FakeManager };
    if (name === './mobile-runtime.cjs') return { createRuntimeBridge() {} };
    if (name === 'qrcode') return { toDataURL: async () => 'data:image/png;base64,test' };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'mobile-desktop.cjs'), 'utf8'), sandbox);
  const options = {
    app: { getPath: () => __dirname },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: Buffer.from, decryptString: buffer => buffer.toString() },
    getWindow: () => win, origin: 'http://127.0.0.1:3080/?token=local-secret'
  };
  const installed = sandbox.module.exports.installMobileAccess(options);
  const invoke = handlers.get('monqey-code:mobile-access');
  for (const action of ['enable', 'pair', 'approve', 'revoke', 'status']) {
    await assert.rejects(invoke({ sender: {}, senderFrame: frame }, action, true), /desktop-only/);
    await assert.rejects(invoke({ sender: webContents, senderFrame: { url: frame.url } }, action, true), /desktop-only/);
    frame.url = 'https://attacker.example';
    await assert.rejects(invoke({ sender: webContents, senderFrame: frame }, action, true), /desktop-only/);
    frame.url = 'http://127.0.0.1:3080/';
  }
  assert.equal(calls.length, 0);
  const event = { sender: webContents, senderFrame: frame };
  await invoke(event, 'enable', true);
  assert.deepEqual(calls, [['enable', true]]);
  const paired = await invoke(event, 'pair');
  assert.ok(paired.pairing.qrCode.startsWith('data:image/png'));
  await assert.rejects(invoke(event, 'approve', {}), /Invalid device/);
  await assert.rejects(invoke(event, 'unrecognized'), /Unknown/);
  installed.close();
  assert.ok(stopped);
  assert.equal(handlers.size, 0);
});

test('Unavailable secure storage disables mobile access without crashing desktop settings', async () => {
  const { installMobileAccess } = require('./mobile-desktop.cjs');
  const frame = { url: 'http://localhost:3080/' };
  const webContents = { mainFrame: frame };
  let invoke;
  const instance = installMobileAccess({
    app: {}, safeStorage: { isEncryptionAvailable: () => false },
    ipcMain: { handle: (_, handler) => { invoke = handler; }, removeHandler() {} },
    origin: frame.url, getWindow: () => ({ isDestroyed: () => false, webContents })
  });
  const event = { sender: webContents, senderFrame: frame };
  const status = await invoke(event, 'status');
  assert.equal(status.enabled, false);
  assert.equal(status.serviceStatus, 'unavailable');
  await assert.rejects(invoke(event, 'enable', true), /could not start/);
  instance.close();
});
