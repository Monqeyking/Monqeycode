const crypto = require('node:crypto');

const MAX_PACKET_BYTES = 1024 * 1024;
const PROTOCOL = 'monqey-mobile-v1';

function publicIdentity(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 256 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid device key.');
  const key = crypto.createPublicKey({ key: Buffer.from(encoded, 'base64url'), type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw new Error('Unsupported device key.');
  const canonical = key.export({ type: 'spki', format: 'der' });
  if (canonical.toString('base64url') !== encoded) throw new Error('Invalid device key.');
  return { key, encoded, id: crypto.createHash('sha256').update(canonical).digest('base64url') };
}

function createIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

function sign(privateKey, transcript) {
  return crypto.sign('sha256', Buffer.from(transcript), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}

function verify(publicKey, transcript, signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  return crypto.verify('sha256', Buffer.from(transcript), { key: publicIdentity(publicKey).key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
}

function handshakeTranscript(hostId, peerId, nonce, deviceId, clientEphemeral, serverEphemeral) {
  return JSON.stringify([PROTOCOL, hostId, peerId, nonce, deviceId, clientEphemeral, serverEphemeral]);
}

function relayTranscript(hostId, nonce) {
  return JSON.stringify([PROTOCOL, 'relay', hostId, nonce]);
}

function createEphemeral() {
  const key = crypto.createECDH('prime256v1');
  key.generateKeys();
  return { key, publicKey: key.getPublicKey().toString('base64url') };
}

// The relay only sees encrypted packets. Directional keys also prevent reflection.
function createChannel(ephemeral, remotePublicKey, transcript, isHost) {
  if (typeof remotePublicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(remotePublicKey)) throw new Error('Invalid connection key.');
  const secret = ephemeral.computeSecret(Buffer.from(remotePublicKey, 'base64url'));
  const salt = crypto.createHash('sha256').update(transcript).digest();
  const derive = label => Buffer.from(crypto.hkdfSync('sha256', secret, salt, Buffer.from(`${PROTOCOL}:${label}`), 32));
  const outbound = derive(isHost ? 'host-to-device' : 'device-to-host');
  const inbound = derive(isHost ? 'device-to-host' : 'host-to-device');
  let sent = 0;
  let received = 0;
  const iv = seq => { const bytes = Buffer.alloc(12); bytes.writeBigUInt64BE(BigInt(seq), 4); return bytes; };
  const aad = seq => Buffer.from(`${transcript}:${seq}`);
  return {
    seal(value) {
      const body = Buffer.from(JSON.stringify(value));
      if (body.length > MAX_PACKET_BYTES - 1024 || !Number.isSafeInteger(sent)) throw new Error('Message is too large.');
      const seq = sent++;
      const cipher = crypto.createCipheriv('aes-256-gcm', outbound, iv(seq));
      cipher.setAAD(aad(seq));
      const data = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
      return { type: 'packet', seq, data: data.toString('base64url') };
    },
    open(packet) {
      if (packet?.type !== 'packet' || packet.seq !== received || !Number.isSafeInteger(received) || typeof packet.data !== 'string' || packet.data.length > MAX_PACKET_BYTES * 1.4 || !/^[A-Za-z0-9_-]+$/.test(packet.data)) throw new Error('Invalid or replayed message.');
      const bytes = Buffer.from(packet.data, 'base64url');
      if (bytes.length < 16 || bytes.length > MAX_PACKET_BYTES) throw new Error('Invalid message.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', inbound, iv(received));
      decipher.setAAD(aad(received));
      decipher.setAuthTag(bytes.subarray(-16));
      const body = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
      const value = JSON.parse(body.toString('utf8'));
      received++;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid message.');
      return value;
    }
  };
}

function relayUrl(value) {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Mobile access requires a secure connection service URL.');
  return url.origin.replace(/^http/, 'ws');
}

module.exports = { MAX_PACKET_BYTES, PROTOCOL, publicIdentity, createIdentity, sign, verify, handshakeTranscript, relayTranscript, createEphemeral, createChannel, relayUrl };
