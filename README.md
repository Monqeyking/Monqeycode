# Monqey Code

Monqey Code is an unofficial Monqey-branded desktop wrapper and profile customization for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The upstream DeepSeek Harness project remains the underlying application and is licensed under the MIT License. This repository contains Monqey's wrapper, visual branding, profile patches, local-model configuration examples, and integrations. It is not an official DeepSeek product and is not affiliated with DeepSeek.

## What is included

- `desktop-wrapper/` — Electron desktop wrapper for Monqey Code.
- `packages/monqey-code-brand/` — Monqey visual identity, watermark, title, and Codex usage link.
- `profiles/web/` — profile manifest, bundle patches, and lockfile.
- `settings.example.yaml` — example configuration for the local Qwen/MROC endpoint.

Runtime state, credentials, installed dependencies, model files, sessions, caches, and built executables are intentionally excluded from Git.

## Local development

1. Install the DeepSeek Harness runtime using its upstream instructions.
2. Copy `settings.example.yaml` to `settings.yaml` and adjust the local model route if needed.
3. Install the web profile dependencies from `profiles/web`.
4. Run the web profile with the upstream DSH launcher.
5. Build the optional desktop wrapper from `desktop-wrapper`.

The local Qwen server should expose an OpenAI-compatible endpoint at `http://127.0.0.1:8080/v1`. The example is configured for a 131,072-token context window and keeps compaction room for local inference.

## Attribution

DeepSeek Harness: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — MIT License.

Monqey Code adds the Monqey wrapper, branding, profile-layer changes, local-model defaults, and related integrations on top of that upstream project. Upstream notices and licenses must remain with any redistributed build.
