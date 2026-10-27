# Monqey composer layout

Local override of the MIT `@deepseek-ai/dsh-client-ui-conversation` 0.1.5-rc.2
package, following the existing chat/sidebar overrides. Keep its public exports,
editor, attachment handling, permissions and submission behavior intact.

The trailing composer row uses the real render order: existing right-side
extensions, context meter, model selector, `conversation.input.beforeSubmit`,
then the native Send/Stop action. Monqey dictation registers in the new additive
slot. Visual order and keyboard order therefore agree; no CSS ordering or DOM
reparenting is used. The microphone keeps automatic language detection.

The host settings schema resolves from the application's installed profile,
like the existing local runtime integrations. The profile dependency/lockfile
and startup link repair make this override survive restarts and relocation.
