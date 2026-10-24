const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Environment uses the owning session path and real desktop status, and opens the native tab', async () => {
  let plugin, panel, header, definition, callback, index = 0, effects = [], poll;
  const hooks = [], opened = [];
  let mobile = { enabled: false, serviceConfigured: false };
  const enabledCalls = [];
  const react = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useEffect(effect) { effects.push(effect); }
  };
  const jsx = (type, props) => ({ type, props });
  const browser = { monqeyDesktop: { chrome: { getInfo: async () => ({ computer: 'Test PC' }), onAction: listener => { callback = listener; } }, mobileAccess: { getStatus: async () => mobile, setEnabled: async enabled => { enabledCalls.push(enabled); return mobile = { ...mobile, enabled }; } } }, setInterval: listener => { poll = listener; return 1; }, clearInterval() {}, __ModuleLoader__: { load: item => { plugin = item.factory(name => name === 'react' ? react : { jsx }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), { window: browser, console, URL });
  const scope = {
    effect: callback => callback(),
    sidebarRightTabs: { register: value => { definition = value; } },
    sidebarRight: { openTabIn: (...args) => opened.push(args) }, uiWorkspace: { startSession: () => opened.push(['new']) },
    slots: { inject: (_slot, callback) => callback(), register: (options, component) => {
      if (options.name === 'sidebar.right.pane.tab') panel = { options, component };
      if (options.name === 'conversation.session.header.utilities') header = { options, component };
    } }
  };
  plugin.apply({ slots: { inject() {} }, inject: (deps, callback) => { if (deps.includes('sidebarRightTabs')) callback(scope); } });
  assert.equal(definition.kind, 'monqey-environment');
  assert.equal(panel.options.key, definition.id);
  header.component(header.options.inject('one')).props.onClick();
  assert.deepEqual(opened[0], ['one', 'monqey-environment']); callback('new-agent'); assert.deepEqual(opened[1], ['new']);
  const state = { current: 'two', byId: { one: { cwd: 'C:\\Projects\\First' }, two: { cwd: 'D:\\Second' } } };
  const render = () => { index = 0; effects = []; return panel.component({ ...panel.options.inject('one'), useSessions: selector => selector(state) }); };
  const text = tree => tree == null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : '';
  render(); const cleanup = effects[0](); await poll(); await new Promise(resolve => setImmediate(resolve));
  const content = text(render());
  assert.match(content, /Test PC/); assert.match(content, /C:\\Projects\\First/); assert.doesNotMatch(content, /D:\\Second/);
  const all = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(all) : [tree, ...all(tree.props?.children)];
  assert.match(content, /Not configured/); assert.doesNotMatch(content, /Connected/);
  assert.equal(all(render()).find(node => node.props?.role === 'switch').props.disabled, true);
  mobile = { enabled: false, serviceConfigured: true, device: { status: 'Offline' } };
  await poll();
  const toggle = all(render()).find(node => node.props?.role === 'switch');
  assert.equal(toggle.props.disabled, false); await toggle.props.onClick();
  assert.deepEqual(enabledCalls, [true]);
  assert.equal(all(render()).find(node => node.props?.role === 'switch').props['aria-checked'], true);
  assert.match(text(render()), /Offline/); assert.doesNotMatch(text(render()), /Connected/); cleanup();
});
