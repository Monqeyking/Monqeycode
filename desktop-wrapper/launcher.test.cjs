const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('desktop startup uses one application root before locking and passes it to the runtime', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-launcher-'));
  try {
    for (const relative of ['profiles/web/package.json', 'desktop-wrapper/package.json']) {
      const file = path.join(home, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{}');
    }
    const electronPaths = {};
    let ready;
    let launch;
    const app = {
      isPackaged: false,
      setPath: (name, value) => { electronPaths[name] = value; },
      setAppLogsPath: value => { electronPaths.logs = value; },
      requestSingleInstanceLock: () => {
        assert.equal(electronPaths.userData, path.join(home, 'electron-data'));
        assert.equal(electronPaths.sessionData, path.join(home, 'electron-data'));
        return true;
      },
      on() {}, whenReady: () => ({ then: callback => { ready = callback; } }),
      commandLine: { appendSwitch() {} }, disableHardwareAcceleration() {}, setAppUserModelId() {}
    };
    const sandbox = {
      require(name) {
        if (name === 'electron') return { app, ipcMain: { on() {} } };
        if (name === 'node:child_process') return {
          execFileSync: () => 'node.exe',
          spawn: (executable, args, options) => {
            launch = { executable, args, ...options };
            return { stdout: { on() {} }, stderr: { on() {} }, on() {} };
          }
        };
        if (name === 'node:net') return { createServer: () => ({ once() {}, listen(_options, callback) { callback(); }, address: () => ({ port: 3080 }), close(callback) { callback(); } }) };
        return require(name);
      },
      __dirname: path.join(home, 'desktop-wrapper'),
      process: { platform: process.platform, execPath: process.execPath, env: { USERPROFILE: 'unused-user-home', LOCALAPPDATA: 'unused-appdata', DSH_HOME: 'unused-runtime-home' } },
      console, setTimeout: () => 1, clearTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), sandbox);
    await ready();
    assert.equal(launch.cwd, home);
    assert.equal(launch.args[1], path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
    assert.equal(launch.env.DSH_HOME, home);
    assert.equal(launch.env.NPM_CONFIG_CACHE, path.join(home, 'npm-cache'));
    assert.equal(launch.env.LOCALAPPDATA, path.join(home, 'local-appdata'));
    assert.equal(electronPaths.logs, path.join(home, 'logs'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
