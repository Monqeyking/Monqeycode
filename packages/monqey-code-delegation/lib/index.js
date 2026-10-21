import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DelegationManager, defaults, emptyUsage, isActive, publicTask, totalTokens } from './manager.js';
import { TaskStore } from './store.js';

const root = process.env.DSH_HOME || process.cwd();
const roots = [path.join(root, 'profiles', 'web'), path.join(root, 'profiles')];
async function runtime(name) {
  for (const directory of roots) {
    let resolved;
    try { resolved = createRequire(path.join(directory, 'package.json')).resolve(name); } catch { continue; }
    return import(pathToFileURL(resolved).href);
  }
  throw new Error(`Workers cannot resolve ${name} from this app's profile.`);
}
const { default: Schema } = await runtime('@deepseek-ai/schemastery');
const { TypertRemoteService } = await runtime('@deepseek-ai/dsh-typert-protocol');
const { defineTool } = await runtime('@deepseek-ai/dsh-tools');
const { z } = await runtime('zod');
const Route = Schema.object({ provider: Schema.string().default(''), model: Schema.string().default('') });
const SettingsSchema = Schema.object({
  enabled: Schema.boolean().default(defaults.enabled), worker: Route.default(defaults.worker), fallback: Route.default(defaults.fallback),
  taskTokenLimit: Schema.number().step(1).min(1000).max(10000000).default(defaults.taskTokenLimit),
  outputTokenLimit: Schema.number().step(1).min(256).max(32768).default(defaults.outputTokenLimit)
});
const route = z.object({ provider: z.string(), model: z.string() });
const usage = z.object(Object.fromEntries(Object.keys(emptyUsage()).map(key => [key, z.number().nonnegative()])));
export const taskSchema = z.object({
  id: z.string().uuid(), parentId: z.string(), description: z.string().max(120), prompt: z.string().max(12000),
  status: z.enum(['starting', 'running', 'recovering', 'completed', 'failed', 'budget', 'timeout', 'stopped', 'refused', 'interrupted']),
  detail: z.string(), output: z.string().max(12000), worker: route, fallback: route,
  attempts: z.array(route.extend({ childId: z.string().uuid(), status: z.string(), usage, failure: z.string(), checkpoint: z.string().max(6000) })).max(2),
  usage, tokenLimit: z.number().positive(), outputLimit: z.number().positive(), createdAt: z.number(), updatedAt: z.number()
});

