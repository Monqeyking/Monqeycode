# Monqey Agent

Monqey Agent is an unofficial Monqey-branded desktop wrapper and profile customization for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The upstream DeepSeek Harness project remains the underlying application and is licensed under the MIT License. This repository contains Monqey's wrapper, visual branding, profile patches, local-model configuration examples, and integrations. It is not an official DeepSeek product and is not affiliated with DeepSeek.

## What is included

- `desktop-wrapper/` — Electron desktop wrapper for Monqey Agent.
- `packages/monqey-code-brand/` — Monqey visual identity, watermark, title, and Codex usage link.
- `packages/monqey-code-delegation/` — automatic worker routing, bounded recovery, usage and status cards.
- `packages/monqey-code-memory/` � local preferences, project knowledge and bounded learning reviews.
- `packages/monqey-code-cowork/` — workspace task boards shared by the UI and agent tools.
- `packages/monqey-code-ui-sidebar/` — native sidebar with Agents and Co-work navigation.
- `profiles/web/` — profile manifest, bundle patches, and lockfile.
- `settings.example.yaml` — example configuration for the local Qwen/MROC endpoint.

Runtime state, credentials, installed dependencies, model files, sessions, caches, and built executables are intentionally excluded from Git.

## Agents and Co-work (0.0.6)

Agents opens the existing conversations, model picker and Workers. Co-work
opens the selected workspace's board: To do, In progress, Waiting and Done.
Tasks have an owner, description, linked agent, dependencies, comments and
activity. Archive hides a task without deleting it; Archived lets you restore it.
Open agent and the task links above the composer connect both views.

In Act mode, agents can use `cowork_list_tasks`, `cowork_create_task`,
`cowork_update_task` and `cowork_add_comment`. List responses are bounded compact
summaries; supplying a task ID retrieves details. Updates require the revision
that was read. Stale writes fail; the UI retains its draft and offers Reload
latest. Plan/read-only agents cannot write, including during pending Plan entry.
Manual board edits remain available to the person using the app.

The board is local to one Monqey Agent runtime and its registered workspace.
It does not provide accounts, device synchronization or semantic conflict
detection between people's work. An owner is a label; assigning a task does not
start an agent or worker. Only task data is shared with the board, not private
conversation history. Storage is rooted at `storages/cowork/<workspace-id>.json`,
with atomic writes and bounded activity (300), tasks (2,000), comments per task
(100) and file size (16 MiB). Completed dependencies must remain Done while a
dependent is Done. Corrupt storage raises an error and is retained.

The portable is built under `desktop-wrapper/dist-cowork/`. Version 0.0.7 also
recreates missing local profile module links at startup, including Workers,
Co-work and the sidebar, so an absent link cannot prevent profile loading.
Fully quit the
previous app through its tray menu before opening the new version's shortcut;
closing the window leaves the previous process running in the tray.

## Local memory

Settings → Memory manages personal preferences, workspace facts and learned
workflows. Storage stays under `storages/memory/profiles/` inside the application
folder, separated by the local computer and OS account. Moving the application
folder on the same computer preserves its profile. Different model selections
use the same local memory; another local user/computer receives its own profile.
Personal memory and chats stay private. Shared project knowledge is opt-in;
see Shared project decisions below.

Agents can use `memory_search`, `memory_read`, `memory_save` and `memory_forget`.
Relevant context is limited to 3,200 characters plus its header. Workflows appear
as short references and load on demand; they are stored in this memory service,
not automatically exported into external `SKILL.md` directories. Project
entries can only be recalled from their own registered workspace. Read-only and
Plan sessions cannot write memory or run a learning review.

Automatic learning is enabled by default. After a completed turn with user
conversation evidence, one bounded, tool-free model request can extract up to
three lessons. No special keywords or tool actions are needed; the model may
return no lessons when nothing durable was learned. It uses the
current agent's model unless a separate live-catalog model is selected in
Memory settings. Defaults: at most 12,000 conversation characters and 1,000
output tokens; 45-second timeout, one concurrent review, five-minute cooldown
per active agent. A new turn or permission command cancels that agent's review.
Model requests cost tokens; provider-reported review usage is visible in
Learning activity. No automatic tasks or code changes execute during a review.

Memory proposals must reference supplied human/tool evidence. A workflow needs
a successful tool result; assistant-only claims cannot establish a lesson.
This checks provenance, not the semantic correctness of every learned claim.
Automatic reviews add new entries and preserve existing user edits. The UI
shows sources, editing and five previous versions. Forget removes saved content
and versions and retains only a fingerprint to suppress re-learning under the
same title. Existing conversation logs are not erased by forgetting a memory;
start a new agent when a clean context is needed. Credential-pattern screening
is best-effort, not a general sensitive-data classifier.

