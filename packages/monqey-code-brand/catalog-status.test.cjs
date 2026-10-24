const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Models settings shows live refresh results and updates when catalogs change', async () => {
  let plugin;
  let component;
  let effect;
  let update;
  let state = [];
  let disposed = false;
  let catalogs = [{ provider: 'fixture', name: 'Fixture provider', state: 'cached', lastSuccess: null }];
  const remote = {
    llm: { getModelCatalogStatus: async () => ({ ok: true, value: catalogs }) },
    $on(event, callback) { assert.equal(event, 'llm/adapters-updated'); update = callback; return () => { disposed = true; }; }
  };
  const react = { useState: () => [state, next => { state = next; }], useEffect: callback => { effect = callback; } };
  const jsx = (type, props) => ({ type, props });
  const browser = { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? react : { jsx }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), { window: browser, console, URL });
  const ctx = {
    remote, modelDirectories: {},
    slots: { inject: (_, callback) => callback(), register(options, view) { if (options.id === 'monqey-model-catalog-status') component = view; } },
    inject: (dependencies, callback) => { if (dependencies.includes('modelDirectories')) callback(ctx); }
  };
  plugin.apply(ctx);
  component({ remote });
  const cleanup = effect();
  await new Promise(resolve => setImmediate(resolve));
  let text = JSON.stringify(component({ remote }));
  assert.match(text, /Model lists refresh automatically when Monqey Agent starts/);
  assert.match(text, /Fixture provider: Using saved models; provider unavailable/);
  catalogs = [{ provider: 'fixture', name: 'Fixture provider', state: 'ready', lastSuccess: Date.now() }];
  await update();
  text = JSON.stringify(component({ remote }));
  assert.match(text, /Fixture provider: Up to date/);
  assert.doesNotMatch(text, /provider unavailable/);
  cleanup();
  assert.equal(disposed, true);
});
