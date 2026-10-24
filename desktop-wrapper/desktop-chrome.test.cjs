const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installDesktopChrome, windowChrome } = require('./desktop-chrome.cjs');

test('desktop menus keep native editing/window actions and reject untrusted frames and commands', () => {
  let handler, template, applicationMenu, popup, closed, quitting, action, overlay, icon, appDetails;
  const frame = { url: 'http://127.0.0.1:3080/' };
  const win = {
    webContents: { mainFrame: frame, send: (...args) => { action = args; } },
    isDestroyed: () => false, close: () => { closed = true; }, once() {},
    setMenuBarVisibility: value => assert.equal(value, false), setTitleBarOverlay: value => { overlay = value; },
    setIcon: value => { icon = value; }, setAppDetails: value => { appDetails = value; }
  };
  const Menu = {
    buildFromTemplate(value) { template = value; return { items: value.map(item => ({ ...item, submenu: { popup: options => { popup = options; } } })) }; },
    setApplicationMenu(value) { applicationMenu = value; }
  };
  installDesktopChrome({ app: { getVersion: () => '0.0.8' }, win, Menu, dialog: {}, origin: frame.url, quit: () => { quitting = true; }, ipcMain: { handle: (_name, callback) => { handler = callback; }, removeHandler() {} }, iconPath: 'C:\\Monqey Agent\\electron-data\\monqey.ico', executable: 'C:\\Monqey Agent\\Monqey Agent.exe' });
  if (process.platform === 'win32') {
    assert.equal(icon, 'C:\\Monqey Agent\\electron-data\\monqey.ico');
    assert.deepEqual(appDetails, { appId: 'com.monqey.code', appIconPath: 'C:\\Monqey Agent\\Monqey Agent.exe', appIconIndex: 0, relaunchCommand: '"C:\\Monqey Agent\\Monqey Agent.exe"', relaunchDisplayName: 'Monqey Agent' });
  }
  const event = { sender: win.webContents, senderFrame: frame };
  assert.ok(applicationMenu);
  assert.deepEqual(template.map(item => item.label), ['File', 'Edit', 'View', 'Help']);
  template[0].submenu[0].click(); assert.deepEqual(action, ['monqey-code:desktop-action', 'new-agent']);
  template[0].submenu[1].click(); assert.equal(action[1], 'settings');
  template[0].submenu[3].click(); assert.equal(closed, true);
  template[0].submenu[4].click(); assert.equal(quitting, true);
  assert.equal(template[1].submenu.find(item => item.role === 'paste').role, 'paste');
  assert.equal(handler(event, 'info').version, '0.0.8');
  handler(event, 'menu', { name: 'File', x: 20.5, y: 36 }); assert.equal(popup.x, 21); assert.equal(popup.window, win);
  handler(event, 'theme', true);
  if (process.platform === 'win32') { assert.equal(overlay.color, '#111111'); assert.equal(windowChrome.titleBarStyle, 'hidden'); }
  assert.throws(() => handler({ ...event, sender: {} }, 'info'), /Desktop window/);
  assert.throws(() => handler({ ...event, senderFrame: { url: frame.url } }, 'info'), /Desktop window/);
  frame.url = 'https://example.com/'; assert.throws(() => handler(event, 'theme', false), /Desktop window/); frame.url = 'http://127.0.0.1:3080/';
  for (const [command, value] of [['shell', 'anything'], ['theme', 'true'], ['menu', { name: 'File', x: NaN, y: 0 }], ['menu', { name: 'Unknown', x: 0, y: 0 }]]) assert.throws(() => handler(event, command, value), /Unknown desktop/);
});
