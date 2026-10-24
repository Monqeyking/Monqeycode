# Monqey Agent mobile protocol v1

This protocol connects the separate mobile client to the existing desktop agent
runtime. The desktop authorizes one phone key, not an IP address or device label.
The relay is a routable service; it does not decide which device may run commands.
The mobile repository has a native pairing preview. No public relay is configured
or deployed by the desktop build. Remote agent actions in the phone remain pending.

In wrapper 0.0.9, configure the actual service in Settings → Mobile Access.
Saving a new address disables access and cancels pending invitations; paired
devices must be revoked first. A saved profile setting takes precedence over
the environment and package defaults. Empty saved settings clear the service.

## Pair and reconnect

1. Desktop connects to `<relay>/v1/host`. Relay sends `{type:"challenge",nonce}`.
   Desktop responds `{type:"register",publicKey,signature}`. The signature covers
   `JSON.stringify(["monqey-mobile-v1","relay",hostId,nonce])`. Relay responds
   `{type:"registered"}`. `hostId` is SHA256 of the desktop public SPKI DER,
   encoded base64url without padding.
2. Sign-in prepares the QR automatically; an already signed-in user chooses
   **Show pairing code** to enable and connect in one action. Cancelling stops
   preparation. A random 256-bit secret remains valid for two minutes. The
   bundled service uses `https://monqey-agent-relay.onrender.com/pair#v=1&key=...&code=...`;
   fragments stay off the HTTP request. Android App Links open the mobile app,
   with a browser page and explicit Open Monqey Agent action as fallback.
   Custom services keep `monqeycode://pair?v=1&relay=...&key=...&code=...`. The client keeps
   the relay and pinned desktop key after pairing and discards the secret.
3. Phone connects to `<relay>/v1/device?host=<hostId>` and sends
   `{type:"hello",publicKey,ephemeralKey,name,platform}`. `platform` is `iOS` or
   `Android`; `name` is 1–80 characters without control characters. Public
   identity keys use P-256 SPKI DER/base64url; ephemeral keys use the uncompressed
   65-byte P-256 point/base64url. Phone private keys must stay in secure device
   storage. Both sides generate a fresh ephemeral key for every connection.
4. Relay assigns an unpredictable `peerId` and forwards messages to the host as
   `{type:"peer",peerId,payload}`. Host replies using
   `{type:"send",peerId,payload}`. The relay sends only that payload to the phone.
5. Desktop replies `{type:"challenge",nonce,peerId,ephemeralKey,signature}`. The
   signature covers the UTF-8 transcript:
   `JSON.stringify(["monqey-mobile-v1",hostId,peerId,nonce,deviceId,clientEphemeral,serverEphemeral])`.
   `deviceId` is the phone's SPKI SHA256/base64url. The phone verifies with the
   pinned desktop identity, never a new key supplied by the relay.
6. ECDH produces a shared secret. HKDF-SHA256 uses SHA256(transcript) as salt
   and UTF-8 `monqey-mobile-v1:device-to-host` or
   `monqey-mobile-v1:host-to-device` as info to derive two 32-byte AES keys.
7. All further messages are encrypted `{type:"packet",seq,data}`. Each direction
   starts at sequence 0 and accepts only the next sequence number. IV is four
   zero bytes followed by the sequence as an eight-byte unsigned big-endian
   integer. AAD is UTF-8 `${transcript}:${seq}`. `data` is base64url of ciphertext
   followed by its 16-byte GCM tag. ECDSA signatures use SHA256 and the 64-byte
   IEEE-P1363 encoding, base64url without padding.
8. The first encrypted phone message is
   `{type:"authenticate",signature,pairingSecret?}`. Its signature covers the same
   transcript. For initial pairing desktop sends `{type:"approval-pending"}`,
   waits for the local **Approve Phone** action, persists that phone's public
   key, then replies `{type:"ready",deviceId,protocol:"monqey-mobile-v1"}`. Known
   phones omit `pairingSecret` when reconnecting and still prove their key.

Cancel, deny, expiry, disabling, or revoking aborts pending authorization. The
desktop rechecks the pending peer, expiry, enabled state, and device limit when
the user approves. A second authenticated connection with the same phone key
replaces the older connection; a different phone key is refused while paired.

## Agent runtime transport

Send encrypted messages only after `ready`:

- `{type:"ping"}` at least every 20 seconds; desktop replies `{type:"pong"}`.
  An authenticated connection without traffic for 45 seconds is closed.
- `{type:"rpc",id,path,payload}` invokes the existing desktop POST `/api/<namespace>/<method>`.
  Supply the normal DSH carrier envelope as `payload`, not just business method
  arguments. Reply: `{type:"rpc-result",id,status,body}` or
  `{type:"rpc-error",id,message}`. The response body is the original DSH carrier
  JSON text. External URLs, query strings, and path normalization are refused.
- `{type:"stream-open"}` opens the existing local `/api/remote.mux` WebSocket.
  Wait for `{type:"stream-opened"}`. Send raw DSH mux text as
  `{type:"stream-send",data}`; receive `{type:"stream-data",data}`. Send
  `{type:"stream-close"}` to close; closure produces `{type:"stream-closed"}`.

Desktop supplies its existing authenticated DSH cookie only on the local hop.
It is never returned to the phone. Each connection has at most eight concurrent
RPCs and one stream. RPC results and stream frames are limited to 512 KiB; large
attachments need a separately designed chunked transfer and are not supported
by this first transport. Requests abort and streams close on revoke/disconnect.

After a connection loss the client must perform a fresh handshake, query current
session state, and reopen event subscriptions. Do not blindly retry mutating
requests whose response was lost. DSH ordinary forwarded events are not replayed.
Do not persist QR invites or display them in logs. Never mark a phone Connected
until desktop authentication and, if needed, approval have completed.
