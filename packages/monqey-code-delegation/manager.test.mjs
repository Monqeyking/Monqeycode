import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DelegationManager, defaults, emptyUsage, totalTokens } from './lib/manager.js';

function harness(overrides = {}) {
  const parent = { id: 'parent', session: { header: {} } };
  const config = { ...structuredClone(defaults), enabled: true, worker: { provider: 'cheap', model: 'small' }, fallback: { provider: 'reserve', model: 'small' } };
  const spawns = [], records = [], stops = [];
  const io = {
    settings: () => config, parent: id => id === parent.id ? parent : undefined,
    validateRoute: async () => {}, save: (_id, task) => records.push(structuredClone(task)),
    spawn: async request => { spawns.push(request); }, interrupt: (...args) => stops.push(args), ...overrides
  };
  const manager = new DelegationManager(io);
  const start = (prompt = 'Read only file X and return one concrete finding.') => manager.start(parent, { description: 'Inspect one file', prompt }, new AbortController().signal);
  return { parent, config, spawns, records, stops, manager, start };
}
test('reserves concurrency before async catalog validation and sends bounded fresh task context', async () => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const h = harness({ validateRoute: () => gate });
  const first = h.start(), second = h.start();
  await assert.rejects(h.start(), /Two workers/);
  unblock();
  await Promise.all([first, second]);
  assert.equal(h.spawns.length, 2);
  assert.deepEqual(h.spawns[0].route, h.config.worker);
  assert.equal(h.spawns[0].maxTokens, 4096);
  assert.match(h.spawns[0].prompt, /Read only file X/);
  assert.equal('messages' in h.spawns[0], false);
  h.config.enabled = false;
  await assert.rejects(h.start(), /disabled/);
  await h.manager.dispose();
});
test('quota switches providers once, preserves checkpoints and counts all attempts', async () => {
  const h = harness();
  const task = await h.start();
  const first = task.attempts[0].childId;
  h.manager.updateChild(first, { ...emptyUsage(), cacheReadTokens: 100, outputTokens: 20 }, 'File X inspected; no edits yet.');
  await h.manager.settle({ id: first, stopReason: 'error' }, 'QUOTA');
  assert.equal(h.spawns.length, 2);
  assert.equal(h.spawns[1].route.provider, 'reserve');
  assert.match(h.spawns[1].prompt, /File X inspected/);
  const second = h.spawns[1].childId;
  h.manager.updateChild(second, { ...emptyUsage(), uncachedInputTokens: 30, outputTokens: 5 });
  await h.manager.settle({ id: second, stopReason: 'error' }, 'QUOTA');
  assert.equal(h.spawns.length, 2);
  assert.equal(h.manager.tasks.get(task.id).status, 'failed');
  assert.equal(totalTokens(h.manager.tasks.get(task.id).usage), 155);
});
test('quota does not switch to another model on the exhausted account', async () => {
  const h = harness();
  h.config.fallback = { provider: 'cheap', model: 'other' };
  const task = await h.start();
  await h.manager.settle({ id: task.attempts[0].childId, stopReason: 'error' }, 'QUOTA');
  assert.equal(h.spawns.length, 1);
  assert.equal(h.manager.tasks.get(task.id).status, 'failed');
});
test('budget survives recovery and blocks another model request or reserve attempt', async () => {
  const h = harness();
  h.config.taskTokenLimit = 1000;
  const task = await h.start();
  const childId = task.attempts[0].childId;
  h.manager.updateChild(childId, { ...emptyUsage(), cacheReadTokens: 950, outputTokens: 80 });
  assert.match(h.manager.admission(childId), /budget/);
  await h.manager.settle({ id: childId, stopReason: 'max-tokens' });
  assert.equal(h.spawns.length, 1);
  assert.equal(h.manager.tasks.get(task.id).status, 'budget');
});
test('cancellation, refusal and stop never replay a worker', async () => {
  for (const stopReason of ['aborted', 'refusal']) {
    const h = harness();
    const task = await h.start();
    await h.manager.settle({ id: task.attempts[0].childId, stopReason });
    assert.equal(h.spawns.length, 1);
    assert.ok(['stopped', 'refused'].includes(h.manager.tasks.get(task.id).status));
  }
  const h = harness();
  const task = await h.start();
  h.manager.stop(task.attempts[0].childId, 'stopped');
  await h.manager.settle({ id: task.attempts[0].childId, stopReason: 'aborted' });
  assert.equal(h.spawns.length, 1);
  assert.equal(h.stops.length, 1);
  assert.match(h.manager.admission(task.attempts[0].childId), /ended/);
});
test('restart retains records without silently replaying previous side effects', async () => {
  const h = harness();
  const task = await h.start();
  const restored = harness();
  restored.manager.restore(h.parent.id, [task]);
  assert.equal(restored.manager.tasks.get(task.id).status, 'interrupted');
  assert.equal(restored.spawns.length, 0);
});
test('bad route may use reserve but never changes main model or accepts nested workers', async () => {
  const h = harness({ validateRoute: async route => { if (route.provider === 'cheap') throw new Error('Unavailable'); } });
  const task = await h.start();
  assert.equal(task.attempts.length, 1);
  assert.equal(h.spawns[0].route.provider, 'reserve');
  h.parent.session.header.origin = 'subagent';
  await assert.rejects(h.start(), /cannot delegate/);
});
test('startup abort does not launch reserve and oversize prompts are rejected', async () => {
  const h = harness();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.manager.start(h.parent, { description: 'x', prompt: 'x' }, controller.signal));
  await assert.rejects(h.start('x'.repeat(12001)), /12000/);
  assert.equal(h.spawns.length, 0);
});
test('continuation keeps the cumulative budget and respects the same two-worker admission', async () => {
  const h = harness();
  const first = await h.start();
  const childId = first.attempts[0].childId;
  h.manager.updateChild(childId, { ...emptyUsage(), outputTokens: 25 });
  await h.manager.settle({ id: childId, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'Finished.' }] });
  await h.start(); await h.start();
  assert.match(h.manager.admission(childId), /Two workers/);
  const current = [...h.manager.tasks.values()].find(task => task.id !== first.id && task.status === 'running');
  h.manager.stop(current.attempts[0].childId, 'stopped');
  assert.equal(h.manager.admission(childId), undefined);
  assert.equal(totalTokens(h.manager.tasks.get(first.id).usage), 25);
  assert.equal(h.manager.tasks.get(first.id).status, 'running');
});
test('archived tasks cannot reopen and duplicate already aggregated usage', async () => {
  const h = harness({ canResume: () => false });
  const task = await h.start();
  const childId = task.attempts[0].childId;
  await h.manager.settle({ id: childId, stopReason: 'completed' });
  assert.match(h.manager.admission(childId), /recent worker index/);
  assert.equal(h.manager.tasks.get(task.id).status, 'completed');
});
