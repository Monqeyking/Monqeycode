const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dictation inserts through the native session editor, preserves typed text, and never submits', async () => {
  const hooks = []; let index = 0, effects = [], component, slot, input = { draft: 'Existing draft', draftRev: 2, phase: 'plain' }, stopCount = 0, recordings = 0, calls = 0;
  const insertions = [];
  const react = {
    useState(value) { const n = index++; if (!(n in hooks)) hooks[n] = value; return [hooks[n], next => { hooks[n] = next; }]; },
    useRef(value) { const n = index++; if (!(n in hooks)) hooks[n] = { current: value }; return hooks[n]; },
    useEffect(callback) { effects.push(callback); }
  };
  const jsx = (type, props) => ({ type, props });
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { recordings++; this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); }
  }
  class Reader { readAsDataURL() { this.result = 'data:audio/webm;base64,YXVkaW8='; this.onload(); } }
  const speech = { status: async () => ({ available: true }), transcribe: async (_audio, language) => { assert.equal(language, 'auto'); calls++; return 'Maak een taak aan.'; }, cancel: async () => {} };
  let plugin;
  const browser = { monqeyDesktop: { dictation: speech }, __ModuleLoader__: { load: item => { plugin = item.factory(name => name === 'react' ? react : { jsx }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), { window: browser, console, URL, Blob, FileReader: Reader, MediaRecorder: Recorder, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopCount++; } }] }) } }, setTimeout, clearTimeout });
  const session = {};
  const scope = { sessions: { scope: id => { assert.equal(id, 'session-one'); return session; } }, bail: (owner, event, request) => { assert.equal(owner, session); assert.equal(event, 'slash/input-insert-text'); insertions.push(request); return true; }, slots: { inject: (_name, callback) => callback(), register: (options, view) => { slot = options; component = view; } } };
  plugin.apply({ inject: (deps, callback) => { if (deps.includes('sessions')) callback(scope); }, slots: { inject() {} } });
  assert.equal(slot.name, 'conversation.input.beforeSubmit');
  const props = { ...slot.inject('session-one'), useInput: selector => selector(input) };
  const render = () => { index = 0; effects = []; return component(props); };
  render(); const cleanup = effects[0](); await new Promise(setImmediate);
  assert.equal(recordings, 0); assert.equal(calls, 0);
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  assert.equal(nodes(render()).some(node => node.type === 'select'), false);
  await nodes(render()).find(node => node.props?.['aria-label'] === 'Start dictation').props.onClick();
  input = { ...input, draft: 'Existing draft plus typed words', draftRev: 3 };
  nodes(render()).find(node => node.props?.['aria-label'] === 'Stop dictation').props.onClick();
  await new Promise(setImmediate);
  assert.equal(recordings, 1); assert.equal(calls, 1); assert.ok(stopCount > 0);
  assert.equal(insertions.length, 1); assert.equal(insertions[0].text, ' Maak een taak aan.');
  assert.equal(insertions[0].span.start, input.draft.length); assert.equal(insertions[0].span.draftRev, 3);
  await nodes(render()).find(node => node.props?.['aria-label'] === 'Start dictation').props.onClick();
  nodes(render()).find(node => node.props?.children === 'Cancel').props.onClick();
  await new Promise(setImmediate);
  assert.equal(calls, 1, 'Cancelled recording must not be transcribed or sent');
  assert.equal(insertions.length, 1);
  cleanup();
});
