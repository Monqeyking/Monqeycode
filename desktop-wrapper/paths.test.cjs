const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { resolvePaths, repairRuntimeLinks } = require('./paths.cjs');

test('all storage follows the application folder, including after relocation', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-paths-'));
  try {
    let root = path.join(temporary, 'original', 'Monqey-Agent');
    for (const file of ['profiles/web/package.json', 'desktop-wrapper/package.json']) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), '{}');
    }
    const options = { wrapperDir: path.join(root, 'desktop-wrapper'), env: { USERPROFILE: temporary, LOCALAPPDATA: temporary, DSH_HOME: temporary } };
    assert.equal(resolvePaths(options).home, root);
    const moved = path.join(temporary, 'another location');
    fs.cpSync(path.dirname(root), moved, { recursive: true });
    fs.rmSync(path.dirname(root), { recursive: true });
    root = path.join(moved, 'Monqey-Agent');
    const portable = {
      packaged: true, wrapperDir: path.join(temporary, 'extracted', 'app.asar'),
      env: { PORTABLE_EXECUTABLE_DIR: path.join(root, 'desktop-wrapper', 'dist-mobile-access') }
    };
    const paths = resolvePaths(portable);
    assert.equal(paths.home, root);
    for (const value of Object.values(paths)) assert.ok(!path.relative(root, value).startsWith('..'));
    assert.equal(resolvePaths({ ...portable, env: { PORTABLE_EXECUTABLE_FILE: path.join(root, 'desktop-wrapper', 'dist-mobile-access', 'Monqey.exe') } }).home, root);
    assert.equal(resolvePaths({ ...portable, env: {}, execPath: path.join(root, 'desktop-wrapper', 'dist-mobile-access', 'win-unpacked', 'Monqey.exe') }).home, root);
    assert.equal(resolvePaths({ ...portable, env: { MONQEY_HOME: root } }).home, root);
    assert.throws(() => resolvePaths({ ...portable, env: { MONQEY_HOME: temporary } }), /MONQEY_HOME must point/);
    assert.throws(() => resolvePaths({ ...portable, env: {}, execPath: path.join(temporary, 'missing', 'Monqey.exe') }), /Cannot find/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('relocated dependency links are repaired inside this root; external links stay intact', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-links-'));
  try {
    const home = path.join(temporary, 'Monqey-Agent');
    const profile = path.join(home, 'profiles', 'web');
    const cached = path.join(home, 'npm-cache', '_npx', 'installation', 'node_modules', 'example');
    const local = path.join(home, 'packages', 'local');
    const modules = path.join(home, 'profiles', 'node_modules');
    const external = path.join(temporary, 'external');
    for (const directory of [profile, cached, local, modules, external, path.join(profile, 'node_modules')]) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ dependencies: { local: 'link:../../packages/local' } }));
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    const cacheLink = path.join(modules, 'example');
    const localLink = path.join(profile, 'node_modules', 'local');
    fs.mkdirSync(path.join(temporary, 'old', 'npm-cache', '_npx', 'installation', 'node_modules', 'example'), { recursive: true });
    fs.mkdirSync(path.join(temporary, 'old', 'packages', 'local'), { recursive: true });
    fs.symlinkSync(path.join(temporary, 'old', 'npm-cache', '_npx', 'installation', 'node_modules', 'example'), cacheLink, type);
    fs.symlinkSync(path.join(temporary, 'old', 'packages', 'local'), localLink, type);
    fs.symlinkSync(external, path.join(modules, 'external'), type);
    fs.rmSync(path.join(temporary, 'old'), { recursive: true });
    assert.equal(repairRuntimeLinks({ home, profile }), 2);
    assert.equal(fs.realpathSync(cacheLink), fs.realpathSync(cached));
    assert.equal(fs.realpathSync(localLink), fs.realpathSync(local));
    assert.equal(fs.realpathSync(path.join(modules, 'external')), fs.realpathSync(external));
    assert.equal(repairRuntimeLinks({ home, profile }), 0);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
