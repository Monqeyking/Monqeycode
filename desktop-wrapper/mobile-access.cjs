const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protocol = require('./mobile-protocol.cjs');

const PAIRING_MS = 2 * 60 * 1000;
const PEER_TIMEOUT_MS = 45 * 1000;
const code = () => crypto.randomBytes(32).toString('base64url');
const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

class MobileAccess extends EventEmitter {
  constructor({ filePath, protect, unprotect, WebSocket, relay, now = Date.now, openRuntime, getAccountToken }) {
    super();
    Object.assign(this, { filePath, protect, unprotect, WebSocket, now, openRuntime, getAccountToken });
    this.accountRequests = new Map();
    this.connectionGeneration = 0;
    this.state = { version: 1, enabled: false, identity: null, device: null };
    if (fs.existsSync(filePath)) {
      this.state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (this.state.version !== 1 || typeof this.state.enabled !== 'boolean' || (!this.state.identity && (this.state.enabled || this.state.device))) throw new Error('Mobile access settings could not be read.');
      if (this.state.identity) {
        protocol.publicIdentity(this.state.identity.publicKey);
        const privateKey = unprotect(this.state.identity.privateKey);
        if (!protocol.verify(this.state.identity.publicKey, 'key-check', protocol.sign(privateKey, 'key-check'))) throw new Error('Mobile access identity is invalid.');
      }
      if (this.state.device && protocol.publicIdentity(this.state.device.publicKey).id !== this.state.device.id) throw new Error('Paired device is invalid.');
      if (this.state.relayUrl !== undefined && typeof this.state.relayUrl !== 'string') throw new Error('Invalid connection service setting.');
    }
    this.relay = this.state.relayUrl !== undefined
      ? (this.state.relayUrl ? protocol.relayUrl(this.state.relayUrl) : null)
      : (relay ? protocol.relayUrl(relay) : null);
    this.peers = new Map();
    this.connection = 'disabled';
    this.retryCount = 0;
    this.stopped = false;
    this.sweep = setInterval(() => this.expire(), 5000);
    this.sweep.unref();
  }

