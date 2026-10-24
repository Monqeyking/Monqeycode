const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');
const protocol = require('./mobile-protocol.cjs');
const { MobileAccess } = require('./mobile-access.cjs');
const { attachRelay } = require('./mobile-relay.cjs');
const { createRuntimeBridge } = require('./mobile-runtime.cjs');

const testRoot = path.resolve(__dirname, '..', 'electron-data');
function temporaryDirectory() {
  fs.mkdirSync(testRoot, { recursive: true });
  return fs.mkdtempSync(path.join(testRoot, 'mobile-test-'));
}
function cleanDirectory(directory) {
  const resolved = fs.realpathSync(directory);
  assert.ok(resolved.startsWith(fs.realpathSync(testRoot) + path.sep) && path.basename(resolved).startsWith('mobile-test-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function waitFor(check) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for mobile state.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function messages(socket) {
  const queue = [];
  const waiting = [];
  let closed = false;
  socket.on('message', raw => {
    const value = JSON.parse(raw.toString());
    if (waiting.length) waiting.shift().resolve(value); else queue.push(value);
  });
  socket.on('close', () => {
    closed = true;
    for (const next of waiting.splice(0)) next.reject(new Error('Connection closed.'));
  });
  return () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.reject(new Error('Connection closed.'));
    return new Promise((resolve, reject) => {
      const entry = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { const at = waiting.indexOf(entry); if (at >= 0) waiting.splice(at, 1); reject(new Error('Message timed out.')); }, 4000);
      waiting.push(entry);
    });
  };
}

async function connectPhone(relay, hostPublicKey, identity, secret, cleanup) {
  const hostId = protocol.publicIdentity(hostPublicKey).id;
  const socket = new WebSocket(`${relay}/v1/device?host=${hostId}`);
  cleanup.push(socket);
  const next = messages(socket);
  await once(socket, 'open');
  const ephemeral = protocol.createEphemeral();
  socket.send(JSON.stringify({ type: 'hello', name: 'Test Phone', platform: 'Android', publicKey: identity.publicKey, ephemeralKey: ephemeral.publicKey }));
  const challenge = await next();
  const transcript = protocol.handshakeTranscript(hostId, challenge.peerId, challenge.nonce, protocol.publicIdentity(identity.publicKey).id, ephemeral.publicKey, challenge.ephemeralKey);
  assert.ok(protocol.verify(hostPublicKey, transcript, challenge.signature), 'Phone must verify the pinned desktop key');
  const channel = protocol.createChannel(ephemeral.key, challenge.ephemeralKey, transcript, false);
  const send = message => socket.send(JSON.stringify(channel.seal(message)));
  send({ type: 'authenticate', signature: protocol.sign(identity.privateKey, transcript), ...(secret ? { pairingSecret: secret } : {}) });
  return { socket, channel, send, next: async () => channel.open(await next()) };
}

test('Encrypted channels bind host and device keys, reject tampering and replay', () => {
  const host = protocol.createIdentity();
  const device = protocol.createIdentity();
  const a = protocol.createEphemeral();
  const b = protocol.createEphemeral();
  const transcript = protocol.handshakeTranscript(protocol.publicIdentity(host.publicKey).id, 'peer', 'nonce', protocol.publicIdentity(device.publicKey).id, b.publicKey, a.publicKey);
  assert.ok(protocol.verify(host.publicKey, transcript, protocol.sign(host.privateKey, transcript)));
  assert.equal(protocol.verify(device.publicKey, transcript, protocol.sign(host.privateKey, transcript)), false);
  const hostChannel = protocol.createChannel(a.key, b.publicKey, transcript, true);
  const deviceChannel = protocol.createChannel(b.key, a.publicKey, transcript, false);
  const packet = deviceChannel.seal({ type: 'authenticate', pairingSecret: 'not-visible-to-relay' });
  assert.ok(!JSON.stringify(packet).includes('not-visible-to-relay'));
  const tampered = Buffer.from(packet.data, 'base64url');
  tampered[0] ^= 1;
  assert.throws(() => hostChannel.open({ ...packet, data: tampered.toString('base64url') }));
  assert.equal(hostChannel.open(packet).pairingSecret, 'not-visible-to-relay');
  assert.throws(() => hostChannel.open(packet), /replayed/);
  const reflected = hostChannel.seal({ type: 'ready' });
  assert.throws(() => hostChannel.open({ ...reflected, seq: 1 }));
  assert.equal(deviceChannel.open(reflected).type, 'ready');
  for (const address of ['http://example.com', 'ws://192.168.1.5', 'wss://user:pass@example.com', 'wss://example.com/path', 'wss://example.com/?key=secret']) assert.throws(() => protocol.relayUrl(address));
  assert.equal(protocol.relayUrl('wss://example.com'), 'wss://example.com');
});

