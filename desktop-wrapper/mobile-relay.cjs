// Deploy behind an HTTPS reverse proxy with WebSocket upgrades and edge rate limits.
// Device approval and end-to-end encryption belong to the desktop, not this relay.
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { MAX_PACKET_BYTES, publicIdentity, verify, relayTranscript } = require('./mobile-protocol.cjs');

function attachRelay(server, { allowedHostIds = null, accounts = null, accountCheckMs = 15000 } = {}) {
  if (allowedHostIds !== null && (!Array.isArray(allowedHostIds) || allowedHostIds.length > 32 || allowedHostIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id) || Buffer.from(id, 'base64url').toString('base64url') !== id))) throw new Error('Invalid allowed computer IDs.');
  const allowed = allowedHostIds === null ? null : new Set(allowedHostIds);
  const hosts = new Map();
  const sockets = new Set();
  const peers = new Map();
  const connectionsByIp = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * MAX_PACKET_BYTES, perMessageDeflate: false });
  function send(socket, message) {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 4 * MAX_PACKET_BYTES) { socket.terminate(); return; }
    socket.send(JSON.stringify(message));
  }
  const upgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url, 'http://relay.invalid'); } catch { socket.destroy(); return; }
    const ip = request.socket.remoteAddress;
    if (!['/v1/host', '/v1/device'].includes(url.pathname) || (connectionsByIp.get(ip) || 0) >= 64 || sockets.size >= 128) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      sockets.add(ws);
      connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => ws.terminate());
      let hostId;
      let peerId;
      let peerHost;
      let account;
      let deviceId;
      let verifying = false;
      let windowStart = Date.now();
      let count = 0;
      const nonce = randomBytes(32).toString('base64url');
      const timeout = setTimeout(() => ws.terminate(), 10000);
      timeout.unref();
      if (url.pathname === '/v1/host') send(ws, { type: 'challenge', nonce });
      else {
        peerHost = hosts.get(url.searchParams.get('host'));
        if (!peerHost || peerHost.readyState !== 1 || [...peers.values()].filter(p => p.host === peerHost).length >= 8) ws.close(1008, 'Computer unavailable');
        else if (accounts) send(ws, { type: 'account-challenge', nonce });
        else {
          peerId = randomBytes(18).toString('base64url');
          peers.set(peerId, { socket: ws, host: peerHost });
          clearTimeout(timeout);
        }
      }
      ws.on('message', async raw => {
        try {
          if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
          if (++count > 120) throw new Error('Rate limit.');
          const message = JSON.parse(raw.toString());
          if (verifying && !hostId && !peerId) throw new Error('Authentication already running.');
          if (account && account.expiresAt <= Date.now()) throw new Error('Account session expired.');
          if (url.pathname === '/v1/host') {
            if (!hostId) {
              if (message.type !== 'register') throw new Error('Expected host authentication.');
              const identity = publicIdentity(message.publicKey);
              if (!accounts && allowed && !allowed.has(identity.id)) throw new Error('Computer is not allowed on this relay.');
              if (!verify(identity.encoded, relayTranscript(identity.id, nonce), message.signature)) throw new Error('Invalid host signature.');
              if (accounts) {
                verifying = true;
                account = await accounts.registerHost(message.accessToken, identity, message.name);
                verifying = false;
                if (ws.readyState !== 1) return;
                ws.account = account;
              }
              hostId = identity.id;
              const previous = hosts.get(hostId);
              hosts.set(hostId, ws);
              previous?.terminate();
              clearTimeout(timeout);
              send(ws, { type: 'registered' });
            } else if (accounts && ['approve-device', 'revoke-device'].includes(message.type)) {
              if (verifying) throw Error('Account request already running.');
              verifying = true;
              try {
                if (typeof message.requestId !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(message.requestId)) throw Error('Invalid request.');
                await accounts.device(account, hostId, message);
                if (message.type === 'revoke-device') for (const peer of peers.values()) if (peer.host === ws && peer.deviceId === message.deviceId) peer.socket.close(1008, 'Access revoked');
                send(ws, { type: 'account-result', requestId: message.requestId, ok: true });
              } catch { send(ws, { type: 'account-result', requestId: message.requestId, ok: false }); }
              finally { verifying = false; }
            } else {
              const peer = peers.get(message.peerId);
              if (!peer || peer.host !== ws) return;
              if (message.type === 'send') send(peer.socket, message.payload);
              else if (message.type === 'close') peer.socket.close(1008, 'Connection closed');
              else throw new Error('Unknown relay message.');
            }
          } else {
            if (accounts && !peerId) {
              if (message.type !== 'account') throw Error('Account authentication required.');
              const identity = publicIdentity(message.publicKey);
              const target = url.searchParams.get('host');
              if (!verify(identity.encoded, JSON.stringify(['monqey-mobile-v1', 'account', target, nonce]), message.signature)) throw Error('Invalid phone proof.');
              verifying = true;
              account = await accounts.authenticateDevice(message.accessToken, target, identity.id);
              verifying = false;
              if (ws.readyState !== 1 || peerHost !== hosts.get(target) || peerHost.account?.userId !== account.userId || [...peers.values()].filter(p => p.host === peerHost).length >= 8) throw Error('Computer unavailable.');
              deviceId = identity.id;
              ws.account = account;
              peerId = randomBytes(18).toString('base64url');
              peers.set(peerId, { socket: ws, host: peerHost, deviceId });
              clearTimeout(timeout);
              send(ws, { type: 'account-ready' });
              return;
            }
            if (!peerId || peers.get(peerId)?.socket !== ws || peerHost.readyState !== 1) throw new Error('Computer unavailable.');
            send(peerHost, { type: 'peer', peerId, ...(accounts ? { deviceId } : {}), payload: message });
          }
        } catch { send(ws, { type: 'rejected' }); ws.close(1008, 'Connection rejected'); }
      });
      ws.on('close', () => {
        clearTimeout(timeout);
        sockets.delete(ws);
        const remaining = (connectionsByIp.get(ip) || 1) - 1;
        if (remaining) connectionsByIp.set(ip, remaining); else connectionsByIp.delete(ip);
        if (hostId && hosts.get(hostId) === ws) hosts.delete(hostId);
        if (hostId) for (const [id, peer] of peers) if (peer.host === ws) { peers.delete(id); peer.socket.close(1012, 'Computer disconnected'); }
        if (peerId && peers.get(peerId)?.socket === ws) { peers.delete(peerId); send(peerHost, { type: 'peer-closed', peerId }); }
      });
    });
  };
  server.on('upgrade', upgrade);
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 20000);
  heartbeat.unref();
  let checking = false;
  const accountSweep = accounts && setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await Promise.all([...sockets].map(async socket => {
        if (!socket.account) return;
        try { await accounts.check(socket.account); }
        catch { socket.close(1008, 'Account or device access expired'); }
      }));
    } finally { checking = false; }
  }, accountCheckMs);
  accountSweep?.unref();
  return {
    async close() {
      clearInterval(heartbeat);
      clearInterval(accountSweep);
      server.off('upgrade', upgrade);
      for (const socket of sockets) socket.terminate();
      await new Promise(resolve => wss.close(resolve));
    }
  };
}

if (require.main === module) {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(req.url === '/health' ? 'ok' : 'not found');
  });
  const relay = attachRelay(server);
  server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('Monqey mobile relay listening on loopback. Publish through an HTTPS reverse proxy.'));
  const stop = async () => { await relay.close(); server.close(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

module.exports = { attachRelay };
