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
  let fakeAccount;
  class FakeAccount {
    constructor(options) { this.options = options; fakeAccount = this; }
    snapshot() { return { user: this.user || null }; }
    async signIn() {}
    cancel() {}
    complete() { this.user = { email: 'owner@example.test' }; this.options.changed(); }
    close() {}
  }
  class FakeManager {
    constructor() { this.state = state; }
    start() {}
    snapshot() { return { ...state }; }
    enable(value) { calls.push(['enable', value]); }
    configureRelay(value) { calls.push(['configure', value]); }
    preparePairing() { calls.push(['prepare']); state.pairing = { uri: 'monqeycode://pair?v=1', expiresAt: Date.now() + 10000 }; }
    cancelPairing() { state.pairing = null; }
    approve(value) { calls.push(['approve', value]); }
    revoke() { calls.push(['revoke']); }
    close() { stopped = true; }
  }
  const sandbox = { module: { exports: {} }, Buffer, URL, require(name) {
    if (name === './mobile-access.cjs') return { MobileAccess: FakeManager };
    if (name === './mobile-account.cjs') return { MobileAccount: FakeAccount };
    if (name === './mobile-runtime.cjs') return { createRuntimeBridge() {} };
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
  for (const action of ['configure', 'enable', 'pair', 'approve', 'revoke', 'status']) {
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
  await invoke(event, 'configure', 'wss://relay.example');
  assert.deepEqual(calls.at(-1), ['configure', 'wss://relay.example']);
  const paired = await invoke(event, 'pair');
  assert.ok(paired.pairing.qrCode.startsWith('data:image/png'));
  assert.equal(calls.at(-1)[0], 'prepare');
  assert.ok(paired.pairing.qrSize >= 165);
  state.pairing = null;
  await invoke(event, 'sign-in', 'google');
  assert.equal(state.pairing, null, 'Opening sign-in must not show a QR before account verification');
  fakeAccount.complete();
  assert.ok((await invoke(event, 'status')).pairing, 'Successful sign-in prepares the QR without an enable action');
  state.pairing = null; fakeAccount.user = null;
  await invoke(event, 'sign-in', 'github');
  await invoke(event, 'cancel-sign-in');
  fakeAccount.complete();
  assert.equal(state.pairing, null, 'Cancelled sign-in must not leave a pending pairing intent');
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
