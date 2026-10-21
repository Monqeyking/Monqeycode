const path = require('node:path');
const QRCode = require('qrcode');
const { WebSocket } = require('ws');
const { MobileAccess } = require('./mobile-access.cjs');
const { createRuntimeBridge } = require('./mobile-runtime.cjs');

function installMobileAccess({ app, ipcMain, safeStorage, getWindow, origin, relay }) {
  const expectedOrigin = new URL(origin).origin;
  let manager;
  let startupError;
  let qrUri;
  let qrCode;
  try {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure device storage is unavailable on this computer.');
    manager = new MobileAccess({
      filePath: path.join(app.getPath('userData'), 'mobile-access.json'),
      protect: value => safeStorage.encryptString(value).toString('base64'),
      unprotect: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
      WebSocket, relay,
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
    if (snapshot.pairing) {
      if (qrUri !== snapshot.pairing.uri) {
        const uri = snapshot.pairing.uri;
        const data = await QRCode.toDataURL(uri, { width: 320, margin: 3, errorCorrectionLevel: 'M' });
        qrUri = uri;
        qrCode = data;
      }
      if (manager.snapshot().pairing?.uri !== snapshot.pairing.uri) return status();
      snapshot.pairing.qrCode = qrCode;
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
      case 'enable': manager.enable(value); break;
      case 'pair': manager.pair(); break;
      case 'cancel': manager.cancelPairing(); break;
      case 'approve':
        if (typeof value !== 'string') throw new Error('Invalid device.');
        manager.approve(value); break;
      case 'revoke': manager.revoke(); break;
      default: throw new Error('Unknown mobile access action.');
    }
    return status();
  });
  return {
    close() { ipcMain.removeHandler('monqey-code:mobile-access'); manager?.close(); }
  };
}

module.exports = { installMobileAccess };
