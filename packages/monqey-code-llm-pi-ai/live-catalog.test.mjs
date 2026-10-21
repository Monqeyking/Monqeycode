import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { apply } from '../../profiles/web/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
import { LiveModelCatalog, installDeepSeekLiveCatalog } from '../monqey-code-llm/lib/live-model-catalog.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const home = fs.mkdtempSync(path.join(root, 'logs/catalog-test-'));
const previousHome = process.env.DSH_HOME;
const originalFetch = globalThis.fetch;
process.env.DSH_HOME = home;
try {
  let loads = 0;
  const cache = new LiveModelCatalog('test', 'scope');
  await Promise.all([cache.refresh(async () => { loads++; return [{ id: 'first' }]; }), cache.refresh(() => { throw Error('must coalesce'); })]);
  assert.equal(loads, 1);
  assert.equal(cache.status().state, 'ready');
  const restarted = new LiveModelCatalog('test', 'scope');
  assert.equal(restarted.models[0].id, 'first');
  await restarted.refresh(async () => { loads++; return [{ id: 'arrived-after-restart' }]; });
  assert.equal(loads, 2, 'A disk cache must not skip the startup request');
  await restarted.refresh(() => { throw Error('offline'); }, { force: true });
  assert.equal(restarted.models[0].id, 'arrived-after-restart');
  assert.equal(restarted.status().state, 'cached');
  await restarted.refresh(async () => [{ id: 'duplicate' }, { id: 'duplicate' }], { force: true });
  assert.equal(restarted.models[0].id, 'arrived-after-restart', 'Invalid responses cannot erase a working catalog');

  let listed = [{ id: 'existing', name: 'Remote name' }, { id: 'previous' }];
  let catalogRequests = 0;
  let inference;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url === 'https://catalog-fixture.invalid/v1/models') {
      catalogRequests++;
      assert.equal(init.redirect, 'error');
      return Response.json({ data: listed });
    }
    if (url === 'https://catalog-fixture.invalid/v1/chat/completions') {
      inference = JSON.parse(init.body);
      const chunk = { id: 'test', object: 'chat.completion.chunk', created: 0, model: inference.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Catalog route works.' }, finish_reason: 'stop' }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.startsWith('https://models.dev/')) return Response.json({});
    throw Error(`Unexpected test network request: ${url}`);
  };
  let adapter;
  apply({
    llm: { registerConfigurableProviders() { return { replace() {} }; }, registerModelDiscovery() {}, registerAdapter(_, instance) { adapter = instance; return { replace() {} }; } },
    get(name) { if (name === 'credentials') return { resolve: async () => ({ value: 'fixture-key' }) }; },
    logger: { warn() {}, error(error) { throw error; } }, inject() {}
  }, { providers: { fixture: {
    displayName: 'Fixture', api: 'openai-completions', baseURL: 'https://catalog-fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY',
    models: [{ id: 'existing', name: 'My custom name', contextWindow: 12345 }]
  } } });
  assert.deepEqual((await adapter.listModels('fixture')).map(m => m.id), ['existing', 'previous']);
  assert.equal((await adapter.resolveModel('fixture', 'existing')).name, 'My custom name');
  assert.equal((await adapter.resolveModel('fixture', 'existing')).context.contextWindow, 12345);
  listed = [{ id: 'existing' }, { id: 'brand-new-dynamic-model', context_window: 45678, baseURL: 'https://wrong.invalid' }];
  await adapter.refreshModelCatalog('fixture', { force: true });
  const models = await adapter.listModels('fixture');
  assert.deepEqual(models.map(m => m.id), ['existing', 'brand-new-dynamic-model']);
  const call = await adapter.prepareCall('fixture', 'brand-new-dynamic-model');
  assert.equal(call.model.id, 'brand-new-dynamic-model');
  assert.equal(call.model.context.contextWindow, 45678);
  const events = [];
  for await (const event of call.stream({ provider: 'fixture', model: call.model.id, messages: [], tools: [] })) events.push(event);
  assert.equal(inference?.model, 'brand-new-dynamic-model', JSON.stringify(events));
  assert.equal(events.at(-1)?.reason?.kind, 'stop', JSON.stringify(events));
  assert.equal(catalogRequests, 2, 'Picker and prepare must reuse the refreshed list');

  const require = createRequire(new URL('../../profiles/web/package.json', import.meta.url));
  const { DeepSeekAdapter } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')).href);
  const options = { baseURL: 'https://catalog-fixture.invalid/v1', apiKeyEnv: 'FIXTURE_KEY', defaults: { thinking: 'disabled' }, models: [{ id: 'existing', name: 'Kept name', contextWindow: 54321 }] };
  const deepseek = new DeepSeekAdapter({ options: () => structuredClone(options), resolveApiKey: async () => 'fixture-key' });
  installDeepSeekLiveCatalog(deepseek);
  assert.ok((await deepseek.listModels('deepseek-official')).some(m => m.id === 'brand-new-dynamic-model'));
  assert.equal((await deepseek.prepareCall('deepseek-official', 'brand-new-dynamic-model')).model.id, 'brand-new-dynamic-model');
  assert.equal((await deepseek.resolveModel('deepseek-official', 'existing')).name, 'Kept name');
  assert.equal(options.models.length, 1, 'Discovery cannot rewrite user configuration or defaults');
  assert.equal(deepseek.modelCatalogStatus().state, 'ready', 'Fresh options objects must not reset the cache on every read');

  let native;
  apply({
    llm: { registerConfigurableProviders() { return { replace() {} }; }, registerModelDiscovery() {}, registerAdapter(_, instance) { native = instance; return { replace() {} }; } },
    get() {}, logger: { warn() {}, error(error) { throw error; } }, inject() {}
  }, { providers: { 'openai-codex': {} } });
  let nativeLoads = 0;
  const nativeSnapshot = native.current();
  nativeSnapshot.models.refresh = async () => { nativeLoads++; await Promise.resolve(); return { errors: new Map() }; };
  await Promise.all([native.listModels('openai-codex'), native.listModels('openai-codex')]);
  assert.equal(nativeLoads, 1, 'Concurrent native picker requests must not cancel each other');
  nativeSnapshot.models.refresh = async () => ({ errors: new Map([['openai-codex', Error('offline')]]) });
  await native.refreshModelCatalog('openai-codex', { force: true });
  await native.listModels('openai-codex');
  assert.equal(native.modelCatalogStatus('openai-codex').state, 'cached', 'Reading a failed catalog again cannot label it up to date');
  console.log('Live catalogs: coalescing, startup refresh, disk/offline fallback, invalid response retention, dynamic additions/removals, custom overrides, actual inference route and DeepSeek passed.');
} finally {
  globalThis.fetch = originalFetch;
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  assert.ok(home.startsWith(path.join(root, 'logs/catalog-test-')));
  fs.rmSync(home, { recursive: true, force: true });
}