  save(next) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
    this.state = next;
  }

  start() {
    if (this.state.enabled) {
      if (this.relay) this.connect();
      else { this.connection = 'unavailable'; this.changed(); }
    }
  }

  snapshot() {
    const current = this.pairing?.expiresAt > this.now() ? this.pairing : null;
    const device = this.state.device;
    const active = device && [...this.peers.values()].find(p => p.authenticated && p.device.id === device.id);
    return {
      enabled: this.state.enabled,
      serviceConfigured: Boolean(this.relay),
      relayUrl: this.relay || '',
      serviceStatus: this.connection,
      error: this.error || null,
      device: device ? { id: device.id, name: device.name, platform: device.platform, pairedAt: device.pairedAt, lastSeenAt: active?.lastSeenAt ?? device.lastSeenAt, status: active ? 'Connected' : 'Offline', fingerprint: device.id } : null,
      pairing: current ? { uri: current.uri, expiresAt: current.expiresAt } : null,
      preparingPairing: Boolean(this.prepareRequested),
      pendingDevice: current?.pending ? { id: current.pending.device.id, name: current.pending.device.name, platform: current.pending.device.platform, fingerprint: current.pending.device.id } : null
    };
  }

  changed() { this.emit('change', this.snapshot()); }

  configureRelay(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid secure connection service URL.');
    const relay = value.trim() ? protocol.relayUrl(value.trim()) : null;
    if (relay === this.relay) return this.snapshot();
    if (this.state.device) throw new Error('Revoke the paired phone before changing the connection service.');
    this.save({ ...this.state, relayUrl: relay || '', enabled: false });
    this.disconnect();
    this.relay = relay;
    this.error = null;
    this.changed();
    return this.snapshot();
  }

  enable(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid mobile access setting.');
    if (enabled && !this.relay) throw new Error('The mobile connection service has not been set up yet.');
    let identity = this.state.identity;
    if (enabled && !identity) {
      const created = protocol.createIdentity();
      identity = { publicKey: created.publicKey, privateKey: this.protect(created.privateKey) };
    }
    this.save({ ...this.state, enabled, identity });
    if (enabled) this.connect();
    else this.disconnect();
    this.changed();
    return this.snapshot();
  }

  preparePairing() {
    if (this.state.device) throw new Error('Revoke the current phone before pairing another phone.');
    if (!this.relay) throw new Error('The mobile connection service has not been set up yet.');
    if (this.connection === 'connected') return this.pair();
    this.prepareRequested = true;
    if (!this.state.enabled) this.enable(true);
    else void this.connect();
    this.changed();
    return this.snapshot();
  }

  pair() {
    if (!this.state.enabled || this.connection !== 'connected') throw new Error('Connect mobile access before pairing a phone.');
    if (this.state.device) throw new Error('Revoke the current phone before pairing another phone.');
    this.cancelPairing();
    const secret = code();
    const invite = new URL('monqeycode://pair');
    invite.searchParams.set('v', '1');
    invite.searchParams.set('relay', this.relay);
    invite.searchParams.set('key', this.state.identity.publicKey);
    invite.searchParams.set('code', secret);
    if (this.relay === require('./mobile-account-config.json').relay) {
      // Fragments stay on the phone; the invitation never reaches HTTP logs.
      const fragment = new URLSearchParams(invite.searchParams);
      fragment.delete('relay');
      invite.href = this.relay.replace('wss:', 'https:') + '/pair#' + fragment;
    }
    this.pairing = { secret, uri: invite.href, expiresAt: this.now() + PAIRING_MS };
    this.changed();
    return this.snapshot();
  }

  cancelPairing() {
    this.prepareRequested = false;
    const pending = this.pairing?.pending;
    this.pairing = null;
    if (pending) this.drop(pending.id);
    this.changed();
    return this.snapshot();
  }

  approve(id) {
    const pairing = this.pairing;
    const peer = pairing?.pending;
    if (!this.state.enabled || this.state.device || !peer || peer.device.id !== id || this.peers.get(peer.id) !== peer || pairing.expiresAt <= this.now()) throw new Error('This pairing request has expired.');
    const finish = () => {
      if (this.pairing !== pairing || this.peers.get(peer.id) !== peer || pairing.expiresAt <= this.now()) throw Error('This pairing request has expired.');
      this.save({ ...this.state, device: { ...peer.device, pairedAt: this.now(), lastSeenAt: this.now() } });
      this.pairing = null;
      this.authenticate(peer);
      this.changed();
      return this.snapshot();
    };
    return this.accountMode ? this.accountRequest('approve-device', { deviceId: id, publicKey: peer.device.publicKey, name: peer.device.name }).then(finish) : finish();
  }

  revoke() {
    const id = this.state.device?.id;
    this.save({ ...this.state, device: null });
    this.pairing = null;
    for (const peer of [...this.peers.values()]) this.drop(peer.id);
    this.changed();
    return id && this.accountMode ? this.accountRequest('revoke-device', { deviceId: id }).then(() => this.snapshot()) : this.snapshot();
  }

  accountRequest(type, value) {
    const requestId = crypto.randomBytes(18).toString('base64url');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.accountRequests.delete(requestId); reject(Error('The device registry could not be updated. Reconnect and try again.')); }, 12000);
      timer.unref();
      this.accountRequests.set(requestId, { resolve, reject, timer });
      try { this.send({ type, requestId, ...value }); }
      catch (error) { clearTimeout(timer); this.accountRequests.delete(requestId); reject(error); }
    });
  }

  authenticate(peer) {
    for (const old of [...this.peers.values()]) if (old !== peer && old.authenticated) this.drop(old.id);
    peer.authenticated = true;
    peer.lastSeenAt = this.now();
    this.sendSecure(peer, { type: 'ready', deviceId: peer.device.id, protocol: protocol.PROTOCOL });
    this.changed();
  }

  send(value) {
    if (this.socket?.readyState !== 1) throw new Error('Mobile access is disconnected.');
    if (this.socket.bufferedAmount > 4 * protocol.MAX_PACKET_BYTES) throw new Error('Mobile connection is too slow.');
    this.socket.send(JSON.stringify(value));
  }

  sendSecure(peer, payload) { this.send({ type: 'send', peerId: peer.id, payload: peer.channel.seal(payload) }); }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    if (this.pairing?.pending === peer) this.pairing.pending = null;
    peer.abort.abort();
    peer.runtime?.close();
    if (peer.authenticated && this.state.device?.id === peer.device.id) {
      try { this.save({ ...this.state, device: { ...this.state.device, lastSeenAt: peer.lastSeenAt } }); }
      catch { this.error = 'The last connection time could not be saved.'; }
    }
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'close', peerId: id }));
    this.changed();
  }

  expire() {
    if (this.pairing && this.pairing.expiresAt <= this.now()) this.cancelPairing();
    for (const peer of [...this.peers.values()]) if (this.now() - peer.lastSeenAt >= (peer.authenticated ? PEER_TIMEOUT_MS : 15000) && this.pairing?.pending !== peer) this.drop(peer.id);
  }

  async receive(id, payload, accountDeviceId) {
    if (!this.state.enabled || this.connection !== 'connected' || typeof id !== 'string' || id.length > 100) return;
    try {
      let peer = this.peers.get(id);
      if (!peer) {
        if (payload?.type !== 'hello' || this.peers.size >= 8) throw new Error('Connection rejected.');
        const identity = protocol.publicIdentity(payload.publicKey);
        if (this.accountMode && identity.id !== accountDeviceId) throw Error('Phone account identity mismatch.');
        if (this.state.device && identity.id !== this.state.device.id) throw new Error('Phone is not paired.');
        if (!this.state.device && (!this.pairing || this.pairing.expiresAt <= this.now())) throw new Error('Pairing is not open.');
        const ephemeral = protocol.createEphemeral();
        const nonce = code();
        const hostId = protocol.publicIdentity(this.state.identity.publicKey).id;
        const transcript = protocol.handshakeTranscript(hostId, id, nonce, identity.id, payload.ephemeralKey, ephemeral.publicKey);
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || !['iOS', 'Android'].includes(payload.platform)) throw new Error('Invalid phone details.');
        peer = {
          id, device: { id: identity.id, publicKey: identity.encoded, name, platform: payload.platform },
          transcript, channel: protocol.createChannel(ephemeral.key, payload.ephemeralKey, transcript, true),
          abort: new AbortController(), lastSeenAt: this.now(), authenticated: false, authReceived: false, requests: 0
        };
        this.peers.set(id, peer);
        this.send({ type: 'send', peerId: id, payload: { type: 'challenge', nonce, peerId: id, ephemeralKey: ephemeral.publicKey, signature: protocol.sign(this.unprotect(this.state.identity.privateKey), transcript) } });
        return;
      }
      const message = peer.channel.open(payload);
      if (!peer.authenticated) {
        if (peer.authReceived || message.type !== 'authenticate' || !protocol.verify(peer.device.publicKey, peer.transcript, message.signature)) throw new Error('Phone authentication failed.');
        peer.authReceived = true;
        if (this.state.device?.id === peer.device.id) this.authenticate(peer);
        else {
          const pairing = this.pairing;
          if (!pairing || pairing.pending || pairing.expiresAt <= this.now() || !sameSecret(message.pairingSecret, pairing.secret)) throw new Error('Pairing request rejected.');
          pairing.pending = peer;
          this.sendSecure(peer, { type: 'approval-pending' });
          this.changed();
        }
        return;
      }
      peer.lastSeenAt = this.now();
      if (message.type === 'ping') { this.sendSecure(peer, { type: 'pong' }); return; }
      if (!['rpc', 'stream-open', 'stream-send', 'stream-close'].includes(message.type)) throw new Error('Unknown mobile request.');
      if (peer.requests >= 8) throw new Error('Too many mobile requests.');
      peer.runtime ??= this.openRuntime({ signal: peer.abort.signal, send: value => {
        if (this.peers.get(id) === peer && peer.authenticated) this.sendSecure(peer, value);
      } });
      peer.requests++;
      try { await peer.runtime.receive(message); }
      finally { peer.requests--; }
    } catch {
      if (this.peers.has(id)) this.drop(id);
      else if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'close', peerId: id }));
    }
  }

  async connect() {
    if (this.stopped || !this.state.enabled || !this.relay || this.socket || this.startingAccount) return;
    this.connection = 'connecting';
    this.error = null;
    this.changed();
    const generation = this.connectionGeneration;
    let accessToken;
    if (this.getAccountToken) {
      this.startingAccount = true;
      try { accessToken = await this.getAccountToken(this.relay); }
      catch (error) { if (generation === this.connectionGeneration) { this.connection = 'sign-in-required'; this.error = error.message; this.changed(); } return; }
      finally { this.startingAccount = false; }
      if (generation !== this.connectionGeneration || this.stopped || !this.state.enabled) return;
    }
    this.accountMode = Boolean(accessToken);
    const socket = this.socket = new this.WebSocket(`${this.relay}/v1/host`, { maxPayload: 2 * protocol.MAX_PACKET_BYTES, perMessageDeflate: false, handshakeTimeout: 10000, followRedirects: false });
    const timeout = setTimeout(() => socket.terminate(), 15000);
    timeout.unref();
    let registered = false;
    socket.on('message', data => {
      if (socket !== this.socket) return;
      try {
        const message = JSON.parse(data.toString());
        if (!registered) {
          if (message.type === 'challenge' && /^[A-Za-z0-9_-]{43}$/.test(message.nonce)) {
            const identity = this.state.identity;
            const hostId = protocol.publicIdentity(identity.publicKey).id;
            this.send({ type: 'register', publicKey: identity.publicKey, signature: protocol.sign(this.unprotect(identity.privateKey), protocol.relayTranscript(hostId, message.nonce)), ...(accessToken ? { accessToken, name: require('node:os').hostname() } : {}) });
            accessToken = null;
          } else if (message.type === 'registered') {
            registered = true;
            clearTimeout(timeout);
            this.connection = 'connected';
            this.retryCount = 0;
            if (this.prepareRequested) this.pair();
            this.changed();
          } else socket.terminate();
        } else if (message.type === 'account-result') {
          const request = this.accountRequests.get(message.requestId);
          if (request) { clearTimeout(request.timer); this.accountRequests.delete(message.requestId); message.ok === true ? request.resolve() : request.reject(Error('The device registry refused this change.')); }
        } else if (message.type === 'peer') void this.receive(message.peerId, message.payload, message.deviceId);
        else if (message.type === 'peer-closed') this.drop(message.peerId);
      } catch { socket.terminate(); }
    });
    socket.on('error', () => { this.error = 'Could not reach the mobile connection service.'; });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (socket !== this.socket) return;
      this.socket = null;
      this.rejectAccountRequests();
      for (const peer of [...this.peers.values()]) this.drop(peer.id);
      const preparing = this.prepareRequested;
      this.cancelPairing();
      this.prepareRequested = preparing;
      this.connection = this.state.enabled && !this.stopped ? 'disconnected' : 'disabled';
      this.changed();
      if (this.state.enabled && !this.stopped) {
        this.retry = setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** Math.min(this.retryCount++, 5)) + Math.random() * 500);
        this.retry.unref();
      }
    });
  }

  disconnect() {
    this.connectionGeneration++;
    clearTimeout(this.retry);
    this.cancelPairing();
    for (const peer of [...this.peers.values()]) this.drop(peer.id);
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
    this.rejectAccountRequests();
    this.connection = 'disabled';
  }

  rejectAccountRequests() {
    for (const request of this.accountRequests.values()) { clearTimeout(request.timer); request.reject(Error('The connection service disconnected before saving the change.')); }
    this.accountRequests.clear();
  }

  close() {
    this.stopped = true;
    clearInterval(this.sweep);
    this.disconnect();
    this.removeAllListeners();
  }
}

module.exports = { MobileAccess };
