// Isolated Electron check; never starts the user's desktop runtime.
const { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { windowChrome, installDesktopChrome } = require('./desktop-chrome.cjs');
const root = path.resolve(__dirname, '..');
const preview = JSON.parse(fs.readFileSync(path.join(root, 'logs/memory-preview.json')));
const home = fs.mkdtempSync(path.join(root, 'logs/chrome-fixture-'));
app.setPath('userData', home);
const dark = process.argv.includes('--dark');
nativeTheme.themeSource = dark ? 'dark' : 'light';
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 920, show: false, backgroundColor: '#111111', ...windowChrome, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') } });
  installDesktopChrome({ app, win, ipcMain, Menu, dialog, origin: preview.url, quit: () => app.quit() });
  ipcMain.handle('monqey-code:mobile-access', () => ({ enabled: false, serviceConfigured: false, serviceStatus: 'disabled' }));
  try {
    await win.loadURL(preview.url);
    let state;
    for (let attempt = 0; attempt < 40; attempt++) {
      state = await win.webContents.executeJavaScript(`({
        menus: [...document.querySelectorAll('#monqey-titlebar button')].map(node => node.textContent),
        padding: getComputedStyle(document.body).paddingTop,
        height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
        theme: document.body.hasAttribute('data-ds-dark-theme'),
        ready: document.body.innerText.includes('Memory test project') && document.body.innerText.includes('Co-work'),
        bridge: typeof window.monqeyDesktop.chrome.onAction
      })`);
      if (state.ready && state.menus.length === 4) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.deepEqual(state.menus, ['File', 'Edit', 'View', 'Help']);
    assert.equal(state.padding, '36px');
    assert.equal(state.bridge, 'function');
    assert.equal(state.ready, true);
    assert.equal(state.theme, dark);
    const info = await win.webContents.executeJavaScript('window.monqeyDesktop.chrome.getInfo()');
    assert.equal(info.platform, process.platform);
    assert.equal(typeof info.computer, 'string');
    assert.ok(state.scrollHeight <= state.height, `Unexpected outer scrolling: ${JSON.stringify(state)}`);
    assert.equal(win.isMenuBarVisible(), false);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const shot = await win.webContents.capturePage();
    const suffix = dark ? 'dark' : 'light';
    fs.writeFileSync(path.join(root, `logs/desktop-chrome-${suffix}.png`), shot.toPNG());
    fs.writeFileSync(path.join(root, `logs/desktop-chrome-${suffix}.json`), JSON.stringify({ ...state, bounds: win.getBounds(), content: win.getContentBounds(), fixtureHome: home }));
    console.log(JSON.stringify({ chrome: 'ok', ...state }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
