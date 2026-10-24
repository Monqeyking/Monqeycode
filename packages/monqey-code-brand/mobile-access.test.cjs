const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Mobile Access registers in Settings and displays actual device state in English', async () => {
  let component;
  let plugin;
  let index = 0;
  let effects = [];
  const hooks = [];
  const calls = [];
  let poll;
  let snapshot = { enabled: false, serviceConfigured: false, serviceStatus: 'disabled', device: null, pairing: null };
  const react = {
    useState(initial) { const at = index++; if (!(at in hooks)) hooks[at] = initial; return [hooks[at], value => { hooks[at] = value; }]; },
    useRef(value) { const at = index++; return hooks[at] ??= { current: value }; },
    useEffect(effect) { effects.push(effect); }
  };
  const jsx = (type, props) => ({ type, props });
  const bridge = {
    getStatus: async () => snapshot,
    setConnectionService: async relayUrl => { calls.push(['configure', relayUrl]); snapshot = { ...snapshot, relayUrl, serviceConfigured: true, enabled: false }; return snapshot; },
    setEnabled: async enabled => { calls.push(['enable', enabled]); return snapshot; },
    pairPhone: async () => { calls.push(['pair']); return snapshot; },
    approvePhone: async id => { calls.push(['approve', id]); return snapshot; },
    cancelPairing: async () => snapshot,
    revokeAccess: async () => { calls.push(['revoke']); snapshot = { ...snapshot, device: null }; return snapshot; }
  };
  const browser = { monqeyDesktop: { mobileAccess: bridge }, setInterval: callback => { poll = callback; return 1; }, clearInterval() {}, __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? react : { jsx }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), { window: browser, console, URL });
  plugin.apply({
    slots: { inject: (_, callback) => callback(), register(options, view) { if (options.id === 'mobile-access') { assert.equal(options.name, 'settings.section'); assert.equal(options.label(), 'Mobile Access'); component = view; } } },
    inject() {}
  });
  const render = () => { index = 0; effects = []; return component(); };
  const all = tree => tree == null || typeof tree !== 'object' ? [tree] : Array.isArray(tree) ? tree.flatMap(all) : [tree, ...all(tree.props?.children)];
  const text = tree => all(tree).filter(value => typeof value === 'string').join(' ');
  let tree = render();
  const cleanup = effects[0]();
  await poll();
  tree = render();
  assert.match(text(tree), /Not configured/);
  assert.match(text(tree), /No phone paired/);
  assert.equal(all(tree).find(node => node?.type === 'button' && node.props.children === 'Show pairing code').props.disabled, true);
  const address = all(tree).find(node => node?.type === 'input' && node.props.id === 'monqey-mobile-relay');
  address.props.onChange({ target: { value: 'wss://relay.example' } });
  tree = render();
  const saveService = all(tree).find(node => node?.type === 'button' && node.props.children === 'Save connection service');
  assert.equal(saveService.props.disabled, false);
  saveService.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = render();
  assert.equal(snapshot.enabled, false);
  assert.equal(all(tree).find(node => node?.type === 'input' && node.props.id === 'monqey-mobile-relay').props.value, 'wss://relay.example');
  const show = all(tree).find(node => node?.type === 'button' && node.props.children === 'Show pairing code');
  assert.equal(show.props.disabled, false, 'Showing a code must not require a separate enable action');
  show.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  snapshot = { enabled: true, serviceConfigured: true, serviceStatus: 'connected', device: { name: 'My iPhone', platform: 'iOS', status: 'Offline', lastSeenAt: 1700000000000, fingerprint: 'phone-key-123456789' }, pairing: null };
  await poll();
  tree = render();
  assert.match(text(tree), /My iPhone/);
  assert.match(text(tree), /Offline/);
  assert.doesNotMatch(text(tree), /Connected/);
  snapshot = { ...snapshot, device: { ...snapshot.device, status: 'Connected' } };
  await poll();
  tree = render();
  assert.match(text(tree), /Connected/);
  const revoke = all(tree).find(node => node?.type === 'button' && node.props.children === 'Revoke Access');
  await revoke.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['configure', 'wss://relay.example'], ['pair'], ['revoke']]);
  snapshot = { ...snapshot, pairing: { qrCode: 'data:image/png;base64,test', expiresAt: Date.now() + 120000 }, pendingDevice: { id: 'phone-1', name: 'My Phone', platform: 'Android', fingerprint: 'key-123456789012345' } };
  await poll();
  tree = render();
  assert.ok(all(tree).find(node => node?.type === 'img' && node.props.alt === 'Phone pairing QR code'));
  const approve = all(tree).find(node => node?.type === 'button' && node.props.children === 'Approve Phone');
  await approve.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['approve', 'phone-1']);
  cleanup();
});
