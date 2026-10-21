# Monqey Agent

Monqey Agent is an unofficial Monqey-branded desktop wrapper and profile customization for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The upstream DeepSeek Harness project remains the underlying application and is licensed under the MIT License. This repository contains Monqey's wrapper, visual branding, profile patches, local-model configuration examples, and integrations. It is not an official DeepSeek product and is not affiliated with DeepSeek.

## What is included

- `desktop-wrapper/` — Electron desktop wrapper for Monqey Agent.
- `packages/monqey-code-brand/` — Monqey visual identity, watermark, title, and Codex usage link.
- `packages/monqey-code-delegation/` — automatic worker routing, bounded recovery, usage and status cards.
- `profiles/web/` — profile manifest, bundle patches, and lockfile.
- `settings.example.yaml` — example configuration for the local Qwen/MROC endpoint.

Runtime state, credentials, installed dependencies, model files, sessions, caches, and built executables are intentionally excluded from Git.

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
