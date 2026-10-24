const path = require('node:path');
const QRCode = require('qrcode');
const { WebSocket } = require('ws');
const { MobileAccess } = require('./mobile-access.cjs');
const { createRuntimeBridge } = require('./mobile-runtime.cjs');
const { MobileAccount } = require('./mobile-account.cjs');
const accountConfig = require('./mobile-account-config.json');

function installMobileAccess({ app, ipcMain, safeStorage, getWindow, origin, relay, openExternal }) {
  const expectedOrigin = new URL(origin).origin;
  let manager;
  let account;
  let startupError;
  let qrUri;
  let qrCode;
  let qrSize;
  let connectAfterSignIn = false;
  try {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure device storage is unavailable on this computer.');
    const protect = value => safeStorage.encryptString(value).toString('base64');
    const unprotect = value => safeStorage.decryptString(Buffer.from(value, 'base64'));
    account = new MobileAccount({ filePath: path.join(app.getPath('userData'), 'mobile-account.json'), protect, unprotect, openExternal,
      changed: () => {
        const state = account?.snapshot();
        if (state?.error) connectAfterSignIn = false;
        if (state?.user && manager) {
          if (connectAfterSignIn) { connectAfterSignIn = false; manager.preparePairing(); }
          else if (manager.state.enabled && manager.connection === 'sign-in-required') void manager.connect();
        }
      }
    });
    manager = new MobileAccess({
      filePath: path.join(app.getPath('userData'), 'mobile-access.json'),
      protect, unprotect,
      WebSocket, relay: relay || accountConfig.relay,
      getAccountToken: relayUrl => relayUrl === accountConfig.relay ? account.token() : null,
      openRuntime: ({ signal, send }) => createRuntimeBridge({
        origin: expectedOrigin, WebSocket, signal, send,
        getCookie: async () => {
          const win = getWindow();
          if (!win || win.isDestroyed()) return '';
          const cookies = await win.webContents.session.cookies.get({ url: expectedOrigin });
          return cookies.filter(cookie => cookie.name.startsWith('dsh-auth-')).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        }
      })
    });
    manager.start();
  } catch {
    // Fail closed without interrupting the existing desktop agent session.
    startupError = 'Mobile access could not start. Check secure storage and the connection service configuration.';
  }
  const status = async () => {
    if (!manager) return { enabled: false, serviceConfigured: false, serviceStatus: 'unavailable', error: startupError, device: null, pairing: null, pendingDevice: null };
    const snapshot = manager.snapshot();
    snapshot.account = account.snapshot();
    if (snapshot.pairing) {
      if (qrUri !== snapshot.pairing.uri) {
        const uri = snapshot.pairing.uri;
        const data = await QRCode.toDataURL(uri, { scale: 5, margin: 4, errorCorrectionLevel: 'M' });
        qrSize = Buffer.from(data.split(',')[1], 'base64').readUInt32BE(16);
        qrUri = uri;
        qrCode = data;
      }
      if (manager.snapshot().pairing?.uri !== snapshot.pairing.uri) return status();
      snapshot.pairing.qrCode = qrCode;
      snapshot.pairing.qrSize = qrSize;
    } else { qrUri = null; qrCode = null; }
    return snapshot;
  };
  ipcMain.handle('monqey-code:mobile-access', async (event, action, value) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Mobile access settings are desktop-only.');
    let senderOrigin;
    try { senderOrigin = new URL(event.senderFrame.url).origin; } catch {}
    if (senderOrigin !== expectedOrigin) throw new Error('Mobile access settings are desktop-only.');
    if (action === 'status') return status();
    if (!manager) throw new Error(startupError);
    switch (action) {
      case 'sign-in':
        connectAfterSignIn = !manager.snapshot().device;
        try { await account.signIn(value); } catch (error) { connectAfterSignIn = false; throw error; }
        break;
      case 'cancel-sign-in': connectAfterSignIn = false; account.cancel(); break;
      case 'sign-out': connectAfterSignIn = false; manager.enable(false); await account.signOut(); break;
      case 'configure': connectAfterSignIn = false; manager.configureRelay(value); break;
      case 'enable': if (!value) connectAfterSignIn = false; manager.enable(value); break;
      case 'pair': manager.preparePairing(); break;
      case 'cancel': manager.cancelPairing(); break;
      case 'approve':
        if (typeof value !== 'string') throw new Error('Invalid device.');
        await manager.approve(value); break;
      case 'revoke': await manager.revoke(); break;
      default: throw new Error('Unknown mobile access action.');
    }
    return status();
  });
  return {
    close() { ipcMain.removeHandler('monqey-code:mobile-access'); manager?.close(); account?.close(); }
  };
}

module.exports = { installMobileAccess };
