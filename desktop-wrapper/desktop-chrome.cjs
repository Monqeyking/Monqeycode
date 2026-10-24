const os = require('node:os');
const { APP_ID } = require('./shortcuts.cjs');

const windowChrome = process.platform === 'win32' ? {
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: '#111111', symbolColor: '#ededed', height: 36 }
} : {};

function installDesktopChrome({ app, win, ipcMain, Menu, dialog, origin, quit, iconPath, executable }) {
  if (process.platform === 'win32' && iconPath && executable) {
    win.setIcon(iconPath);
    // The taskbar group uses the portable executable's embedded Windows icon.
    win.setAppDetails({ appId: APP_ID, appIconPath: executable, appIconIndex: 0,
      relaunchCommand: `"${executable}"`, relaunchDisplayName: 'Monqey Agent' });
  }
  const expectedOrigin = new URL(origin).origin;
  const action = name => win.webContents.send('monqey-code:desktop-action', name);
  const templates = [
    { label: 'File', submenu: [
      { label: 'New agent', accelerator: 'CommandOrControl+N', click: () => action('new-agent') },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => action('settings') },
      { type: 'separator' },
      { label: 'Close window', accelerator: 'CommandOrControl+W', click: () => win.close() },
      { label: 'Quit Monqey Agent', accelerator: 'CommandOrControl+Q', click: quit }
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { label: 'Help', submenu: [{ label: 'About Monqey Agent', click: () => dialog.showMessageBox(win, {
      type: 'info', title: 'Monqey Agent', message: 'Monqey Agent',
      detail: `Version ${app.getVersion()}`, buttons: ['OK']
    }) }] }
  ];
  const menu = Menu.buildFromTemplate(templates);
  Menu.setApplicationMenu(menu);
  win.setMenuBarVisibility(false);
  ipcMain.handle('monqey-code:desktop-chrome', (event, command, value) => {
    if (win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Desktop window required.');
    if (new URL(event.senderFrame.url).origin !== expectedOrigin) throw Error('Desktop window required.');
    if (command === 'info') return { computer: os.hostname(), platform: process.platform, version: app.getVersion() };
    if (command === 'theme' && typeof value === 'boolean') {
      if (process.platform === 'win32') win.setTitleBarOverlay({ color: value ? '#111111' : '#ffffff', symbolColor: value ? '#ededed' : '#222222', height: 36 });
      return;
    }
    if (command === 'menu' && value && ['File', 'Edit', 'View', 'Help'].includes(value.name) && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      menu.items.find(item => item.label === value.name).submenu.popup({ window: win, x: Math.max(0, Math.round(value.x)), y: Math.max(0, Math.round(value.y)) });
      return;
    }
    throw Error('Unknown desktop command.');
  });
  win.once('closed', () => ipcMain.removeHandler('monqey-code:desktop-chrome'));
}

module.exports = { windowChrome, installDesktopChrome };