test('No service means no pairing; disabled settings survive reload without creating an identity', () => {
  const directory = temporaryDirectory();
  const options = { filePath: path.join(directory, 'state.json'), protect: x => x, unprotect: x => x, WebSocket, openRuntime: () => {} };
  const manager = new MobileAccess(options);
  try {
    assert.equal(manager.snapshot().serviceConfigured, false);
    assert.throws(() => manager.enable(true), /not been set up/);
    assert.throws(() => manager.pair(), /before pairing/);
    manager.enable(false);
    const restored = new MobileAccess(options);
    assert.equal(restored.snapshot().enabled, false);
    restored.close();
  } finally { manager.close(); cleanDirectory(directory); }
});

test('Public QR links keep the secret in the fragment; cancelling preparation prevents a later QR', async () => {
  const directory = temporaryDirectory();
  const manager = new MobileAccess({ filePath: path.join(directory, 'state.json'), relay: require('./mobile-account-config.json').relay, protect: x => x, unprotect: x => x, WebSocket, openRuntime() {} });
  try {
    manager.state = { ...manager.state, enabled: true, identity: protocol.createIdentity() };
    manager.connection = 'connected';
    const invite = new URL(manager.preparePairing().pairing.uri);
    const fragment = new URLSearchParams(invite.hash.slice(1));
    assert.equal(invite.origin, 'https://monqey-agent-relay.onrender.com');
    assert.equal(invite.pathname, '/pair');
    assert.equal(invite.search, '');
    assert.equal(fragment.get('key'), manager.state.identity.publicKey);
    assert.equal(fragment.get('code'), manager.pairing.secret);
    assert.equal(fragment.has('relay'), false);
    manager.cancelPairing();
    let finish;
    manager.getAccountToken = () => new Promise(resolve => { finish = resolve; });
    manager.connection = 'disabled';
    assert.equal(manager.preparePairing().preparingPairing, true);
    manager.cancelPairing();
    manager.enable(false);
    finish('unused-fixture-token');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.snapshot().pairing, null);
    assert.equal(manager.snapshot().preparingPairing, false);
    assert.equal(manager.socket, null);
  } finally { manager.close(); cleanDirectory(directory); }
});

test('Connection service changes validate, persist and require a fresh enable action', () => {
  const directory = temporaryDirectory();
  const options = { filePath: path.join(directory, 'state.json'), protect: x => x, unprotect: x => x, WebSocket, openRuntime: () => {} };
  const manager = new MobileAccess(options);
  try {
    for (const address of [null, {}, 123, 'ws://192.168.0.10', 'wss://user:password@example.com', 'wss://example.com/private', 'x'.repeat(2049)]) assert.throws(() => manager.configureRelay(address));
    assert.equal(fs.existsSync(options.filePath), false);
    manager.configureRelay(' wss://relay.example ');
    assert.equal(manager.snapshot().enabled, false);
    assert.equal(manager.snapshot().relayUrl, 'wss://relay.example');
    assert.equal(manager.state.identity, null);
    let restored = new MobileAccess({ ...options, relay: 'wss://packaged-default.example' });
    assert.equal(restored.snapshot().relayUrl, 'wss://relay.example'); restored.close();
    manager.state.device = { id: 'paired-phone' };
    assert.throws(() => manager.configureRelay('wss://new-relay.example'), /Revoke/);
    assert.equal(manager.snapshot().relayUrl, 'wss://relay.example');
    manager.state.device = null;
    manager.configureRelay('');
    restored = new MobileAccess({ ...options, relay: 'wss://packaged-default.example' });
    assert.equal(restored.snapshot().serviceConfigured, false); restored.close();
  } finally { manager.close(); cleanDirectory(directory); }
});

