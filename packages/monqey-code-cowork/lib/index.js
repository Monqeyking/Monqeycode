import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CoworkStore, id, statuses } from './store.js';
const root = process.env.DSH_HOME || process.cwd();
async function runtime(name) {
  for (const directory of ['web', '']) {
    let resolved; try { resolved = createRequire(path.join(root, 'profiles', directory, 'package.json')).resolve(name); } catch { continue; }
    return import(pathToFileURL(resolved).href);
  }
  throw Error(`Co-work cannot resolve ${name} from this app's profile.`);
}
const { TypertRemoteService } = await runtime('@deepseek-ai/dsh-typert-protocol');
const { defineTool } = await runtime('@deepseek-ai/dsh-tools');
const { z } = await runtime('zod');
export const name = 'monqey-cowork';
export const inject = ['workspaceRegistry', 'tools', 'systemPrompt', 'sessionProjections', 'shell', 'typert'];
export function apply(ctx) {
  const store = new CoworkStore(root);
  const localActor = { kind: 'user', id: 'local-user', label: 'You' };
  const workspace = workspaceId => { const found = ctx.workspaceRegistry.get(id(workspaceId)); if (!found) throw Error('Workspace not found. Open an existing workspace first.'); return found; };
  const validateLink = (owned, sessionId) => { if (sessionId != null && !owned.sessionIds.includes(id(sessionId))) throw Error('The linked agent must belong to this workspace.'); };
  const visible = board => ({ ...board, tasks: board.tasks.map(({ operationKey, ...task }) => task) });
  const mutation = (workspaceId, input, by, operationKey) => {
    const owned = workspace(workspaceId);
    if (input.linkedSessionId !== undefined) validateLink(owned, input.linkedSessionId);
    let result;
    if (input.action === 'create') result = store.create(owned.id, input, by, operationKey);
    else if (input.action === 'comment') result = store.comment(owned.id, input.taskId, input.revision, input.comment, by);
    else result = store.update(owned.id, input.taskId, input.revision, input.patch, by);
    return { task: visible({ tasks: [result.task] }).tasks[0], board: visible(result.board) };
  };
  class CoworkService extends TypertRemoteService {
    constructor(owner) { super(owner, 'cowork'); }
    workspaces() { return ctx.workspaceRegistry.list().map(item => ({ id: item.id, title: item.title, sessionIds: [...item.sessionIds] })); }
    board(workspaceId) { return visible(store.read(workspace(workspaceId).id)); }
    mutate(workspaceId, request) {
      if (request.action === 'update' && request.patch.linkedSessionId !== undefined) validateLink(workspace(workspaceId), request.patch.linkedSessionId);
      return mutation(workspaceId, request, localActor, request.action === 'create' ? `ui:${request.requestId}` : undefined);
    }
    sessionTasks(sessionId) {
      id(sessionId);
      const owned = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(sessionId));
      return owned ? { workspaceId: owned.id, tasks: visible(store.read(owned.id)).tasks.filter(task => task.linkedSessionId === sessionId && !task.archived).slice(-30) } : { workspaceId: null, tasks: [] };
    }
  }
  new CoworkService(ctx);
  const uuid = z.string().uuid(), short = z.string().trim().min(1).max(160);
  const patch = z.object({ title: short.optional(), description: z.string().max(4000).optional(), assignee: z.string().max(100).optional(), status: z.enum(statuses).optional(), dependencies: z.array(uuid).max(50).optional(), linkedSessionId: uuid.nullable().optional(), archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0, 'No changes were provided.');
  const request = z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), requestId: uuid, title: short, description: z.string().max(4000).optional(), assignee: z.string().max(100).optional(), linkedSessionId: uuid.nullable().optional() }).strict(),
    z.object({ action: z.literal('update'), taskId: uuid, revision: z.number().int().positive(), patch }).strict(),
    z.object({ action: z.literal('comment'), taskId: uuid, revision: z.number().int().positive(), comment: z.string().trim().min(1).max(2000) }).strict()
  ]);
  const descriptor = (method, parameters, result) => ({ id: `monqey-code-cowork#cowork/${method}`, service: 'cowork', namespace: 'cowork', method, invocation: { kind: 'direct' }, parameters: parameters.map(([key, schema]) => ({ name: key, wire: key, source: 'json', codec: { mode: 'strict', typeSymbol: `cowork/${method}:${key}`, schema } })), result: { mode: 'strict', typeSymbol: `cowork/${method}:result`, schema: result } });
  // The store validates persisted records before any response; the transport
  // additionally validates every mutation and refuses unknown arguments.
  ctx.effect(() => ctx.typert.register({ package: 'monqey-code-cowork', face: 'host', schemas: [], model: { services: [], objects: [], events: [] }, invocations: [
    descriptor('workspaces', [], z.array(z.object({ id: uuid, title: z.string(), sessionIds: z.array(uuid) }))),
    descriptor('board', [['workspaceId', uuid]], z.object({ format: z.literal(1), workspaceId: uuid, revision: z.number(), tasks: z.array(z.record(z.string(), z.unknown())), activity: z.array(z.record(z.string(), z.unknown())) })),
    descriptor('mutate', [['workspaceId', uuid], ['request', request]], z.object({ task: z.record(z.string(), z.unknown()), board: z.record(z.string(), z.unknown()) })),
    descriptor('sessionTasks', [['sessionId', uuid]], z.object({ workspaceId: uuid.nullable(), tasks: z.array(z.record(z.string(), z.unknown())) }))
  ] }));
  const ownedBy = async exec => {
    if (!exec.agent?.session.header.cwd) throw Error('Open this agent in a workspace before using Co-work tasks.');
    const owned = await ctx.workspaceRegistry.resolveByPath(exec.agent.session.header.cwd);
    if (!owned) throw Error('This agent is not attached to a registered workspace.');
    return owned;
  };
  const assertWritable = exec => {
    const permissions = ctx.sessionProjections.stateOf(exec.agent.session, 'permissions');
    const plan = ctx.sessionProjections.stateOf(exec.agent.session, 'plan');
    if (!permissions || !plan || plan.active || plan.wanted === true || plan.running?.wanted === true || (permissions.sandbox ?? ctx.shell.sandboxMode) === 'read-only') throw Error('Co-work writes are unavailable in Plan/read-only mode. Switch to Act to update tasks.');
    exec.signal.throwIfAborted();
  };
  const define = (toolName, description, parameters, write, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters,
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    isConcurrencySafe: () => !write,
    presentCall: args => ({ card: 'generic', title: write ? toolName === 'cowork_create_task' ? 'Create Co-work task' : 'Update Co-work task' : 'Read Co-work tasks', kind: write ? 'edit' : 'read', rawInput: args.title ?? args.taskId }),
    async execute(args, exec) {
      const owned = await ownedBy(exec); exec.signal.throwIfAborted(); if (write) assertWritable(exec);
      const result = await execute(args, exec, owned);
      return JSON.stringify(write ? { workspaceId: owned.id, boardRevision: result.board.revision, task: { ...result.task, comments: result.task.comments.slice(-5) } } : result);
    }
  }));
  const parameter = (type, description, required = true, extra = {}) => ({ type, description, ...(required ? { required: true } : {}), ...extra });
  define('cowork_list_tasks', 'Read shared Co-work tasks and current revisions in this workspace before updating. Returns compact summaries, most recently updated first. Supply taskId to read a specific task with its description and recent comments. Excludes archived tasks.', {
    taskId: parameter('string', 'Optional task UUID for full details.', false),
    limit: parameter('number', 'Maximum summaries, 1 to 100; defaults to 50.', false)
  }, false, (args, _exec, owned) => {
    const all = visible(store.read(owned.id)).tasks.filter(task => !task.archived);
    if (args.taskId !== undefined) { const task = all.find(item => item.id === id(args.taskId)); if (!task) throw Error('Task not found in this workspace.'); return { workspaceId: owned.id, tasks: [{ ...task, comments: task.comments.slice(-10) }] }; }
    const limit = args.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Task limit must be between 1 and 100.');
    return { workspaceId: owned.id, total: all.length, truncated: all.length > limit, tasks: all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map(({ id, title, assignee, status, revision, dependencies, linkedSessionId, updatedAt }) => ({ id, title, assignee, status, revision, dependencies, linkedSessionId, updatedAt })) };
  });
  define('cowork_create_task', 'Create a durable task on the shared Co-work board for this workspace. Links to this agent, or its registered parent for a worker. Use for work the user wants tracked; do not duplicate existing tasks or mark work complete without evidence.', { title: parameter('string','Task title, up to 160 characters.'), description: parameter('string','Task details, up to 4000 characters.',false), assignee: parameter('string','Responsible person or agent label, up to 100 characters.',false) }, true, (args, exec, owned) => {
    const linkedSessionId = [exec.agent.id, exec.agent.session.header.parentSession].find(sessionId => owned.sessionIds.includes(sessionId)) ?? null;
    return mutation(owned.id, { ...args, action: 'create', linkedSessionId }, { kind: 'agent', id: exec.agent.id, label: 'Agent' }, `agent:${exec.agent.id}:${exec.callId}`);
  });
  define('cowork_update_task', 'Update an existing shared Co-work task. Supply its current revision from cowork_list_tasks. A stale revision fails without overwriting other work. Done requires all dependencies Done; dependency IDs must belong to this workspace.', { taskId: parameter('string','Task UUID.'), revision: parameter('number','Current task revision.',true), title: parameter('string','Replacement title.',false), description: parameter('string','Replacement description.',false), assignee: parameter('string','Responsible person or agent.',false), status: parameter('string','Task status.',false,{enum:statuses}), dependencies: parameter('array','Replacement dependency task UUIDs.',false,{items:{type:'string'}}) }, true, (args, exec, owned) => { const { taskId, revision, ...changes } = args; return mutation(owned.id, { action:'update', taskId, revision, patch:patch.parse(changes) }, {kind:'agent',id:exec.agent.id,label:'Agent'}); });
  define('cowork_add_comment', 'Append a progress update or agreement to an existing shared Co-work task. Requires its current revision; records the originating agent identity.', { taskId:parameter('string','Task UUID.'),revision:parameter('number','Current task revision.'),comment:parameter('string','Comment, up to 2000 characters.') }, true, (args,exec,owned)=>mutation(owned.id,{...args,action:'comment'},{kind:'agent',id:exec.agent.id,label:'Agent'}));
  ctx.systemPrompt.section({ name:'monqey:cowork',order:2800,text:'Co-work is the durable shared task board for the current workspace. Use cowork_list_tasks when the user refers to tracked work, then cowork_create_task, cowork_update_task or cowork_add_comment in Act mode to keep that same board current. Reuse existing task IDs; supply current revisions and re-read after a conflict. Record meaningful progress, dependencies, decisions and completion evidence, not every reasoning step. These tools do not start background work: a task assignee is a label, not a running worker. Use the existing delegation tools when actual execution is needed. Private conversations are not automatically published; put only task-relevant information on the shared board. Plan mode is read-only. Never claim a task was saved unless the tool succeeded.' });
}
