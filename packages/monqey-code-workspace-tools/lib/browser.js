export function browserDenial(exec, writable) {
  if (!exec.name.startsWith('bsk_')) return;
  if (exec.name === 'bsk_session' && ['stop', 'list'].includes(exec.arguments?.action)) return;
  // Browser reads can expose accounts outside the workspace too: the entire browser requires write mode.
  if (!exec.agent || !writable(exec.agent)) return 'Browser access is unavailable in Read-only or Plan mode. Use Workspace Write first. You can still stop an existing browser session.';
}
