const { MAX_PACKET_BYTES } = require('./mobile-protocol.cjs');

// Only this desktop-owned adapter sees the local DSH cookie. It never crosses the relay.
function createRuntimeBridge({ origin, getCookie, WebSocket, signal, send, fetch = globalThis.fetch }) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Expected local Monqey Agent runtime.');
  let stream;
  let opening = false;
  const activeIds = new Set();
  const close = () => { stream?.terminate(); stream = null; };
  signal.addEventListener('abort', close, { once: true });
  return {
    close,
    async receive(message) {
      if (signal.aborted) throw new Error('Mobile access was revoked.');
      if (message.type === 'rpc') {
        if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.id) || activeIds.has(message.id)) throw new Error('Invalid request ID.');
        if (typeof message.path !== 'string' || !/^\/api\/[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+$/.test(message.path) || new URL(message.path, base).pathname !== message.path) throw new Error('Invalid runtime route.');
        activeIds.add(message.id);
        try {
          const cookie = await getCookie();
          if (signal.aborted) return;
          if (!cookie) throw new Error('Desktop session is not ready.');
          const response = await fetch(new URL(message.path, base), {
            method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
            headers: { cookie, origin: base.origin, 'content-type': 'application/json' },
            body: JSON.stringify(message.payload ?? null)
          });
          const chunks = [];
          let size = 0;
          for await (const chunk of response.body || []) {
            size += chunk.length;
            if (size > MAX_PACKET_BYTES / 2) { await response.body.cancel().catch(() => {}); throw new Error('This response is too large for mobile access.'); }
            chunks.push(Buffer.from(chunk));
          }
          if (!signal.aborted) send({ type: 'rpc-result', id: message.id, status: response.status, body: Buffer.concat(chunks).toString('utf8') });
        } catch (error) {
          if (!signal.aborted) send({ type: 'rpc-error', id: message.id, message: error.name === 'TimeoutError' ? 'The request timed out.' : 'The desktop request could not be completed.' });
        } finally { activeIds.delete(message.id); }
      } else if (message.type === 'stream-open') {
        if (stream || opening) throw new Error('A mobile stream is already open.');
        opening = true;
        try {
          const cookie = await getCookie();
          if (signal.aborted) return;
          if (!cookie) throw new Error('Desktop session is not ready.');
          const target = new URL('/api/remote.mux', base);
          target.protocol = 'ws:';
          const socket = stream = new WebSocket(target, { headers: { cookie, origin: base.origin }, maxPayload: MAX_PACKET_BYTES / 2, perMessageDeflate: false, handshakeTimeout: 10000 });
          socket.on('open', () => { if (!signal.aborted) send({ type: 'stream-opened' }); });
          socket.on('message', data => { if (!signal.aborted) send({ type: 'stream-data', data: data.toString() }); });
          socket.on('error', () => socket.terminate());
          socket.on('close', () => {
            if (stream === socket) stream = null;
            if (!signal.aborted) send({ type: 'stream-closed' });
          });
        } finally { opening = false; }
      } else if (message.type === 'stream-send') {
        if (stream?.readyState !== 1 || typeof message.data !== 'string' || Buffer.byteLength(message.data) > MAX_PACKET_BYTES / 2 || stream.bufferedAmount > MAX_PACKET_BYTES) throw new Error('Mobile stream is unavailable.');
        stream.send(message.data);
      } else if (message.type === 'stream-close') close();
      else throw new Error('Unknown runtime request.');
    }
  };
}

module.exports = { createRuntimeBridge };
