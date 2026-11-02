const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  let plugin;
  const react = { useState: () => [undefined, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
  const jsx = (type, props) => ({ type, props });
  const browser = { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => name === 'react' ? react : { jsx }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/client.js'), 'utf8'), { window: browser, console, URL, setInterval, clearInterval });
  return plugin;
}

const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime(); // 2026-10-27 is a Tuesday

test('daily automations start once after their time and catch up a missed run within 12 hours', () => {
  const { automationDue } = load();
  const base = { enabled: true, createdAt: at(26, 8), schedule: { kind: 'daily', time: '09:00' } };
  assert.equal(automationDue(base, at(27, 8, 59)), false);
  assert.equal(automationDue(base, at(27, 9, 1)), true);
  assert.equal(automationDue({ ...base, lastRun: at(27, 9, 1) }, at(27, 9, 5)), false);
  assert.equal(automationDue(base, at(27, 22)), false, 'a run missed by more than 12 hours is skipped');
  assert.equal(automationDue({ ...base, enabled: false }, at(27, 9, 1)), false);
});

test('weekly automations only run on their days and interval automations wait for the gap', () => {
  const { automationDue, nextOccurrence } = load();
  const weekly = { enabled: true, createdAt: at(20, 8), schedule: { kind: 'weekly', time: '09:00', days: [1] } };
  assert.equal(automationDue(weekly, at(27, 9, 30)), false, 'Tuesday is not selected');
  assert.equal(automationDue(weekly, at(26, 9, 30)), true, 'Monday is selected');
  assert.equal(new Date(nextOccurrence(weekly, at(27, 10))).getDay(), 1);
  const every = { enabled: true, createdAt: at(27, 8), schedule: { kind: 'interval', minutes: 30 } };
  assert.equal(automationDue(every, at(27, 8, 20)), false);
  assert.equal(automationDue(every, at(27, 8, 31)), true);
  assert.equal(automationDue({ enabled: true, createdAt: 0, schedule: { kind: 'manual' } }, at(27, 9)), false);
});
