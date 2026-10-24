// Isolated native bridge/QR check; never opens the user's agent runtime or profile.
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { attachRelay } = require('./mobile-relay.cjs');
const { installMobileAccess } = require('./mobile-desktop.cjs');
const root = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(root, 'logs/mobile-native-fixture-'));
app.setPath('userData', home);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let win;
  let mobile;
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Isolated mobile pairing check</title><body>Native pairing fixture</body>'); });
  const relay = attachRelay(server);
  ipcMain.handle('monqey-code:desktop-chrome', () => ({}));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') } });
    mobile = installMobileAccess({ app, ipcMain, safeStorage, getWindow: () => win, origin, openExternal: async () => {} });
    await win.loadURL(origin);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const bridge = window.monqeyDesktop.mobileAccess;
      const before = await bridge.getStatus();
      if (!before.serviceConfigured || before.account?.user) throw Error('Expected the default service with a signed-out fixture account');
      const signingIn = await bridge.signIn('google');
      if (!signingIn.account.signingIn || signingIn.account.user) throw Error('Browser sign-in exposed an unverified account');
      const cancelled = await bridge.cancelSignIn();
      if (cancelled.account.signingIn || cancelled.account.user) throw Error('Sign-in cancellation failed');
      const configured = await bridge.setConnectionService(${JSON.stringify(origin.replace('http:', 'ws:'))});
      if (configured.enabled || !configured.serviceConfigured) throw Error('Invalid saved configuration');
      const preparing = await bridge.pairPhone();
      if (!preparing.enabled || !preparing.preparingPairing) throw Error('One-click pairing did not start');
      let current;
      for (let i = 0; i < 50; i++) {
        current = await bridge.getStatus();
        if (current.pairing) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (current.serviceStatus !== 'connected') throw Error('Fixture relay did not connect');
      const pair = current;
      const image = new Image();
      const size = await new Promise((resolve, reject) => {
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = reject;
        image.src = pair.pairing.qrCode;
      });
      const uri = new URL(pair.pairing.uri);
      if (uri.protocol !== 'monqeycode:' || uri.hostname !== 'pair' || !uri.searchParams.get('code')) throw Error('Invalid QR payload');
      const cancel = await bridge.cancelPairing();
      const off = await bridge.setEnabled(false);
      return { configured: configured.relayUrl, size, qrSize: pair.pairing.qrSize, cancelled: cancel.pairing === null, disabled: !off.enabled };
    })()`);
    assert.deepEqual(result.size, [result.qrSize, result.qrSize]);
    assert.equal(result.qrSize % 5, 0);
    assert.equal(result.cancelled, true);
    assert.equal(result.disabled, true);
    const state = JSON.parse(fs.readFileSync(path.join(home, 'mobile-access.json'), 'utf8'));
    assert.equal(state.relayUrl, result.configured);
    assert.equal(state.enabled, false);
    assert(state.identity.privateKey && !state.identity.privateKey.includes('PRIVATE KEY'));
    fs.writeFileSync(path.join(root, 'logs/mobile-native-smoke-result.json'), JSON.stringify({ ok: true, checks: ['actual Electron preload/IPC settings flow', 'secure native identity storage', 'one-click relay connection and QR', 'integer-scale QR image loaded by renderer', 'invitation cancel and disable'], realPhoneTested: false }, null, 2));
    console.log('Native settings bridge and real QR generation passed. No user state or agent tools used.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    mobile?.close();
    win?.destroy();
    await relay.close();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(home) !== path.join(root, 'logs') || !path.basename(home).startsWith('mobile-native-fixture-')) throw Error('Unexpected fixture path');
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.log(`Chromium cache cleanup deferred until Electron exits: ${home}`); }
    finally { app.quit(); }
  }
});
