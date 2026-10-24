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

The portable executable is written to `dist-cowork`. Reuse this output
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
`desktop-wrapper/dist-cowork`. `MONQEY_HOME` can explicitly select another
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

This is the desktop side and the relay implementation. The separate mobile
repository has a 0.2.0 native QR/pairing preview; agent actions are not connected yet.
There is no production connection service configured in this repository. The
shipped UI reports **Not configured** and disables pairing until a service is
provided. It does not claim that a phone is connected merely because the relay is
reachable. No router configuration or VPN is part of the intended user flow.

For release engineering, deploy `mobile-relay.cjs` behind an HTTPS reverse proxy
with WebSocket upgrades, connection/rate limits, and normal service monitoring.
It listens only on `127.0.0.1` (`PORT`, default 8787); `/health` is its health check.
In wrapper 0.0.9, enter the actual WSS origin in **Connection service address**
and choose **Save connection service**. It is persisted in the current user
profile; changing it cancels invitations and disables access. A paired phone must
be revoked first. Enable access, wait for the service to connect, then choose
**Pair Phone**. The Android app scans the QR; compare the device keys and approve
locally. No service is deployed automatically.

`mobileAccessRelayUrl` in the package manifest provides an optional build default.
`MONQEY_MOBILE_RELAY_URL` overrides that default for development. A saved setting
takes precedence over both; saving an empty address explicitly clears the service.
Plain `ws://` is accepted
only for loopback tests. No production endpoint is invented or contacted by
default. Real-phone/Internet validation remains to be done.

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

`npx electron mobile-native-smoke.cjs` additionally checks the actual isolated
preload/IPC flow, secure native identity storage, relay connection and 320px QR
rendering. It uses a disposable profile and never starts the user's runtime.

The mobile wire contract is described in [MOBILE_PROTOCOL.md](MOBILE_PROTOCOL.md).
After rebuilding, choose **Quit Monqey Agent** in the tray, open the new executable,
then open **Settings → Mobile Access**. A page refresh alone cannot update the
desktop IPC bridge or start a connection service.
# Browser and restore points (0.0.15)

Settings → Browser connects the pinned official BrowserSkill integration to Chrome
or Edge. Brave uses the same Chrome Web Store extension; verify its connection before relying on it. Install its browser extension once, enable the extension's local
connection and select **Check connection**. Use `/browser-skill` in an agent.
Browser access requires Workspace Write; the agent's owned browser sessions have
upstream live previews and stop controls. Local browser state stays inside
`Monqey-Agent/storages/browser`; the CLI lives in `vendor/browserskill`.

**Restore points** above the composer capture registered workspace source files
around agent edits and terminal actions. File edits use targeted snapshots. If a
workspace is too large for a terminal snapshot, the terminal action continues and
the UI reports limited coverage; targeted file snapshots remain available.
Preview, compare and explicitly select
files before restoring. Newer file hashes, changed shared metadata, active agents
and read-only mode block restoration. A recovery point is captured first. Cloud
edits that have not synced yet cannot be detected. These points restore files,
not conversation history or changes made to websites. See
`packages/monqey-code-workspace-tools/README.md` for exclusions and storage limits.

After updating, quit through the tray menu and reopen the desktop shortcut. The
running app is not forcibly restarted by the update.

## Windows shortcuts (0.0.16)

After a portable build, `shortcuts-setup.cjs` repairs the Monqey Start-menu entry
and existing Monqey desktop/taskbar shortcuts with the original portable EXE,
its embedded icon and AppUserModelID `com.monqey.code`. Packaged app startup
performs the same check before creating a window or showing notifications.
Development Electron launches and extracted executables outside the application
root cannot register themselves. Missing desktop/taskbar entries are not created
or pinned. Existing legacy Monqey Code links are kept working as aliases.

Every changed link is backed up under `electron-data/shortcut-backups`; unchanged
links are not rewritten. Updates are read back using Windows' native shortcut
API. Startup repair failures are logged and do not interrupt agent work; the
post-build repair reports failure so a build cannot silently claim valid links.
