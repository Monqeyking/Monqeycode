const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const fixture = process.argv.includes('--fixture');
const inspectCatalogs = process.argv.includes('--catalogs');
const settingsBefore = fs.readFileSync(path.join(root, 'settings.yaml'));
let home = root;
const extra = [];
if (fixture) {
  home = fs.mkdtempSync(path.join(root, 'logs/worker-fixture-'));
  fs.symlinkSync(path.join(root, 'profiles'), path.join(home, 'profiles'), 'junction');
  fs.symlinkSync(path.join(root, 'packages'), path.join(home, 'packages'), 'junction');
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'agent-default-model:\n  provider: fixture-main\n  model: fixture\nworkers:\n  enabled: true\n  worker:\n    provider: fixture-worker\n    model: fixture\n  fallback:\n    provider: fixture-reserve\n    model: fixture\n');
  const overlay = path.join(home, 'fixture.yml');
  fs.writeFileSync(overlay, '- insert:\n    - id: worker-fixture\n      name: monqey-code-delegation/runtime-fixture\n');
  extra.push('--patch', overlay);
}
const cache = path.join(root, 'npm-cache/_npx');
const dependencyPaths = fs.readdirSync(cache).map(name => path.join(cache, name, 'node_modules'));
const child = spawn(process.execPath, ['--preserve-symlinks', path.join(root, 'profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', ...extra, '--no-open', '--port', '0'], {
  cwd: home, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: dependencyPaths.join(path.delimiter) }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
const timeout = setTimeout(() => { console.error('Runtime smoke timed out.'); stop(); process.exitCode = 1; }, 60000);
function stop() {
  clearTimeout(timeout);
  try { execFileSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { child.kill(); }
}
let started = false;
async function inspect() {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[^\s\x1b]*/);
  if (!match || started) return;
  started = true;
  try {
    const url = new URL(match[0]);
    const initial = await fetch(url, { redirect: 'manual' });
    const cookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    async function rpc(method, args) {
      const response = await fetch(new URL(`/api/${method}`, url.origin), { method: 'POST', headers: { 'content-type': 'application/json', Origin: url.origin, Cookie: cookie }, body: JSON.stringify({ type: 'client-request', rpcId: 'workers-smoke', method, payload: { args } }) });
      const envelope = await response.json();
      assert.equal(envelope.result?.ok, true, JSON.stringify(envelope.result?.error));
      return envelope.result.value;
    }
    const providers = await rpc('llm/listProviders', {});
    if (inspectCatalogs) {
      let status;
      const deadline = Date.now() + 40000;
      do {
        status = await rpc('llm/getModelCatalogStatus', {});
        if (status.every(item => !['pending', 'refreshing'].includes(item.state))) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      assert.ok(status.every(item => !['pending', 'refreshing'].includes(item.state)), JSON.stringify(status));
      const catalogs = [];
      for (const provider of providers) {
        const result = await rpc('workers/catalog', { providerId: provider.id });
        catalogs.push({ provider: provider.id, count: result.models.length, models: result.models.map(model => model.id) });
      }
      assert.deepEqual(fs.readFileSync(path.join(root, 'settings.yaml')), settingsBefore, 'Startup must preserve settings and the default model');
      console.log(JSON.stringify({ startupCatalogs: status, catalogs, settingsPreserved: true }));
    }
    const htmlResponse = await fetch(new URL('/', url.origin), { headers: { Cookie: cookie } });
    const html = await htmlResponse.text();
    const scriptUrls = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(match => match[1]);
    assert.ok(scriptUrls.length > 0, 'Frontend scripts are missing.');
    const scriptBodies = await Promise.all(scriptUrls.map(async source => (await fetch(new URL(source, url.origin), { headers: { Cookie: cookie } })).text()));
    assert.ok(html.includes('monqey-code-delegation') || scriptBodies.some(body => body.includes('monqey-code-delegation')), 'Workers are missing from the frontend modules.');
    const catalog = await rpc('workers/catalog', { providerId: '' });
    assert.equal(catalog.providers.length, providers.length);
    const tasks = await rpc('workers/listTasks', { parentId: 'workers-smoke-check' });
    assert.deepEqual(tasks.tasks, []);
    const source = await fetch(new URL('/api/workers/catalog', url.origin), { method: 'POST', headers: { 'content-type': 'application/json', Origin: url.origin, Cookie: cookie }, body: JSON.stringify({ type: 'client-request', rpcId: 'workers-invalid', method: 'workers/catalog', payload: { args: { providerId: '', unexpected: true } } }) });
    assert.equal((await source.json()).result.ok, false);
    if (fixture) console.log(JSON.stringify({ fixture: await rpc('workersFixture/run', {}) }));
    console.log(JSON.stringify({ runtime: 'ok', providers: providers.map(item => item.id), workerCatalog: 'ok', workerStatusRpc: 'ok', frontendModule: 'ok', invalidArgsRejected: true }));
  } catch (error) { console.error(String(error.message).replace(/(token=)[^\s&]+/gi, '$1[redacted]')); process.exitCode = 1; }
  finally { stop(); }
}
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data.toString(); void inspect(); });
child.on('exit', code => {
  clearTimeout(timeout);
  if (!started) {
    console.error(output.replace(/https?:\/\/[^\s]+/g, '[url]').slice(-7000));
    process.exitCode = code || 1;
  }
  if (fixture) {
    assert.ok(home.startsWith(path.join(root, 'logs/worker-fixture-')));
    fs.unlinkSync(path.join(home, 'profiles'));
    fs.unlinkSync(path.join(home, 'packages'));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
