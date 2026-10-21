import assert from 'node:assert/strict';
import { apply } from '../../profiles/web/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--live')) process.env.MONQEY_QODER_WORKER_RUNTIME_PATH = fileURLToPath(new URL('../../profiles/web/node_modules/@qoder-ai/qoder-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs', import.meta.url));

for (const qoder of [{}, { models: [] }, { models: [{ id: 'custom-qoder-model' }] }]) {
  let section;
  let adapter;
  let directory;
  const ctx = {
    llm: {
      registerConfigurableProviders(entries) {
        directory = entries;
        return { replace(entries) { directory = entries; } };
      },
      registerModelDiscovery() {},
      registerAdapter(routes, value) { adapter = value; return { replace() {} }; }
    },
    get() {},
    logger: { warn() {}, error(error) { throw error; } },
    inject(deps, callback) {
      if (deps.length === 1 && deps[0] === 'settings') callback({
        settings: { installSection(owner, name, schema, config, options) { section = options; } }
      });
    }
  };
  apply(ctx, { providers: {} });
  const updated = { providers: { qoder } };
  section.validate(updated);
  section.setSource(() => updated);
  section.onChange();
  assert.equal(directory.find(entry => entry.provider === 'qoder')?.error, undefined);
  const snapshot = adapter.current();
  assert.equal(snapshot.models.getModels('qoder').length, 0, 'Configured or synthetic models must not leak into Qoder catalog');
  if (process.argv.includes('--live') && qoder.models === undefined) {
    const models = await adapter.listModels('qoder');
    assert.ok(models.length > 1, 'Qoder must provide multiple real models');
    const reasoningModels = [];
    for (const model of models) {
      const info = await adapter.resolveModel('qoder', model.id);
      if (info.reasoning) reasoningModels.push({ id: model.id, name: info.name, efforts: info.reasoning.efforts.map(e => e.id) });
    }
    assert.ok(reasoningModels.length > 0, 'Live catalog must preserve reasoning metadata');
    console.log(JSON.stringify({ modelCount: models.length, reasoningModels }));
  }
  let loaded = false;
  let refreshCount = 0;
  const descriptor = { id: 'catalog-model', name: 'Catalog model', provider: 'qoder', input: ['text'], contextWindow: 10000, reasoning: false };
  snapshot.models.refresh = async () => { loaded = true; refreshCount++; return { errors: new Map() }; };
  snapshot.models.getModel = (provider, id) => loaded && id === descriptor.id ? descriptor : undefined;
  assert.equal((await adapter.resolveModel('qoder', descriptor.id)).id, descriptor.id);
  loaded = false;
  assert.equal((await adapter.prepareCall('qoder', descriptor.id)).model.id, descriptor.id);
  loaded = false;
  await assert.rejects(adapter.stream({ provider: 'qoder', model: 'removed-model', messages: [] }).next(), /Select a current Qoder model/);
  assert.equal(refreshCount, 3, 'Resolve, prepare and direct stream must load the catalog first');
  await assert.rejects(adapter.resolveModel('qoder', 'removed-model'), /Select a current Qoder model/);
}
console.log('Qoder profile: saving accepts empty profiles; models come exclusively from live catalog.');
