const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let plugin;
let component;
let cursor = 0;
const hooks = [];
let effects = [];
let pending = new Map();
let sessions = { byId: { chat: { running: true } }, phase: 'ready' };
const native = [];
const badges = [];
const events = new Map();
const react = {
  useSyncExternalStore(subscribe, get) { return get(); },
  useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }]; },
  useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
  useCallback(callback) { return callback; },
  useEffect(callback) { effects.push(callback); }
};
const jsx = (type, props) => ({ type, props });
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), {
  window: { __ModuleLoader__: { load(definition) { plugin = definition.factory(name => name === 'react' ? react : { jsx, jsxs: jsx }); } },
    monqeyDesktop: { setTaskbarBadge() {}, setActiveWork() {}, setPendingAttention: count => badges.push(count), notify: message => native.push(message) },
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener() {}, setTimeout() {} },
  document: { visibilityState: 'hidden' }, console
});
const scope = { subscribe() {}, getSnapshot: () => ({ value: {}, revision: 0 }) };
plugin.apply({ settingsScope: { bind: () => scope }, slots: { inject(name, callback) { callback(); }, register(meta, wrapper) { if (meta.name === 'shell.overlay') component = wrapper({}).type; } } });
function render() {
  cursor = 0; effects = [];
  component({ useSessions: selector => selector(sessions), useSessionPendingInteraction: selector => selector(pending), scope });
  effects.forEach(effect => effect());
}
render();
pending = new Map([['chat', { key: 'approval:1', kind: 'approval' }]]);
sessions = { ...sessions, byId: { chat: { running: false } } };
render();
assert.equal(badges.at(-1), 1);
assert.equal(native.length, 1);
assert.equal(native[0].title, 'Goedkeuring nodig');
events.get('focus')();
render();
assert.equal(badges.at(-1), 1);
assert.equal(native.length, 1, 'No duplicate notification on rerender');
pending = new Map();
render();
assert.equal(badges.at(-1), 0);
console.log('Approval notifications: pending badge, specific alert, deduplication, focus and resolution pass.');