export const name = 'monqey-delegation';
export const inject = ['settings', 'tools', 'subagents', 'agents', 'sessionProjections', 'systemPrompt', 'llm', 'typert'];
const workerPersona = 'You are a Monqey managed worker. Your working directory is {{cwd}}. Complete only the delegated task, follow workspace instructions and return a concise, evidence-based report to the parent.';
export function apply(ctx) {
  const settings = ctx.settings.register('workers', SettingsSchema, { applies: 'live' });
  const store = new TaskStore(root, z.array(taskSchema));
  const failures = new Map();
  const progress = new Map();
  const modelRequests = new Set();
  const outputText = event => {
    if (event.type === 'assistant/message') return event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (event.type === 'tool/result') return JSON.stringify(event.data.message ?? event.data).slice(-2500);
    return '';
  };
  const manager = new DelegationManager({
    settings: () => settings.get(),
    parent: id => ctx.agents.get(id),
    canResume: task => store.read(task.parentId).some(record => record.id === task.id),
    save: (_parentId, task) => store.save(task),
    validateRoute: async (selected, signal) => {
      if (!ctx.llm.listProviders().some(provider => provider.id === selected.provider)) throw new Error('The selected worker provider is unavailable. Connect it in Models settings.');
      const models = await ctx.llm.listModels(selected.provider, signal);
      if (!models.some(model => model.id === selected.model)) throw new Error('The selected worker model is no longer in the live catalog. Choose another model.');
      await ctx.llm.resolveCallConfig(selected, signal);
    },
    spawn: async ({ parent, childId, description, prompt, route: selected, maxTokens, signal }) => {
      return ctx.subagents.startContinuable({
        provider: 'spawn', childId, label: description, signal,
        request: { parent, prompt: [{ type: 'text', text: prompt }], agentOptions: { ...selected, maxTokens }, maxDepth: 1, persona: workerPersona }
      });
    },
    interrupt: (childId, parentId) => ctx.subagents.interrupt(childId, { kind: 'user', parentSessionId: parentId })
  });
  const report = error => ctx.logger.warn(`Workers: ${String(error.message ?? error)}`);
  const observe = promise => manager.track(promise).catch(report);
  const delegationTool = tool => /^(subagent(?:_|$)|delegate_task$|workflow(?:_|$)|ralph(?:_|$))/.test(tool);
  // Session-owned tools may not exist during child creation. Enforce the rule
  // at dispatch, and omit those tools from each assembled worker request.
  ctx.tools.guard(exec => manager.children.has(exec.agent?.id) && delegationTool(exec.name) ? 'Managed workers cannot delegate further.' : undefined);
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next();
    return manager.children.has(context.agent?.id) ? { ...assembled, tools: assembled.tools.filter(tool => !delegationTool(tool.name)) } : assembled;
  });
  const restore = parent => {
    if (parent.session.header.origin !== 'subagent') manager.restore(parent.id, store.read(parent.id));
  };
  ctx.on('agent/session-start', ({ agent }) => restore(agent));
  ctx.on('agent/disposed', ({ agent }) => {
    for (const task of manager.tasks.values()) if (task.parentId === agent.id && isActive(task)) manager.stop(task.attempts.at(-1)?.childId, 'stopped');
    manager.forget(agent.id);
    failures.delete(agent.id); progress.delete(agent.id); modelRequests.delete(agent.id);
  });
  for (const agent of ctx.agents.list()) restore(agent);
  const delegateDefinition = defineTool({
    name: 'delegate_task',
    description: 'Delegate one bounded, independent task to the configured worker model. The worker starts with fresh context and shares this workspace. Include only relevant facts, files, constraints and acceptance checks. Returns immediately; the runtime delivers the outcome and final response to this chat. At most two workers run together. One configured reserve may take over after an error; all attempts share the task token budget. Use send_message to steer the returned child while its managed task is active; inspect partial work before taking over.',
    parameters: {
      description: { type: 'string', required: true, description: 'Short task label, up to 120 characters.' },
      prompt: { type: 'string', required: true, description: 'Self-contained task with only the necessary context, up to 12000 characters.' }
    },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('A parent chat is required.');
      restore(exec.agent);
      const task = await manager.start(exec.agent, args, exec.signal);
      return JSON.stringify({ taskId: task.id, childId: task.attempts.at(-1)?.childId ?? null, status: task.status, detail: task.detail });
    }
  });
  const statusDefinition = defineTool({
    name: 'worker_tasks', description: 'Inspect this chat\'s recent managed worker tasks, current child ids, outcomes, reserve attempts and provider-reported token usage. Check this before taking over a failed worker: its reserve may already be running.',
    parameters: {}, output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('A parent chat is required.');
      return JSON.stringify(store.read(exec.agent.id).slice(-10).map(task => ({ taskId: task.id, description: task.description, status: task.status, detail: task.detail, usage: task.usage,
        attempts: task.attempts.map(({ childId, provider, model, status, failure }) => ({ childId, provider, model, status, failure })) })));
    }
  });
  let toolDisposers = [];
  const syncTools = () => {
    if (settings.get().enabled && toolDisposers.length === 0) toolDisposers = [ctx.tools.register(delegateDefinition), ctx.tools.register(statusDefinition)];
    else if (!settings.get().enabled) {
      for (const dispose of toolDisposers) dispose();
      toolDisposers = [];
    }
  };
  syncTools();
  ctx.systemPrompt.section({
    name: 'monqey:efficient-delegation', order: 2790,
    text: context => {
      const config = settings.get();
      if (!config.enabled || !config.worker.provider || !config.worker.model || context.agent?.session.header.origin === 'subagent') return '';
      return 'Use delegate_task automatically for a substantial, clearly bounded independent lookup, analysis or implementation when a worker can plausibly reduce main-model work. Do small, trivial or tightly coupled steps yourself; delegation and reviewing results also cost tokens. Send only relevant context, not the conversation. Start at most two independent workers, continue useful work, and review their concrete evidence and changes. Await results when they affect the answer. Managed failures may start one reserve automatically: check the worker task status before duplicating work yourself. Do not claim a saving without measuring main + worker + retry usage. User instructions and plan/permission rules take precedence. Use native subagent/fork only when its separate context behavior is explicitly needed; those manual tools have their own limits.';
    }
  });
  ctx.on('agent/pre-step', ({ agent }, next) => {
    if (!manager.children.has(agent.id) && agent.session.header.origin === 'subagent' && agent.session.ownEvents().some(event => event.type === 'subagent/descriptor' && event.data.persona === workerPersona)) {
      agent.cancel({ kind: 'hook', reason: 'This historical worker is outside the managed index. Start a new managed task.' });
      return Promise.resolve({ kind: 'reject' });
    }
    const reason = manager.admission(agent.id);
    if (!reason) return next();
    manager.stop(agent.id, totalTokens(manager.children.get(agent.id)?.usage) >= (manager.children.get(agent.id)?.tokenLimit ?? Infinity) ? 'budget' : 'stopped');
    return Promise.resolve({ kind: 'reject' });
  });
  ctx.on('agent/request-error', ({ agent, failure }, next) => {
    if (manager.children.has(agent.id)) { failures.set(agent.id, failure.code ?? 'UNKNOWN'); manager.noteFailure(agent.id, failure.code ?? 'UNKNOWN'); }
    return next();
  });
  ctx.on('agent/error', ({ agent, error }) => {
    if (manager.children.has(agent.id)) { failures.set(agent.id, error?.code ?? 'UNKNOWN'); manager.noteFailure(agent.id, error?.code ?? 'UNKNOWN'); }
  });
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!manager.children.has(agent.id)) return;
    progress.set(agent.id, Date.now());
    if (frame.type === 'start') modelRequests.add(agent.id);
    if (frame.type === 'end') modelRequests.delete(agent.id);
  });
  ctx.on('session/event', (session, event) => {
    if (!manager.children.has(session.id)) return;
    if (event.type === 'turn/end' && event.data.reason.kind === 'error') { failures.set(session.id, event.data.reason.error.code); manager.noteFailure(session.id, event.data.reason.error.code); }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt' && event.type !== 'tool/result') return;
    progress.set(session.id, Date.now());
    // Session observers may not reenter append. Defer index persistence until
    // the complete settlement (including the token-meter fold) has committed.
    observe(Promise.resolve().then(() => {
      const reported = ctx.sessionProjections.stateOf(session, 'tokenUsage')?.totals ?? emptyUsage();
      manager.updateChild(session.id, reported, outputText(event));
      const task = manager.children.get(session.id);
      if (task && isActive(task) && totalTokens(task.usage) >= task.tokenLimit) manager.stop(session.id, 'budget');
    }));
  });
  ctx.on('subagent/end', info => {
    modelRequests.delete(info.id);
    observe(Promise.resolve().then(() => manager.settle(info, failures.get(info.id) ?? '')));
  });
  settings.watch(next => {
    if (!next.enabled) for (const task of manager.tasks.values()) if (isActive(task)) manager.stop(task.attempts.at(-1)?.childId, 'stopped');
    syncTools();
  });
  const timer = setInterval(() => {
    for (const childId of modelRequests) if (Date.now() - (progress.get(childId) ?? Date.now()) > 600000) manager.stop(childId, 'timeout');
  }, 10000);
  timer.unref();
  ctx.on('dispose', async () => { clearInterval(timer); await manager.dispose(); });

  class WorkersService extends TypertRemoteService {
    constructor(owner) { super(owner, 'workers'); }
    listTasks(parentId) {
      const parent = ctx.agents.get(parentId);
      const tasks = store.read(parentId).map(publicTask);
      const ownUsage = parent ? ctx.sessionProjections.stateOf(parent.session, 'tokenUsage')?.totals ?? emptyUsage() : emptyUsage();
      return { tasks, mainUsage: ownUsage, workersUsage: store.totalUsage(parentId) };
    }
    async catalog(providerId) {
      const order = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
      const providers = ctx.llm.listProviders().map(item => ({ id: item.id, name: item.name })).sort(order);
      if (!providerId) return { providers, models: [] };
      if (!providers.some(provider => provider.id === providerId)) throw new Error('Provider unavailable. Connect it in Models settings.');
      const models = (await ctx.llm.listModels(providerId)).map(item => ({ id: item.id, name: item.name ?? item.id })).sort(order);
      return { providers, models };
    }
    stopTask(parentId, taskId) {
      const task = manager.tasks.get(taskId);
      if (!task || task.parentId !== parentId || !ctx.agents.get(parentId)) throw new Error('This worker does not belong to the active parent chat.');
      manager.stop(task.attempts.at(-1)?.childId, 'stopped');
      return true;
    }
  }
  new WorkersService(ctx);
  const idSchema = z.string().regex(/^[a-z0-9-]{1,100}$/i);
  const resultSchema = z.object({ tasks: z.array(taskSchema.omit({ prompt: true })), mainUsage: usage, workersUsage: usage });
  const descriptor = (method, parameters, result) => ({
    id: `monqey-code-delegation#workers/${method}`, service: 'workers', namespace: 'workers', method,
    invocation: { kind: 'direct' }, parameters: parameters.map(([key, schema]) => ({ name: key, wire: key, source: 'json', codec: { mode: 'strict', typeSymbol: `workers/${method}:${key}`, schema } })),
    result: { mode: 'strict', typeSymbol: `workers/${method}:result`, schema: result }
  });
  ctx.effect(() => ctx.typert.register({
    package: 'monqey-code-delegation', face: 'host', schemas: [], model: { services: [], events: [], objects: [] },
    invocations: [descriptor('listTasks', [['parentId', idSchema]], resultSchema), descriptor('stopTask', [['parentId', idSchema], ['taskId', z.string().uuid()]], z.boolean()), descriptor('catalog', [['providerId', z.string()]], z.object({ providers: z.array(z.object({ id: z.string(), name: z.string() })), models: z.array(z.object({ id: z.string(), name: z.string() })) }))]
  }));
}