test('Real relay + desktop + phone: approve, RPC, stream, reconnect, revoke and expiry', { timeout: 20000 }, async () => {
  const directory = temporaryDirectory();
  const service = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const relay = attachRelay(service);
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const address = `ws://127.0.0.1:${service.address().port}`;
  const localRequests = [];
  let heldRequestClosed = false;
  const runtime = http.createServer(async (req, res) => {
    localRequests.push(req.url);
    assert.equal(req.headers.cookie, 'dsh-auth-test=local-only');
    if (req.url === '/api/session/hold') { res.on('close', () => { heldRequestClosed = true; }); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, value: JSON.parse(body) }));
  });
  const mux = new WebSocketServer({ server: runtime, path: '/api/remote.mux' });
  mux.on('connection', (socket, req) => {
    assert.equal(req.headers.cookie, 'dsh-auth-test=local-only');
    socket.on('message', raw => socket.send(raw.toString()));
  });
  await new Promise(resolve => runtime.listen(0, '127.0.0.1', resolve));
  let clock = Date.now();
  const options = {
    filePath: path.join(directory, 'state.json'), relay: address, WebSocket, now: () => clock,
    protect: value => Buffer.from(value).toString('base64'), unprotect: value => Buffer.from(value, 'base64').toString(),
    openRuntime: ({ signal, send }) => createRuntimeBridge({ origin: `http://127.0.0.1:${runtime.address().port}`, getCookie: async () => 'dsh-auth-test=local-only', WebSocket, signal, send })
  };
  const manager = new MobileAccess(options);
  const sockets = [];
  const device = protocol.createIdentity();
  try {
    const preparing = manager.preparePairing();
    assert.equal(preparing.enabled, true);
    assert.equal(preparing.preparingPairing, true);
    await waitFor(() => manager.snapshot().pairing);
    assert.equal(manager.snapshot().preparingPairing, false);
    let invitation = new URL(manager.snapshot().pairing.uri);
    const hostKey = invitation.searchParams.get('key');
    const secret = invitation.searchParams.get('code');
    const wrongCode = await connectPhone(address, hostKey, device, 'wrong-code', sockets);
    await assert.rejects(wrongCode.next(), /closed/);
    assert.equal(manager.snapshot().device, null);
    const phone = await connectPhone(address, hostKey, device, secret, sockets);
    assert.equal((await phone.next()).type, 'approval-pending');
    assert.equal(manager.snapshot().device, null, 'Knowing the QR code is insufficient without desktop approval');
    const id = manager.snapshot().pendingDevice.id;
    assert.throws(() => manager.approve('wrong-device'), /expired/);
    manager.approve(id);
    assert.equal((await phone.next()).type, 'ready');
    assert.equal(manager.snapshot().device.status, 'Connected');
    assert.throws(() => manager.pair(), /Revoke/);
    phone.send({ type: 'rpc', id: 'list-1', path: '/api/session/list', payload: { scope: 'test' } });
    const rpc = await phone.next();
    assert.equal(rpc.type, 'rpc-result');
    assert.deepEqual(JSON.parse(rpc.body), { ok: true, value: { scope: 'test' } });
    assert.ok(!JSON.stringify(rpc).includes('local-only'));
    phone.send({ type: 'stream-open' });
    assert.equal((await phone.next()).type, 'stream-opened');
    phone.send({ type: 'stream-send', data: JSON.stringify({ type: 'test-event', id: 1 }) });
    assert.equal(JSON.parse((await phone.next()).data).type, 'test-event');
    phone.socket.close();
    await waitFor(() => manager.snapshot().device.status === 'Offline');
    const restored = new MobileAccess(options);
    assert.equal(restored.snapshot().device.id, id);
    assert.equal(restored.snapshot().device.status, 'Offline');
    assert.ok(!JSON.stringify(restored.snapshot()).includes('PRIVATE KEY'));
    restored.close();
    await assert.rejects(connectPhone(address, hostKey, protocol.createIdentity(), null, sockets), /closed/);
    const reconnected = await connectPhone(address, hostKey, device, null, sockets);
    assert.equal((await reconnected.next()).type, 'ready');
    const second = await connectPhone(address, hostKey, device, null, sockets);
    assert.equal((await second.next()).type, 'ready');
    await waitFor(() => reconnected.socket.readyState === 3);
    second.send({ type: 'rpc', id: 'held', path: '/api/session/hold', payload: {} });
    await waitFor(() => localRequests.includes('/api/session/hold'));
    manager.revoke();
    await waitFor(() => second.socket.readyState === 3 && heldRequestClosed);
    assert.equal(manager.snapshot().device, null);
    await assert.rejects(connectPhone(address, hostKey, device, secret, sockets), /closed/);
    invitation = new URL(manager.pair().pairing.uri);
    const expired = await connectPhone(address, hostKey, device, invitation.searchParams.get('code'), sockets);
    assert.equal((await expired.next()).type, 'approval-pending');
    clock += 121000;
    assert.throws(() => manager.approve(id), /expired/);
    manager.expire();
    assert.equal(manager.snapshot().pairing, null);
    await waitFor(() => expired.socket.readyState === 3);
    manager.pair();
    manager.enable(false);
    assert.equal(manager.snapshot().pairing, null);
    assert.equal(manager.snapshot().serviceStatus, 'disabled');
    assert.deepEqual(localRequests, ['/api/session/list', '/api/session/hold']);
  } finally {
    for (const socket of sockets) socket.terminate();
    manager.close();
    await relay.close();
    await new Promise(resolve => service.close(resolve));
    for (const socket of mux.clients) socket.terminate();
    await new Promise(resolve => mux.close(resolve));
    runtime.closeAllConnections();
    await new Promise(resolve => runtime.close(resolve));
    cleanDirectory(directory);
  }
});

