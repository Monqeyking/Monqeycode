const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Dictation, installDictation, validateAudio, trusted } = require('./dictation.cjs');

test('dictation rejects malformed audio, excessive uploads and untrusted frames', () => {
  for (const value of ['', '../file', '====', 'a'.repeat(12 * 1024 * 1024), null]) assert.throws(() => validateAudio(value, 'nl'));
  assert.throws(() => validateAudio('YQ==', 'shell'));
  assert.deepEqual(validateAudio('YQ==', 'auto'), { audio: 'YQ==', language: null });
  const frame = { url: 'http://127.0.0.1:3080/' }, win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  assert.equal(trusted({ sender: win.webContents, senderFrame: frame }, win, 'http://127.0.0.1:3080'), true);
  assert.equal(trusted({ sender: win.webContents, senderFrame: { ...frame } }, win, 'http://127.0.0.1:3080'), false);
  assert.equal(trusted({ sender: win.webContents, senderFrame: frame }, win, 'https://evil.test'), false);
});

test('microphone permissions accept only the desktop main origin and refuse camera/screen', () => {
  let request, check, handler;
  const frame = { url: 'http://127.0.0.1:3080/' };
  const contents = { mainFrame: frame, on() {}, session: { setPermissionRequestHandler: fn => { request = fn; }, setPermissionCheckHandler: fn => { check = fn; } } };
  const win = { webContents: contents, isDestroyed: () => false };
  installDictation({ win, ipcMain: { handle: (_name, fn) => { handler = fn; } }, home: os.tmpdir(), origin: frame.url });
  const result = (permission, details, owner = contents) => { let answer; request(owner, permission, value => { answer = value; }, details); return answer; };
  const details = { isMainFrame: true, requestingUrl: frame.url, mediaTypes: ['audio'] };
  assert.equal(result('media', details), true);
  for (const change of [{ mediaTypes: ['video'] }, { mediaTypes: ['audio', 'video'] }, { isMainFrame: false }, { requestingUrl: 'https://evil.test' }]) assert.equal(result('media', { ...details, ...change }), false);
  assert.equal(result('display-capture', details), false);
  assert.equal(result('clipboard-sanitized-write', details), true, 'Existing copy/paste controls must keep working');
  assert.equal(result('clipboard-read', { ...details, requestingUrl: 'https://evil.test' }), false);
  assert.equal(result('media', details, {}), false);
  assert.equal(check(contents, 'media', 'http://127.0.0.1:3080', { mediaType: 'audio', isMainFrame: true }), true);
  assert.equal(check(contents, 'media', 'http://127.0.0.1:3080', { mediaType: 'audio', isMainFrame: false }), false);
  assert.throws(() => handler({ sender: {}, senderFrame: frame }, 'status'), /Desktop/);
  assert.throws(() => handler({ sender: contents, senderFrame: frame }, 'execute'), /Unknown/);
});

test('speech worker is lazy, reuses its process, bounds concurrency and cancels cleanly', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-speech-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'vendor', 'speech'), { recursive: true });
  fs.mkdirSync(path.join(home, 'storages', 'speech', 'base'), { recursive: true });
  fs.writeFileSync(path.join(home, 'vendor', 'speech', 'python.exe'), 'fixture');
  fs.writeFileSync(path.join(home, 'vendor', 'speech', 'runtime.json'), JSON.stringify({ python: 'python.exe' }));
  fs.writeFileSync(path.join(home, 'storages', 'speech', 'base', 'model.bin'), 'fixture');
  let starts = 0;
  const engine = new Dictation(home, '', () => {
    starts++;
    return spawn(process.execPath, ['-e', 'console.log(JSON.stringify({ready:true}));require("node:readline").createInterface({input:process.stdin}).on("line",line=>{const r=JSON.parse(line);if(!r.wait)setTimeout(()=>console.log(JSON.stringify({text:"Test transcript"})),20)})'], { windowsHide: true });
  });
  t.after(() => engine.close());
  assert.equal(starts, 0);
  assert.equal(await engine.request({ audio: 'YQ==' }), 'Test transcript');
  assert.equal(await engine.request({ audio: 'YQ==' }), 'Test transcript');
  assert.equal(starts, 1);
  const pending = engine.request({ wait: true });
  await assert.rejects(engine.request({}), /already processing/);
  const rejection = assert.rejects(pending, /cancelled/);
  engine.close(); await rejection;
  assert.equal(engine.pending, null);
  assert.equal(await engine.request({ audio: 'YQ==' }), 'Test transcript');
  assert.equal(starts, 2);
});
