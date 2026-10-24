import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Checkpoints } from './checkpoints.js';
import { browserDenial } from './browser.js';
import { sessionIdentifier } from '../../monqey-code-memory/lib/identifiers.js';
const home = process.env.DSH_HOME || process.cwd();
async function runtime(name) {
  for (const directory of ['web', '']) {
    try { const resolved = createRequire(path.join(home, 'profiles', directory, 'package.json')).resolve(name); return await import(pathToFileURL(resolved).href); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw Error(`Workspace tools cannot resolve ${name}.`);
}
const { TypertRemoteService } = await runtime('@deepseek-ai/dsh-typert-protocol');
const { z } = await runtime('zod');
const run = promisify(execFile);
export const name = 'monqey-workspace-tools';
export const inject = ['tools', 'workspaceRegistry', 'sessionProjections', 'shell', 'typert', 'agents', 'jobs'];
export function apply(ctx) {
  const store = new Checkpoints(home), busy = new Set(), pending = new Map(), approvals = new Map(), coverage = new Map();
  const executable = path.join(home, 'vendor', 'browserskill', process.platform === 'win32' ? 'bsk.exe' : 'bsk');
  process.env.BSK_HOME = path.join(home, 'storages', 'browser');
  process.env.BSK_AUTO_START = '0';
  let daemon, daemonError = '';
  const environment = () => ({ ...process.env, BSK_HOME: path.join(home, 'storages', 'browser'), BSK_AUTO_START: '0' });
  // Reuse a healthy daemon; otherwise own one foreground child so Windows Job Objects do not break detach.
  const ready = (async () => {
    if (!fs.existsSync(executable)) { daemonError = 'Browser component is missing. Run the workspace-tools setup script.'; return; }
    try { await run(executable, ['status', '--json'], { env: environment(), windowsHide: true, timeout: 4000 }); return; } catch {}
    daemon = spawn(executable, ['daemon', 'start', '--foreground'], { env: environment(), windowsHide: true, stdio: 'ignore' });
    daemon.on('error', error => { daemonError = error.message; });
    daemon.on('exit', code => { if (code) daemonError = `Browser service stopped (${code}).`; });
  })();
  ctx.effect(() => () => { daemon?.kill(); approvals.clear(); });
  function writable(agent) {
    const permissions = ctx.sessionProjections.stateOf(agent.session, 'permissions'), plan = ctx.sessionProjections.stateOf(agent.session, 'plan');
    return !!permissions && !!plan && !plan.active && plan.wanted !== true && plan.running?.wanted !== true && ['workspace-write', 'danger-full-access'].includes(permissions.sandbox ?? ctx.shell.sandboxMode);
  }
  const owned = agent => {
    const cwd = agent?.session.header.cwd; if (!cwd) return;
    const absolute = path.resolve(cwd);
    return ctx.workspaceRegistry.list().filter(item => { const rest = path.relative(item.path, absolute); return !rest.startsWith('..') && !path.isAbsolute(rest); }).sort((a,b) => b.path.length-a.path.length)[0];
  };
  ctx.tools.guard(exec => browserDenial(exec, writable));
  const mutation = exec => /(?:write|edit|patch|bash|pwsh|shell|exec|delete|remove|move|rename)/i.test(exec.name) || exec.name === 'bsk_interact' && exec.arguments?.action === 'download';
  const runningJobs = agent => ctx.jobs.list(agent).some(job => job.status === 'running' || job.status === 'stopping');
  function capture(exec, target) {
    if (!exec?.agent || pending.has(exec) || !writable(exec.agent)) return;
    const workspace = owned(exec.agent); if (!workspace) return;
    const file = target ?? exec.arguments?.file_path;
    const targets = typeof file === 'string' ? [path.resolve(exec.agent.session.header.cwd,file)] : undefined;
    if (!targets && coverage.has(workspace.id)) return;
    const skipped = reason => { if (!coverage.has(workspace.id)) ctx.logger.warn(`Automatic restore point unavailable: ${reason}. The tool action continues without that snapshot.`); coverage.set(workspace.id,reason); };
    if (busy.has(workspace.id)) {
      for (const current of pending.values()) if (current.workspaceId === workspace.id) current.overlapped = true;
      skipped('Concurrent tool actions cannot be attributed safely'); return;
    }
    busy.add(workspace.id);
    try { pending.set(exec, { workspaceId: workspace.id, row: store.capture(workspace, exec.agent.id, exec.name, targets) }); }
    catch (error) { busy.delete(workspace.id); skipped(error.message); }
  }
  for (const event of ['fs/write-intent', 'fs/edit-intent']) ctx.on(event, async (target, actor, next) => { capture(actor,target.displayPath); return next(); }, { prepend: true });
  ctx.on('tools/execute', async (exec, next) => {
    const denial = browserDenial(exec, writable); if (denial) throw Error(denial);
    if (mutation(exec)) capture(exec);
    try { return await next(); }
    finally {
      const current = pending.get(exec);
      if (current) {
        try {
          if (current.overlapped || runningJobs(exec.agent)) store.active.delete(current.row.id);
          else store.finish(current.row);
        }
        catch (error) { store.active.delete(current.row.id); coverage.set(current.workspaceId,error.message); ctx.logger.warn(`Checkpoint ${current.row.id} could not be finalized: ${error.message}. It cannot be restored.`); }
        finally { pending.delete(exec); busy.delete(current.workspaceId); }
      }
    }
  });
  function session(sessionId, write = false) {
    const agent = ctx.agents.get(sessionId); if (!agent) throw Error('Open this agent before viewing its restore points.');
    const workspace = owned(agent); if (!workspace) throw Error('Open a registered workspace first.');
    if (write) {
      if (!writable(agent)) throw Error('Restore is unavailable in Read-only or Plan mode.');
      if (busy.has(workspace.id) || ctx.agents.list().some(other => owned(other)?.id === workspace.id && (other.status !== 'idle' || runningJobs(other)))) throw Error('Stop the agents and background jobs working in this workspace before restoring files.');
    }
    return { agent, workspace };
  }
  class WorkspaceTools extends TypertRemoteService {
    constructor(owner) { super(owner, 'workspaceTools'); }
    status(sessionId) { const { workspace } = session(sessionId); return { limited:coverage.has(workspace.id), reason:coverage.get(workspace.id) ?? '' }; }
    retry(sessionId) { const { workspace } = session(sessionId); coverage.delete(workspace.id); return this.status(sessionId); }
    list(sessionId) {
      const { workspace } = session(sessionId);
      return store.list(workspace.id, sessionId).map(row => ({ id: row.id, label: row.label, at: row.at, ready: !!row.after, changed: store.changes(row).length, skipped: row.skipped }));
    }
    preview(sessionId, checkpointId) {
      const { workspace } = session(sessionId), preview = store.preview(workspace, sessionId, checkpointId);
      for (const [token, value] of approvals) if (value.expires < Date.now()) approvals.delete(token);
      const token = randomUUID(); approvals.set(token, { sessionId, checkpointId, expires: Date.now()+300000 });
      return { token, files: preview.files, sharedChanged: preview.sharedChanged };
    }
    diff(sessionId, checkpointId, file) {
      const { workspace } = session(sessionId);
      return store.diff(workspace, sessionId, checkpointId, file);
    }
    restore(sessionId, token, files) {
      const grant = approvals.get(token); approvals.delete(token);
      if (!grant || grant.expires < Date.now() || grant.sessionId !== sessionId) throw Error('Restore preview expired. Preview the files again.');
      const { workspace } = session(sessionId, true);
      busy.add(workspace.id);
      try { return store.restore(workspace, sessionId, grant.checkpointId, files); }
      finally { busy.delete(workspace.id); }
    }
    async browser() {
      await ready;
      try {
        const { stdout } = await run(executable, ['doctor', '--json'], { env: environment(), windowsHide: true, timeout: 10000, maxBuffer: 128*1024 });
        return { checks: JSON.parse(stdout), error: daemonError };
      } catch (error) {
        try { return { checks: JSON.parse(error.stdout), error: daemonError }; } catch {}
        return { checks: [], error: daemonError || 'Browser service is unavailable. Check the local BrowserSkill installation.' };
      }
    }
  }
  new WorkspaceTools(ctx);
  const id = z.string().uuid(), sessionIdSchema = z.string().max(44).refine(value => { try { sessionIdentifier(value); return true; } catch { return false; } }, 'Invalid session identifier.'), record = z.record(z.string(), z.unknown());
  const descriptor = (method, parameters, result) => ({ id: `monqey-code-workspace-tools#workspaceTools/${method}`, service: 'workspaceTools', namespace: 'workspaceTools', method, invocation: { kind: 'direct' }, parameters: parameters.map(([key,schema]) => ({ name:key,wire:key,source:'json',codec:{mode:'strict',typeSymbol:`workspaceTools/${method}:${key}`,schema} })), result:{mode:'strict',typeSymbol:`workspaceTools/${method}:result`,schema:result} });
  ctx.effect(() => ctx.typert.register({ package:'monqey-code-workspace-tools',face:'host',schemas:[],model:{services:[],objects:[],events:[]},invocations:[
    descriptor('status', [['sessionId',sessionIdSchema]],record),
    descriptor('retry', [['sessionId',sessionIdSchema]],record),
    descriptor('list', [['sessionId',sessionIdSchema]], z.array(record)),
    descriptor('preview', [['sessionId',sessionIdSchema],['checkpointId',id]], record),
    descriptor('diff', [['sessionId',sessionIdSchema],['checkpointId',id],['file',z.string().min(1).max(1000)]],record),
    descriptor('restore', [['sessionId',sessionIdSchema],['token',id],['files',z.array(z.string().min(1).max(1000)).min(1).max(100)]],record),
    descriptor('browser', [], record)
  ] }));
}
