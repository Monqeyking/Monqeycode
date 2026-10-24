# Browser and restore points

BrowserSkill's official DSH plugin is pinned to 0.3.3 in the web profile. Run
`node packages/monqey-code-workspace-tools/setup-browser.cjs` once to install the
checksum-verified Windows x64 CLI inside `vendor/browserskill`. No system PATH or
browser profile is changed. Settings → Browser links to the official Chrome/Edge (Brave can use the Chrome Web Store extension; runtime compatibility is unverified)
extension, which the user installs and connects. Use `/browser-skill` in a chat.
The plugin supplies its live browser preview and session controls. Monqey owns a
foreground daemon when no healthy daemon is present and stops its own child on
shutdown. Browser state stays under `storages/browser`. All browser actions require
Workspace Write except listing/stopping owned sessions. Existing shared-project
tool checks remain active. Windows x64 is the supported bundled platform.

Restore points appear in a tab beside Chat and Trajectory. Monqey captures
the target files before native file writes/edits, and attempts a bounded workspace
snapshot before shell/terminal tools,
then records the final hashes even if the tool fails. Only paths changed during
that action can be restored. Manual restore requires a fresh preview, explicit UI
confirmation, an idle writable workspace and matching final file hashes. Changed
shared metadata blocks old restores. A recovery snapshot is taken first. Neither
the conversation nor Git history is rewound. No model can invoke restore directly.

Snapshots are local to this installation under `storages/checkpoints`, with
deduplicated SHA-256 blobs, up to 20 retained points per workspace and a 512 MiB
retained preimage budget. An active capture can temporarily exceed the retained
budget by up to 256 MiB. Each scan is limited to 20,000 files / 256 MiB. Exceeding
that budget pauses whole-workspace terminal snapshots and reports limited coverage
in the UI; it never denies the underlying tool action. Targeted file-edit snapshots
continue independently of that pause. Retry automatic snapshots from Restore
points to clear the pause. All restore operations still require verified backups,
current file hashes, writable mode and idle agents/jobs. Generated
directories, dependencies, executables, `.env*`, credentials, `.git`, `.monqey`,
Monqey runtime data and symbolic links/junctions are excluded. Exclusions are
shown in the UI. Open a source folder rather than a disk root.
Media assets, binary content and individual files over 8 MiB are excluded too,
so a Unity project's textures and models do not fill the source backup budget.

Snapshots cover the registered workspace, not external shell writes or remote
website changes. Other processes and cloud sync are not transactionally locked:
hash checks reject observed newer edits, but cannot prevent an unseen cloud edit
that has not arrived yet. Shell snapshots record the tool's execution interval;
they cannot attribute a simultaneous external edit to a particular person. Select
files explicitly after reviewing the comparison; files are not preselected.
Background processes continuing after a tool returns are outside that interval.
Runtime-tracked background jobs block manual restore; an action that hands work
to such a job is left unfinalized instead of claiming a verified final snapshot.
A late conflict or disk failure can stop a multi-file
restore after some files; its error names the retained recovery point. Interrupted
actions without a verified final state cannot be restored. Backups may contain
private source text: protect the local user account and application folder.

Checks: `node --test packages/monqey-code-workspace-tools/test/*.test.mjs` and the
isolated runtime fixture. Physical extension interaction needs a connected
Chrome/Edge (Brave can use the Chrome Web Store extension; runtime compatibility is unverified) installation; a successful tool registration is not that proof.
