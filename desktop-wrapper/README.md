# Monqey Agent desktop wrapper

This wrapper starts the existing DSH web profile and displays its local URL in an Electron window.

On Windows, closing the window hides Monqey Agent in the system tray after a one-time notice. DSH tasks keep running until you choose **Quit Monqey Agent** from the tray menu. If Monqey reports active work or cannot confirm task status, quitting asks before stopping DSH. Click the tray icon or choose **Open Monqey Agent** to return to the session.

Pending approvals and questions show a red taskbar count until answered or cancelled.
When the app is in the background, a Windows notification opens Monqey Agent when clicked.
These reminders follow Settings → Notifications → input and desktop notification preferences.

## Build

```powershell
npm install
npm run build
```

The portable executable is written to `dist-mobile-access`. Reuse this output
directory for subsequent builds rather than creating a new `dist-*` directory
for each experiment.

## Application folder

The `Monqey-Agent` folder is the portable application root. Development resolves
it from this wrapper; a packaged executable finds it by walking up from its
original executable location, including when the portable launcher extracts
Electron into a temporary directory. The root is identified by
`profiles/web/package.json` and `desktop-wrapper/package.json`, not by a fixed
folder name, drive, username, working directory, or AppData location.

Keep the executable inside this root, normally in
`desktop-wrapper/dist-mobile-access`. `MONQEY_HOME` can explicitly select another
application root. A missing root produces an error instead of silently opening
an empty user profile elsewhere. The desktop sets `DSH_HOME` to this same root.

Existing chats, attachments, settings, credentials and paired devices stay in
their current root-relative locations. Runtime dependencies remain in `profiles`
and `npm-cache`, browser/device data in `electron-data`, and startup/Electron logs
in `logs`. `local-appdata` contains the runtime's local application data. These
locations are defined centrally in `paths.cjs`.

This does not move existing data. At launch, broken dependency junctions into
the installation's own npm cache and declared local packages are reconnected to
their counterparts in the current root. Working links and external dependencies
are left alone; missing packages still require installation. Restart
via **Quit Monqey Agent** in the tray and open a build containing this change;
refreshing the web page does not update the desktop launcher.

The desktop build also carries the official Qoder Agent runtime and CLI login
helper. End users do not need to install Qoder or Node.js separately for the
Qoder provider; the first **Connect Qoder** action opens Qoder's browser login.

## Mobile Access

The English **Settings → Mobile Access** section is backed by desktop-only IPC.
It supports one phone, a two-minute QR invitation, explicit desktop approval,
device name/platform, live Connected/Offline state, last seen, and immediate
revocation. Switching access off disconnects the phone but retains its pairing;
**Revoke Access** forgets it. Pair again to authorize a replacement phone.

This is the desktop side and the relay implementation, not a released mobile app.
There is no production connection service configured in this repository. The
shipped UI reports **Not configured** and disables pairing until a service is
provided. It does not claim that a phone is connected merely because the relay is
reachable. No router configuration or VPN is part of the intended user flow.

For release engineering, deploy `mobile-relay.cjs` behind an HTTPS reverse proxy
with WebSocket upgrades, connection/rate limits, and normal service monitoring.
It listens only on `127.0.0.1` (`PORT`, default 8787); `/health` is its health check.
Set `mobileAccessRelayUrl` in the desktop package manifest before building, e.g.
a provisioned `wss://` origin, to make the service built in for end users.
`MONQEY_MOBILE_RELAY_URL` overrides this for development. Plain `ws://` is accepted
only for loopback tests. No production endpoint is invented or contacted by
default. The mobile client and real-phone/Internet validation remain to be done.

The relay authenticates the computer's P-256 key and routes bounded packets.
Desktop/phone establish fresh P-256 ECDH keys; HKDF-SHA256 derives separate
AES-256-GCM keys for each direction. Both sides sign the handshake and the phone
pins the desktop key from its QR invitation. Sequence numbers reject replay.
The pairing secret is sent inside the encrypted channel and is insufficient
without desktop approval. The relay never receives the plaintext invite secret,
agent messages, or the desktop DSH cookie. Desktop identity keys are encrypted
with Electron safeStorage in the ignored `electron-data/mobile-access.json`.
There is no plaintext-storage fallback. Device labels are supplied by the phone;
the displayed key fingerprint is the identity checked by the desktop.

Run `npm run test:mobile` for the encrypted phone/relay/runtime integration and
the settings/IPC checks. These use a simulated phone and disposable local state;
they do not send a model prompt or change provider/default-model settings.

The mobile wire contract is described in [MOBILE_PROTOCOL.md](MOBILE_PROTOCOL.md).
After rebuilding, choose **Quit Monqey Agent** in the tray, open the new executable,
then open **Settings → Mobile Access**. A page refresh alone cannot update the
desktop IPC bridge or start a connection service.
