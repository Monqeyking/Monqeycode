// Only loaded by runtime-smoke.cjs --fixture, in an isolated test home.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(path.join(process.env.DSH_HOME, 'profiles/package.json'));
const { LlmAdapter, LlmError, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const { TypertRemoteService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href);
const webRequire = createRequire(path.join(process.env.DSH_HOME, 'profiles/web/package.json'));
const { z } = await import(pathToFileURL(webRequire.resolve('zod')).href);
export const inject = ['llm', 'agents', 'tools', 'workers', 'agentPresets', 'typert'];
export function apply(ctx) {
  const calls = [];
  class FixtureAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'fixture', name: 'Fixture' }]; }
    async *stream(options) {
      calls.push({ provider: options.provider, model: options.model, messages: options.messages, tools: options.tools });
      if (options.provider === 'fixture-worker') {
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 5 } };
        throw new LlmError('Fixture account quota exhausted', 'QUOTA');
      }
      const text = options.provider === 'fixture-reserve' ? 'Fixture worker result: inspected successfully.' : 'Fixture main model reviewed the worker result.';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 8, cacheReadTokens: 7 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture-main', 'fixture-worker', 'fixture-reserve'], new FixtureAdapter());
  class FixtureService extends TypertRemoteService {
    constructor(owner) { super(owner, 'workersFixture'); }
    async run() {
      const handle = await ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: process.env.DSH_HOME, agentPreset: 'standard' },
        agentOptions: { provider: 'fixture-main', model: 'fixture' }, setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => {}) });
      const parent = handle.agent;
      try {
        parent.followup(createUserMessage({ content: [{ type: 'text', text: 'PARENT_HISTORY_SENTINEL must not be copied to workers.' }], source: { kind: 'human' } }));
        await parent.whenIdle();
        const result = await ctx.tools.execute({ name: 'delegate_task', arguments: { description: 'Fixture inspection', prompt: 'Read-only fixture analysis; return one sentence.' }, agent: parent, callId: randomUUID(), signal: new AbortController().signal });
        assert.equal(result.isError, false, JSON.stringify(result));
        const taskId = JSON.parse(result.value).taskId;
        let task;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          task = ctx.workers.listTasks(parent.id).tasks.find(item => item.id === taskId);
          if (task && !['starting', 'running', 'recovering'].includes(task.status)) break;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.equal(task.status, 'completed', JSON.stringify(task));
        assert.equal(task.attempts.length, 2);
        assert.equal(task.attempts[0].failure, 'QUOTA', JSON.stringify(task));
        assert.equal(calls.filter(call => call.provider === 'fixture-worker').length, 1);
        assert.equal(calls.filter(call => call.provider === 'fixture-reserve').length, 1);
        const workerCall = calls.find(call => call.provider === 'fixture-worker');
        assert.equal(JSON.stringify(workerCall.messages).includes('PARENT_HISTORY_SENTINEL'), false);
        assert.equal(workerCall.tools.some(tool => /^(subagent(?:_|$)|delegate_task$)/.test(tool.name)), false);
        assert.ok(task.usage.uncachedInputTokens >= 30, JSON.stringify(task.usage));
        assert.ok(task.usage.cacheReadTokens >= 12, JSON.stringify(task.usage));
        await parent.whenIdle();
        assert.ok(JSON.stringify(parent.session.deriveMessages()).includes('Fixture worker result'));
        assert.equal(parent.options.provider, 'fixture-main');
        return { quotaFallback: true, freshContext: true, noNestedWorkers: true, resultReachedParent: true, usageIncludesAttempts: true, mainRoutePreserved: true };
      } finally { await handle.dispose(); }
    }
  }
  new FixtureService(ctx);
  ctx.typert.register({ package: 'monqey-workers-fixture', face: 'host', schemas: [], model: { services: [], objects: [], events: [] }, invocations: [{
    id: 'monqey-workers-fixture#workersFixture/run', service: 'workersFixture', namespace: 'workersFixture', method: 'run', invocation: { kind: 'direct' }, parameters: [],
    result: { mode: 'strict', typeSymbol: 'fixture/run:result', schema: z.record(z.string(), z.boolean()) }
  }] });
}