test('Runtime adapter refuses external or malformed paths before making a request', async () => {
  const abort = new AbortController();
  let requests = 0;
  const bridge = createRuntimeBridge({ origin: 'http://127.0.0.1:3080', signal: abort.signal, send() {}, getCookie: async () => 'cookie', WebSocket, fetch: async () => { requests++; } });
  for (const route of ['https://example.com', '//example.com/api/x/y', '/api/../secret', '/api/session/list?token=secret', '/settings', '/api/x/%2e%2e']) await assert.rejects(bridge.receive({ type: 'rpc', id: 'test', path: route }), /route/);
  assert.equal(requests, 0);
  abort.abort();
  await assert.rejects(bridge.receive({ type: 'rpc', id: 'test', path: '/api/session/list' }), /revoked/);
  bridge.close();
});

test('Runtime adapter carries the DSH approval-result route with its dollar-prefixed namespace', async () => {
  const abort = new AbortController();
  let target;
  let result;
  const bridge = createRuntimeBridge({
    origin: 'http://127.0.0.1:3080', signal: abort.signal, WebSocket,
    send: value => { result = value; }, getCookie: async () => 'local-cookie',
    fetch: async url => { target = url.href; return new Response('{"ok":true}', { status: 200 }); }
  });
  await bridge.receive({ type: 'rpc', id: 'approve-1', path: '/api/$events/result', payload: { args: {} } });
  assert.equal(target, 'http://127.0.0.1:3080/api/$events/result');
  assert.equal(result.type, 'rpc-result');
  abort.abort();
  bridge.close();
});