Limits: 300 active entries, 1,000 forgotten-title fingerprints, 20 review
records, and a 2 MiB profile file. Writes are atomic; stale edits fail and corrupt
storage is retained with an error. Review current agent manually processes a
bounded excerpt of an already opened conversation, including older conversations.
Fully quit Monqey Agent through the tray menu and reopen the existing shortcut
to load this module; no new desktop executable is required.

## Shared project decisions

Co-work > Shared project > Enable shared project opts a workspace into folder-based
knowledge sharing. Enable it once, let the .monqey folder sync, then open that
same folder on the other computer. Both computers need this Monqey version.
The project UUID is independent of either person's local workspace ID or path.
An AGENTS.md pointer is added without replacing existing instructions.

.monqey/project.json holds the stable identity. Individually published immutable
JSON events in .monqey/events/ hold proposals, confirmations and dismissals.
There is no mutable shared index: replicas rebuild the current decision graph.
Concurrent confirmed successors produce multiple heads and block project actions
until a person confirms one replacement incorporating all current heads. Missing
parents, corrupted data, unexpected cloud-conflict copies and changed identities
fail closed. Limits: 100 subjects/pending proposals, 2,000 events, 4 MiB event data.
The local storages/shared-project/bindings.json remembers known identities so
removing a known manifest does not silently turn enforcement off after restart.

Agent memory_save calls for project scope and automatic project lessons become
pending shared proposals. Personal preferences remain private; existing private
project notes are not uploaded and are excluded from agent recall once sharing
is active. Proposal reasons generated from memory do not copy raw chat evidence.
A person reviews and confirms proposals in Co-work. Agents have read/propose
tools, no approval tool. Replacements keep the same decision ID. Linked local
memory caches retain project ID, decision ID and version and follow confirmed
versions; they cannot be independently edited. Shared context remains available
when local personal memory is disabled.

The global pre-tool gate checks proposed actions against the full confirmed
snapshot, including terminals, unknown/plugin tools, delegation and workers.
It uses the configured learning model (otherwise the current agent model), no
tools, at most 32,000 input characters, 600 output tokens and a 30-second timeout.
Conflicting/uncertain responses, malformed responses and reviewer failures deny
the action. Runtime-owned grants are bound to an individual execution token and
snapshot; a final monotonic guard and dispatch check reject stale grants. These
checks run per action independently of the five-minute background memory cooldown
and add model requests. Read/propose and local memory tools are exempt from
semantic review but still validate shared storage and their own permissions.

This is app-level enforcement of known versions and model-assessed consistency,
not an OS sandbox or a proof that arbitrary code satisfies every prose decision.
Already-running actions are not rolled back when new cloud events arrive; unseen
remote updates remain subject to the cloud provider's synchronization delay.
Manual filesystem edits and tools outside Monqey are outside this gate. Team
accounts, cryptographic author verification and task-board device sync are not
provided by this feature. The Tasks tab remains local; only project knowledge
and decisions in .monqey are shared. Test shared-store merges with node --test
packages/monqey-code-memory/shared.test.mjs and the real tool pipeline with the
isolated runtime-smoke.cjs harness (test adapters, no paid model calls).

## Model catalogs

Providers are the connections; each connection supplies its own model list.
Enabled connections refresh their catalogs in the background at startup and
after connection or credential changes. The chat and Workers pickers share
these catalogs. Discovery preserves user model overrides and never changes
`agent-default-model`.

Qoder, Codex and Anthropic use their native catalog/authentication routes.
OpenAI-compatible and Anthropic Messages endpoints use their model-list API.
Endpoint results are cached under `storages/model-catalogs/` inside the app
root; startup always attempts a live refresh. A temporarily unavailable provider
keeps its last available catalog or configured models. Models settings shows
the refresh status. Protocols without a model-list API retain their installed
provider catalog.

## Local development

1. Install the DeepSeek Harness runtime using its upstream instructions.
2. Copy `settings.example.yaml` to `settings.yaml` and adjust the local model route if needed.
3. Install the web profile dependencies from `profiles/web`.
4. Run the web profile with the upstream DSH launcher.
5. Build the optional desktop wrapper from `desktop-wrapper`.

The local Qwen server should expose an OpenAI-compatible endpoint at `http://127.0.0.1:8080/v1`. The example is configured for a 131,072-token context window and keeps compaction room for local inference.

## Attribution

DeepSeek Harness: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — MIT License.

Monqey Agent adds the Monqey wrapper, branding, profile-layer changes, local-model defaults, and related integrations on top of that upstream project. Upstream notices and licenses must remain with any redistributed build.
