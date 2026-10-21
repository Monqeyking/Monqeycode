# MonqeyCode provider and UI rules

These rules apply to changes in this workspace.

## Provider changes

- Trace provider work through the complete path: provider directory, Models settings dropdown, authentication flow, model catalog, composer selection, runtime route, and default-model configuration.
- OAuth-only providers must use their native Connect flow. Do not show an API-key field, endpoint field, or generic custom-model editor for them.
- Adding a provider must not silently change `agent-default-model` or the existing default model.
- Provider dropdowns and provider directories must be sorted alphabetically by visible display name, case-insensitively, with the provider id as a deterministic tie-breaker.
- A provider-specific usage panel must only render when that provider is the active model provider.

## Qoder contract

- Provider id: `qoder`.
- Authentication: Qoder OAuth/local Qoder Desktop session; no API key.
- Login guidance: never send the user to the Qoder homepage as if it were a login action; direct them to Qoder IDE's user icon → Sign in, or `qoder login` when the CLI is installed.
- Models and reasoning options must come from Qoder's live catalog. Do not hardcode model ids, names, aliases, or reasoning levels, and do not change the default model.
- The daily-credit button must state where claiming happens. Do not present a documentation link as an in-app claim action.
- Usage: show Qoder usage controls only while a Qoder model is active.

## Verification

- Preserve unrelated dirty work.
- Run syntax checks and `git diff --check` after edits.
- Verify the runtime provider directory and model route, not only source text.
- When a UI contract changes, report the exact user action needed after reload or restart.
