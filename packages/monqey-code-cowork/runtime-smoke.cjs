const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path'), assert = require('node:assert/strict'), fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const home = fs.mkdtempSync(path.join(root, 'logs/cowork-fixture-'));
const keep = process.argv.includes('--preview');
const stateFile = path.join(root, 'logs/cowork-preview.json');
const settingsBefore = fs.readFileSync(path.join(root, 'settings.yaml'));
fs.symlinkSync(path.join(root, 'profiles'), path.join(home, 'profiles'), 'junction');
fs.symlinkSync(path.join(root, 'packages'), path.join(home, 'packages'), 'junction');
fs.writeFileSync(path.join(home, 'settings.yaml'), 'agent-default-model:\n  provider: fixture\n  model: fixture\n');
fs.writeFileSync(path.join(home, 'fixture.yml'), '- insert:\n    - id: cowork-fixture\n      name: monqey-code-cowork/runtime-fixture\n');
const cache = path.join(root, 'npm-cache/_npx');
const dependencyPaths = fs.readdirSync(cache).map(name => path.join(cache, name, 'node_modules'));
let child, output = '', started = false, phase = 0, firstResult, cookie, origin;
function launch() {
  output = ''; started = false;
  child = spawn(process.execPath, ['--preserve-symlinks', path.join(root, 'profiles/node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', path.join(home, 'fixture.yml'), '--no-open', '--port', '0'], { cwd: home, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: dependencyPaths.join(path.delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data.toString(); void inspect(); });
  child.on('exit', () => { if (phase === 1) { phase = 2; launch(); } else if (phase !== 3) { if (!started) console.error(output.replace(/https?:\/\/[^\s]+/g, '[url]').slice(-7000)); cleanup(); process.exitCode ||= 1; } });
}
function stop() { try { execFileSync(path.join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); } catch { child.kill(); } }
function cleanup() {
  clearTimeout(timeout);
  if (keep && fs.existsSync(stateFile) && JSON.parse(fs.readFileSync(stateFile)).home === home) fs.unlinkSync(stateFile);
  assert.ok(home.startsWith(path.join(root, 'logs/cowork-fixture-')));
  for (const name of ['profiles', 'packages']) if (fs.lstatSync(path.join(home, name)).isSymbolicLink()) fs.unlinkSync(path.join(home, name));
  fs.rmSync(home, { recursive: true, force: true });
}
async function rpc(method, args = {}, ok = true) {
  const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify({ type: 'client-request', rpcId: 'cowork-smoke', method, payload: { args } }) });
  const envelope = await response.json();
  assert.equal(envelope.result?.ok, ok, JSON.stringify(envelope.result?.error)); return envelope.result.value;
}
async function inspect() {
  const match = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[^\s\x1b]*/);
  if (!match || started) return; started = true;
  try {
    const url = new URL(match[0]); origin = url.origin;
    const initial = await fetch(url, { redirect: 'manual' }); cookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    if (phase === 0) {
      firstResult = await rpc('coworkFixture/run');
      console.log(JSON.stringify(firstResult));
      const board = await rpc('cowork/board', { workspaceId: firstResult.workspaceId }); assert.equal(board.tasks[0].revision, 3);
      await rpc('cowork/mutate', { workspaceId: firstResult.workspaceId, request: { action: 'create', requestId: crypto.randomUUID(), title: 'Bad unknown args', extra: true } }, false);
      await rpc('cowork/mutate', { workspaceId: firstResult.workspaceId, request: { action: 'update', taskId: firstResult.taskId, revision: 3, patch: { linkedSessionId: crypto.randomUUID() } } }, false);
      assert.equal((await rpc('cowork/sessionTasks', { sessionId: firstResult.sessionId })).tasks.length, 2);
      phase = 1; stop();
    } else {
      const board = await rpc('cowork/board', { workspaceId: firstResult.workspaceId }); assert.equal(board.tasks[0].revision, 3); assert.equal(board.tasks[0].comments.length, 1);
      assert.deepEqual(fs.readFileSync(path.join(root, 'settings.yaml')), settingsBefore);
      console.log(JSON.stringify({ runtime: 'ok', restartPersistence: true, sameBoardInRpcAndTools: true, invalidArgsRejected: true, foreignAgentLinkRejected: true, realSettingsPreserved: true }));
      phase = 3;
      if (keep) { fs.writeFileSync(stateFile, JSON.stringify({ url: url.href, origin, home, pid: child.pid, ...firstResult })); console.log('Preview ready; isolated runtime retained for browser validation.'); clearTimeout(timeout); }
      else { stop(); cleanup(); }
    }
  } catch (error) { console.error(String(error.stack).replace(/(token=)[^\s&]+/gi, '$1[redacted]')); phase = 3; process.exitCode = 1; stop(); cleanup(); }
}
const timeout = setTimeout(() => { console.error(output.replace(/https?:\/\/[^\s]+/g, '[url]').slice(-5000)); phase = 3; process.exitCode = 1; stop(); cleanup(); }, 90000);
process.on('SIGINT', () => { phase = 3; stop(); cleanup(); });
launch();
