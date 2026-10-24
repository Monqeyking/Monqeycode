// Loaded only by the isolated runtime check, never by the production bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(path.join(process.env.DSH_HOME, 'profiles/web/package.json'));
const { TypertRemoteService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href);
const { z } = await import(pathToFileURL(require.resolve('zod')).href);
export const inject = ['agents', 'tools', 'agentPresets', 'workspaceRegistry', 'sessionProjections', 'typert'];
export function apply(ctx) {
  class Fixture extends TypertRemoteService {
    constructor(owner) { super(owner, 'coworkFixture'); }
    async run() {
      const workspace = await ctx.workspaceRegistry.create(process.env.DSH_HOME, 'Co-work test workspace');
      const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: process.env.DSH_HOME, agentPreset: 'standard' }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => {}) });
      const agent = handle.agent;
      try {
        await workspace.attachSession(agent.id);
        const execute = (name, args) => ctx.tools.execute({ name, arguments: args, agent, callId: randomUUID(), signal: new AbortController().signal });
        agent.session.append('sandbox/mode', { mode: 'read-only' });
        const denied = await execute('cowork_create_task', { title: 'Must not be created' });
        assert.equal(denied.isError, true, JSON.stringify(denied));
        agent.session.append('sandbox/mode', { mode: 'workspace-write' });
        const commandId = randomUUID();
        agent.session.append('command/run', { commandId, name: 'plan', args: 'on', source: { kind: 'user' } });
        const pendingDenied = await execute('cowork_create_task', { title: 'Pending Plan must not write' });
        assert.equal(pendingDenied.isError, true, JSON.stringify(pendingDenied));
        agent.session.append('command/done', { commandId, kind: 'success' });
        agent.session.append('plan/mode', { active: true });
        const planDenied = await execute('cowork_create_task', { title: 'Plan must not write' });
        assert.equal(planDenied.isError, true, JSON.stringify(planDenied));
        agent.session.append('plan/mode', { active: false });
        const created = await execute('cowork_create_task', { title: 'Prepare the weekly overview', assignee: 'Alex', description: 'Check ongoing work and agree on the next steps.' });
        assert.equal(created.isError, false, JSON.stringify(created));
        const task = JSON.parse(created.value).task;
        assert.equal(task.linkedSessionId, agent.id);
        const updated = await execute('cowork_update_task', { taskId: task.id, revision: 1, status: 'in_progress' });
        assert.equal(updated.isError, false, JSON.stringify(updated));
        const stale = await execute('cowork_update_task', { taskId: task.id, revision: 1, status: 'done' });
        assert.equal(stale.isError, true);
        const commented = await execute('cowork_add_comment', { taskId: task.id, revision: 2, comment: 'The overview is in progress. Waiting for the final figures.' });
        assert.equal(commented.isError, false, JSON.stringify(commented));
        const listed = await execute('cowork_list_tasks', {});
        assert.equal(listed.isError, false, JSON.stringify(listed));
        assert.equal(JSON.parse(listed.value).tasks.length, 1);
        assert.equal(JSON.parse(listed.value).tasks[0].revision, 3);
        const worker = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: process.env.DSH_HOME, agentPreset: 'standard', origin: 'subagent', parentSession: agent.id, delegationDepth: 1 }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => {}) });
        try {
          worker.agent.session.append('sandbox/mode', { mode: 'workspace-write' });
          const workerCreated = await ctx.tools.execute({ name: 'cowork_create_task', arguments: { title: 'Check the source figures' }, agent: worker.agent, callId: randomUUID(), signal: new AbortController().signal });
          assert.equal(workerCreated.isError, false, JSON.stringify(workerCreated));
          assert.equal(JSON.parse(workerCreated.value).task.linkedSessionId, agent.id);
        } finally { await worker.dispose(); }
        const secondDirectory = path.join(process.env.DSH_HOME, 'another-workspace'); fs.mkdirSync(secondDirectory);
        const secondWorkspace = await ctx.workspaceRegistry.create(secondDirectory, 'Another workspace');
        const second = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: secondDirectory, agentPreset: 'standard' }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => {}) });
        try {
          await secondWorkspace.attachSession(second.agent.id);
          second.agent.session.append('sandbox/mode', { mode: 'workspace-write' });
          const crossed = await ctx.tools.execute({ name: 'cowork_update_task', arguments: { taskId: task.id, revision: 3, status: 'done' }, agent: second.agent, callId: randomUUID(), signal: new AbortController().signal });
          assert.equal(crossed.isError, true);
        } finally { await second.dispose(); }
        return { workspaceId: workspace.id, taskId: task.id, sessionId: agent.id, checks: ['real agent tools', 'Plan and pending Plan writes denied', 'read-only write denied', 'stale revision denied', 'cross-workspace write denied', 'worker task links to parent', 'create/update/comment/read persisted'] };
      } finally { await handle.dispose(); }
    }
  }
  new Fixture(ctx);
  ctx.typert.register({ package: 'cowork-fixture', face: 'host', schemas: [], model: { services: [], objects: [], events: [] }, invocations: [{ id: 'cowork-fixture#coworkFixture/run', service: 'coworkFixture', namespace: 'coworkFixture', method: 'run', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: 'fixture/result', schema: z.record(z.string(), z.unknown()) } }] });
}
