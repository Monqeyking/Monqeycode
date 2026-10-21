import { randomUUID } from 'node:crypto';

export const defaults = {
  enabled: false,
  worker: { provider: '', model: '' },
  fallback: { provider: '', model: '' },
  taskTokenLimit: 100000,
  outputTokenLimit: 4096
};
const active = new Set(['starting', 'running', 'recovering']);
export const isActive = task => active.has(task.status);
export const sameRoute = (a, b) => a.provider === b.provider && a.model === b.model;
export const totalTokens = usage => Object.values(usage ?? {}).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0);
export const emptyUsage = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export function addUsage(a, b) {
  return Object.fromEntries(Object.keys(emptyUsage()).map(key => [key, (a?.[key] ?? 0) + (b?.[key] ?? 0)]));
}
export const publicTask = ({ prompt, ...task }) => task;
const text = blocks => (blocks ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');

// The runtime owns sessions, cancellation and provider retries. This manager owns
// admission, route choice and one fallback; it never reimplements an agent loop.
export class DelegationManager {
  constructor(io) {
    this.io = io;
    this.tasks = new Map();
    this.children = new Map();
    this.pending = new Set();
    this.closed = false;
  }
  track(promise) {
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise)).catch(() => {});
    return promise;
  }
  save(task) {
    this.io.save(task.parentId, structuredClone(task));
  }
  restore(parentId, records) {
    for (const record of records) {
      if (this.tasks.has(record.id)) continue;
      const task = structuredClone(record);
      this.tasks.set(task.id, task);
      for (const attempt of task.attempts) this.children.set(attempt.childId, task);
      if (isActive(task)) {
        task.status = 'interrupted';
        task.detail = 'App restarted. Inspect the previous child and workspace before continuing; work was not replayed.';
        this.save(task);
      }
    }
  }
  async start(parent, args, signal) {
    if (this.closed) throw new Error('Delegation is shutting down.');
    const config = structuredClone(this.io.settings());
    if (!config.enabled) throw new Error('Automatic delegation is disabled in Settings → Workers.');
    if (parent.session.header.origin === 'subagent') throw new Error('Workers cannot delegate further.');
    if (!config.worker.provider || !config.worker.model) throw new Error('Choose a worker model in Settings → Workers.');
    if (typeof args.description !== 'string' || !args.description.trim() || args.description.length > 120) throw new Error('Use a short task description (1–120 characters).');
    if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 12000) throw new Error('Provide a self-contained task of 1–12000 characters; pass relevant context, not the full conversation.');
    if ([...this.tasks.values()].filter(task => task.parentId === parent.id && isActive(task)).length >= 2) throw new Error('Two workers are already active. Wait for a result or stop one.');
    signal.throwIfAborted();
    // Reserve synchronously, before catalog lookups or child creation can race.
    const task = {
      id: randomUUID(), parentId: parent.id, description: args.description.trim(), prompt: args.prompt,
      status: 'starting', detail: '', output: '', attempts: [], usage: emptyUsage(),
      worker: config.worker, fallback: config.fallback,
      tokenLimit: config.taskTokenLimit, outputLimit: config.outputTokenLimit,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    this.tasks.set(task.id, task);
    this.save(task);
    try {
      const blocked = [...this.tasks.values()].some(previous => previous.parentId === parent.id && previous.attempts.some(attempt => attempt.provider === config.worker.provider && attempt.failure === 'QUOTA'));
      if (blocked) {
        if (!config.fallback.provider || config.fallback.provider === config.worker.provider) throw new Error('Worker account quota is exhausted. Choose a reserve on another provider or start a fresh chat after its quota resets.');
        await this.launch(task, parent, config.fallback, signal);
      } else await this.launch(task, parent, config.worker, signal);
    } catch (error) {
      // A validation/auth/start error has not produced child work. A distinct
      // preselected reserve route may still be available without the parent LLM.
      task.detail = String(error.message ?? error).slice(0, 1000);
      if (!signal.aborted && !task.attempts.some(attempt => sameRoute(attempt, config.fallback)) && !sameRoute(config.worker, config.fallback) && config.fallback.provider && config.fallback.model) {
        task.status = 'recovering';
        this.save(task);
        try { await this.launch(task, parent, config.fallback, signal); }
        catch (fallbackError) { this.fail(task, fallbackError); }
      } else this.fail(task, error);
    }
    return publicTask(structuredClone(task));
  }
  async launch(task, parent, route, signal) {
    if (this.closed || !this.io.settings().enabled) throw new Error('Delegation disabled.');
    signal.throwIfAborted();
    await this.io.validateRoute(route, signal);
    signal.throwIfAborted();
    if (this.closed || !this.io.settings().enabled) throw new Error('Delegation disabled.');
    if (this.io.parent(parent.id) !== parent) throw new Error('Parent chat is no longer active.');
    const childId = randomUUID();
    const attempt = { childId, ...route, status: 'starting', usage: emptyUsage(), failure: '', checkpoint: '' };
    task.attempts.push(attempt);
    this.children.set(childId, task);
    task.status = 'starting';
    task.updatedAt = Date.now();
    this.save(task);
    const previous = task.attempts.slice(0, -1).map(item => `${item.childId}: ${item.status}; ${item.failure}\n${item.checkpoint}`).join('\n').slice(-6000);
    const prompt = `${task.prompt}\n\nWork only on this task. Share this workspace and obey its instructions and permission policy. Do not spawn other workers. Report findings, changed files, checks and remaining work concisely. Do not repeat completed actions: inspect current files and previous work first.\n${previous ? `Previous attempt checkpoints (partial work, not a success report):\n${previous}` : ''}`;
    try {
      await this.io.spawn({ parent, childId, description: task.description, prompt, route,
        maxTokens: Math.min(task.outputLimit, Math.max(1, task.tokenLimit - totalTokens(task.usage))), signal });
      // A very fast child may settle before startContinuable resolves.
      if (attempt.status === 'starting') {
        attempt.status = 'running';
        task.status = 'running';
        this.save(task);
      }
    } catch (error) {
      attempt.status = 'failed';
      attempt.failure = String(error.code ?? 'START_FAILED');
      task.updatedAt = Date.now();
      this.save(task);
      throw error;
    }
  }
  fail(task, error) {
    task.status = 'failed';
    task.detail = String(error.message ?? error).slice(0, 1000);
    task.updatedAt = Date.now();
    this.save(task);
  }
  updateChild(childId, usage, checkpoint) {
    const task = this.children.get(childId);
    if (!task) return;
    const attempt = task.attempts.find(item => item.childId === childId);
    attempt.usage = structuredClone(usage);
    if (checkpoint) attempt.checkpoint = checkpoint.slice(-6000);
    task.usage = task.attempts.reduce((sum, item) => addUsage(sum, item.usage), emptyUsage());
    task.updatedAt = Date.now();
    this.save(task);
  }
  noteFailure(childId, code) {
    const task = this.children.get(childId);
    if (!task) return;
    task.attempts.find(attempt => attempt.childId === childId).failure = code;
    this.save(task);
  }
  admission(childId) {
    const task = this.children.get(childId);
    if (!task) return;
    if (task.status === 'completed' && task.attempts.at(-1)?.childId === childId && this.io.settings().enabled) {
      if (this.io.canResume && !this.io.canResume(task)) return 'This task is outside the recent worker index. Start a new managed task.';
      if (totalTokens(task.usage) >= task.tokenLimit) return 'Worker token budget reached. Start a new task if further work is needed.';
      if ([...this.tasks.values()].filter(other => other.parentId === task.parentId && isActive(other)).length >= 2) return 'Two workers are already active.';
      task.status = 'running';
      task.attempts.at(-1).status = 'running';
      task.detail = 'Continuing with the same cumulative token budget.';
      this.save(task);
    }
    if (!isActive(task)) return 'This worker task has ended. Start a new managed task for further work.';
    if (!this.io.settings().enabled) return 'Automatic delegation was disabled.';
    if (totalTokens(task.usage) >= task.tokenLimit) return 'Worker token budget reached (includes previous attempts and cache usage).';
  }
  stop(childId, reason) {
    const task = this.children.get(childId);
    if (!task || !isActive(task)) return;
    task.status = reason === 'budget' ? 'budget' : reason === 'timeout' ? 'timeout' : 'stopped';
    task.detail = reason === 'budget' ? 'Token budget reached. No further worker requests will start.' : reason === 'timeout' ? 'Model request made no progress for 10 minutes.' : 'Worker stopped.';
    this.save(task);
    this.io.interrupt(childId, task.parentId);
  }
  async settle(info, failure = '') {
    const task = this.children.get(info.id);
    if (!task) return;
    const attempt = task.attempts.find(item => item.childId === info.id);
    if (!['starting', 'running'].includes(attempt.status)) return;
    attempt.status = info.stopReason;
    failure = failure || attempt.failure;
    attempt.failure = failure;
    const closing = text(info.lastAssistantMessage).slice(0, 12000);
    task.output = closing;
    task.updatedAt = Date.now();
    if (!isActive(task)) { this.save(task); return; }
    if (info.stopReason === 'completed') {
      task.status = 'completed';
      task.detail = 'Worker finished. The main model reviews its result.';
    } else if (info.stopReason === 'aborted' || info.stopReason === 'refusal') {
      task.status = info.stopReason === 'aborted' ? 'stopped' : 'refused';
      task.detail = `Worker ended: ${info.stopReason}.`;
    } else if (totalTokens(task.usage) >= task.tokenLimit) {
      task.status = 'budget';
      task.detail = 'Task budget reached; reserve model was not started.';
    } else {
      const reserve = task.fallback;
      // QUOTA commonly applies to the account, so another model on that same
      // provider is not a reliable escape. Never cycle through the blocked pool.
      const exhausted = task.attempts.some(item => sameRoute(item, reserve) || (failure === 'QUOTA' && item.provider === reserve.provider));
      const parent = this.io.parent(task.parentId);
      if (!this.closed && this.io.settings().enabled && reserve.provider && reserve.model && !exhausted && parent) {
        task.status = 'recovering';
        task.detail = `${failure || info.stopReason}; starting the reserve model once. Checkpoints and usage are retained.`;
        this.save(task);
        try { await this.launch(task, parent, reserve, new AbortController().signal); }
        catch (error) { this.fail(task, error); }
        return;
      }
      task.status = 'failed';
      task.detail = `${failure || info.stopReason}. Main model can inspect partial work and take over; no reserve retry remains.`;
    }
    this.save(task);
  }
  async dispose() {
    this.closed = true;
    for (const task of this.tasks.values()) if (isActive(task)) this.stop(task.attempts.at(-1)?.childId, 'stopped');
    await Promise.allSettled([...this.pending]);
  }
  forget(parentId) {
    for (const task of this.tasks.values()) if (task.parentId === parentId && !isActive(task)) {
      for (const attempt of task.attempts) this.children.delete(attempt.childId);
      this.tasks.delete(task.id);
    }
  }
}
