# Monqey chat presentation

Local override of `@deepseek-ai/dsh-client-ui-chat` 0.1.5-rc.2 (upstream MIT).
The web profile resolves this package in the same way as the existing sidebar
override. Keep its public exports and native conversation features intact.

Monqey changes: the activity component renders **Scratching head…** with Monqey
theme colors only while the live assistant tail is a reasoning block and no tool
is executing. First-token waits, retries, tools and answer text do not render
this indicator. This uses stream state even in compact/collapsed transcripts.
The branding plugin no longer edits React-owned status text through an observer.

When updating the upstream bundle, retain these changes and run
`node --test packages/monqey-code-ui-chat/thinking.test.cjs` and the Electron
`desktop-wrapper/thinking-status-smoke.cjs` check.
