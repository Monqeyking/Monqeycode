// Evaluator-owned checks. Usage: node hidden.mjs <runDir> <default|cfg>
// Prints one JSON line: { loadError?, results: [{ id, group, ok, error? }] }
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const [, , runDir, variant = 'default'] = process.argv;
const load = (rel) => import(pathToFileURL(path.join(runDir, rel)).href);

let applyBatchRaw, createStore, openAccount, ERROR_CODES, config;
let loadError = null;
try {
  ({ applyBatch: applyBatchRaw } = await load('src/batch.js'));
  ({ createStore } = await load('src/store.js'));
  ({ openAccount } = await load('src/accounts.js'));
  ({ ERROR_CODES } = await load('src/errors.js'));
  config = await load('src/config.js');
  if (typeof applyBatchRaw !== 'function') throw new Error('applyBatch is not exported as a function');
} catch (error) {
  loadError = String(error?.message ?? error);
}

const seenCodes = new Set();
function ab(store, batch, options) {
  const report = options === undefined ? applyBatchRaw(store, batch) : applyBatchRaw(store, batch, options);
  if (report && typeof report === 'object') {
    if (report.code) seenCodes.add(report.code);
    for (const result of report.results ?? []) if (result?.code) seenCodes.add(result.code);
  }
  return report;
}

const mk = (spec) => {
  const store = createStore();
  for (const [id, [balanceCents, allowOverdraft, currency, dailyLimitCents]] of Object.entries(spec)) {
    const options = { balanceCents, allowOverdraft: !!allowOverdraft };
    if (currency) options.currency = currency;
    if (dailyLimitCents !== undefined) options.dailyLimitCents = dailyLimitCents;
    openAccount(store, id, options);
  }
  return store;
};
const bal = (store, id) => store.getAccount(id)?.balance;
const AT0 = '2025-01-01T00:00:00Z';
const T = (id, from, to, amount, at = AT0) => ({ id, at, type: 'transfer', from, to, amount });
const F = (id, ref, at = AT0) => ({ id, at, type: 'fee', ref });
const R = (id, ref, amount, at = AT0) => ({ id, at, type: 'refund', ref, amount });
const B = (id, entries, dependsOn) => (dependsOn === undefined ? { id, entries } : { id, entries, dependsOn });
const codes = (report) => report.results.map((result) => result.code);
const statuses = (report) => report.results.map((result) => result.status);
const FEES = (currency = 'EUR') => `${config.FEES_ACCOUNT}:${currency}`;
const feeBal = (store, currency = 'EUR') => bal(store, FEES(currency)) ?? 0;
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
function failingStore(store, method, nth) {
  let calls = 0;
  let armed = true;
  const original = store[method].bind(store);
  store[method] = (...args) => {
    calls += 1;
    if (armed && calls === nth) throw new Error(`injected ${method} failure`);
    return original(...args);
  };
  return { disarm: () => { armed = false; }, calls: () => calls };
}

const checks = [];
const check = (id, group, onlyVariant, fn) => checks.push({ id, group, onlyVariant, fn });

// ---------- Group A: requirements stated in TASK.md ----------
check('A01 basic transfer', 'A', 'default', () => {
  const s = mk({ a: [10000], b: [0] });
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '25.50')]));
  assert.equal(r.status, 'applied');
  assert.equal(r.results[0].status, 'applied');
  assert.equal(bal(s, 'a'), 7450);
  assert.equal(bal(s, 'b'), 2550);
});
check('A02 invalid amounts', 'A', 'default', () => {
  const s = mk({ a: [10000], b: [0] });
  ['12.345', '0.00', '-5', '1e3', 'abc', '', 5, null].forEach((amount, i) => {
    const r = ab(s, B(`b${i}`, [T(`x${i}`, 'a', 'b', amount)]));
    assert.equal(r.status, 'rejected', `amount ${String(amount)}`);
    assert.equal(r.results[0].code, 'AMOUNT_INVALID', `amount ${String(amount)}`);
  });
  assert.equal(bal(s, 'a'), 10000);
});
check('A03 unknown account', 'A', 'default', () => {
  const s = mk({ a: [10000] });
  const r = ab(s, B('b1', [T('e1', 'zzz', 'a', '1.00'), T('e2', 'a', 'zzz', '1.00')]));
  assert.deepEqual(codes(r), ['UNKNOWN_ACCOUNT', 'UNKNOWN_ACCOUNT']);
  assert.equal(bal(s, 'a'), 10000);
});
check('A04 insufficient funds and overdraft', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0], o: [0, true] });
  assert.equal(ab(s, B('b1', [T('e1', 'a', 'b', '10.01')])).results[0].code, 'INSUFFICIENT_FUNDS');
  assert.equal(ab(s, B('b2', [T('e2', 'a', 'b', '10.00')])).results[0].status, 'applied');
  assert.equal(bal(s, 'a'), 0);
  assert.equal(ab(s, B('b3', [T('e3', 'o', 'b', '5.00')])).results[0].status, 'applied');
  assert.equal(bal(s, 'o'), -500);
});
check('A05 partial mode', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '5.00'), T('e2', 'a', 'b', '50.00'), T('e3', 'a', 'b', '5.00')]));
  assert.equal(r.status, 'partial');
  assert.deepEqual(statuses(r), ['applied', 'rejected', 'applied']);
  assert.equal(bal(s, 'a'), 0);
  assert.equal(bal(s, 'b'), 1000);
});
check('A06 atomic mode', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '5.00'), T('e2', 'a', 'b', '50.00'), T('e3', 'a', 'b', '1.00')]), { atomic: true });
  assert.equal(r.status, 'rejected');
  assert.deepEqual(statuses(r), ['rolled_back', 'rejected', 'skipped']);
  assert.equal(r.results[1].code, 'INSUFFICIENT_FUNDS');
  assert.equal(bal(s, 'a'), 1000);
  assert.equal(bal(s, 'b'), 0);
});
check('A07 replay is idempotent', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const batch = B('b1', [T('e1', 'a', 'b', '4.00')]);
  const first = ab(s, batch);
  const second = ab(s, structuredClone(batch));
  assert.equal(second.replayed, true);
  assert.equal(second.status, first.status);
  assert.deepEqual(second.results, first.results);
  assert.equal(bal(s, 'a'), 600);
  assert.equal(first.replayed, undefined);
});
check('A08 batch id conflict', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  ab(s, B('b1', [T('e1', 'a', 'b', '4.00')]));
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '5.00')]));
  assert.equal(r.status, 'rejected');
  assert.equal(r.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(bal(s, 'a'), 600);
  const o = ab(s, B('b1', [T('e1', 'a', 'b', '4.00')]), { atomic: true });
  assert.equal(o.code, 'IDEMPOTENCY_CONFLICT');
});
check('A09 entry id reused in another batch', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  ab(s, B('b1', [T('e1', 'a', 'b', '4.00')]));
  const r = ab(s, B('b2', [T('e1', 'a', 'b', '1.00')]));
  assert.equal(r.results[0].code, 'DUPLICATE_ENTRY');
  assert.equal(bal(s, 'a'), 600);
});
check('A10 duplicate entry id inside a batch', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '1.00'), T('e1', 'a', 'b', '1.00')]));
  assert.deepEqual(codes(r), [undefined, 'DUPLICATE_ENTRY']);
  assert.equal(bal(s, 'a'), 900);
});
check('A11 rejected entry ids are not consumed', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  assert.equal(ab(s, B('b1', [T('e1', 'a', 'b', '50.00')])).results[0].status, 'rejected');
  const r = ab(s, B('b2', [T('e1', 'a', 'b', '5.00')]));
  assert.equal(r.results[0].status, 'applied');
  assert.equal(bal(s, 'a'), 500);
});
check('A12 atomic rejection: replay remembered, ids free', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const batch = B('b1', [T('e1', 'a', 'b', '5.00'), T('e2', 'a', 'b', '50.00')]);
  const first = ab(s, batch, { atomic: true });
  const again = ab(s, structuredClone(batch), { atomic: true });
  assert.equal(again.replayed, true);
  assert.equal(again.status, 'rejected');
  assert.deepEqual(again.results, first.results);
  const next = ab(s, B('b2', [T('e1', 'a', 'b', '5.00')]));
  assert.equal(next.results[0].status, 'applied');
  assert.equal(bal(s, 'a'), 500);
});
check('A13 fee basic', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  const r = ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  assert.equal(r.status, 'applied');
  assert.equal(bal(s, 'a'), 89850);
  assert.equal(bal(s, 'b'), 10000);
  assert.equal(feeBal(s), 150);
});
check('A14 fee minimum', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '1.00'), F('f1', 't1')]));
  assert.equal(bal(s, 'a'), 1000 - 100 - 5);
  assert.equal(feeBal(s), 5);
});
check('A15 fee rounds half to even', 'A', 'default', () => {
  const run = (amount) => {
    const s = mk({ a: [1000000], b: [0] });
    ab(s, B('b1', [T('t1', 'a', 'b', amount), F('f1', 't1')]));
    return feeBal(s);
  };
  assert.equal(run('7.00'), 10, '10.5 -> 10 (even)');
  assert.equal(run('5.00'), 8, '7.5 -> 8 (even)');
  assert.equal(run('33.33'), 50, '49.995 -> 50');
});
check('A16 fee reference rules', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  const r = ab(s, B('b1', [F('f0', 'later'), T('later', 'a', 'b', '10.00'), F('f1', 'later'), F('f2', 'later'), F('f3', 'missing'), T('bad', 'a', 'b', '9999.00'), F('f4', 'bad')]));
  assert.deepEqual(codes(r), ['REF_INVALID', undefined, undefined, 'REF_INVALID', 'REF_INVALID', 'INSUFFICIENT_FUNDS', 'REF_INVALID']);
  const earlier = ab(s, B('b2', [F('f9', 'later')]));
  assert.equal(earlier.results[0].code, 'REF_INVALID');
});
check('A17 fee payer cannot cover fee', 'A', 'default', () => {
  const s = mk({ a: [10000], b: [0] });
  const r = ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  assert.equal(r.status, 'partial');
  assert.deepEqual(codes(r), [undefined, 'INSUFFICIENT_FUNDS']);
  assert.equal(bal(s, 'a'), 0);
  assert.equal(feeBal(s), 0);
});
check('A18 full refund returns amount and fee', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  const r = ab(s, B('b2', [R('r1', 't1', '100.00')]));
  assert.equal(r.status, 'applied');
  assert.equal(bal(s, 'a'), 100000);
  assert.equal(bal(s, 'b'), 0);
  assert.equal(feeBal(s), 0);
});
check('A19 partial refunds refund the fee exactly once', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  ab(s, B('b2', [R('r1', 't1', '33.33')]));
  assert.equal(feeBal(s), 100);
  ab(s, B('b3', [R('r2', 't1', '33.33')]));
  assert.equal(feeBal(s), 50);
  ab(s, B('b4', [R('r3', 't1', '33.34')]));
  assert.equal(feeBal(s), 0);
  assert.equal(bal(s, 'a'), 100000);
  assert.equal(bal(s, 'b'), 0);
  // minimum fee of 5 cents refunded in three equal parts: 2 + 1 + 2, never 2 + 2 + 2
  const m = mk({ a: [10000], b: [0] });
  ab(m, B('m1', [T('t1', 'a', 'b', '3.00'), F('f1', 't1')]));
  assert.equal(feeBal(m), 5);
  ab(m, B('m2', [R('r1', 't1', '1.00')]));
  assert.equal(feeBal(m), 3);
  ab(m, B('m3', [R('r2', 't1', '1.00')]));
  assert.equal(feeBal(m), 2);
  ab(m, B('m4', [R('r3', 't1', '1.00')]));
  assert.equal(feeBal(m), 0);
  assert.equal(bal(m, 'a'), 10000);
});
check('A20 refund limit', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '100.00')]));
  assert.equal(ab(s, B('b2', [R('r1', 't1', '60.00')])).results[0].status, 'applied');
  assert.equal(ab(s, B('b3', [R('r2', 't1', '40.01')])).results[0].code, 'REFUND_EXCEEDS');
  assert.equal(ab(s, B('b4', [R('r3', 't1', '40.00')])).results[0].status, 'applied');
  assert.equal(bal(s, 'a'), 100000);
});
check('A21 refund without fee', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '10.00')]));
  ab(s, B('b2', [R('r1', 't1', '4.00')]));
  assert.equal(bal(s, 'a'), 400);
  assert.equal(bal(s, 'b'), 600);
  assert.equal(feeBal(s), 0);
});
check('A22 refund needs funds in recipient', 'A', 'default', () => {
  const s = mk({ a: [5000], b: [0], c: [0], o: [0, true] });
  ab(s, B('b1', [T('t1', 'a', 'b', '50.00'), T('t2', 'b', 'c', '50.00')]));
  assert.equal(ab(s, B('b2', [R('r1', 't1', '10.00')])).results[0].code, 'INSUFFICIENT_FUNDS');
  const s2 = mk({ a: [5000], b: [0, true], c: [0] });
  ab(s2, B('b1', [T('t1', 'a', 'b', '50.00'), T('t2', 'b', 'c', '50.00')]));
  assert.equal(ab(s2, B('b2', [R('r1', 't1', '10.00')])).results[0].status, 'applied');
  assert.equal(bal(s2, 'b'), -1000);
});
check('A23 refund reference rules', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '10.00'), F('f1', 't1')]));
  ab(s, B('b2', [R('r1', 't1', '1.00')]));
  const r = ab(s, B('b3', [R('x1', 'missing', '1.00'), R('x2', 'f1', '1.00'), R('x3', 'r1', '1.00')]));
  assert.deepEqual(codes(r), ['REF_INVALID', 'REF_INVALID', 'REF_INVALID']);
});
check('A24 unknown entry type', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [{ id: 'e1', type: 'bonus', from: 'a', to: 'b', amount: '1.00' }]));
  assert.equal(r.results[0].code, 'ENTRY_TYPE_INVALID');
});
check('A25 refund inside the same batch', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [T('t1', 'a', 'b', '10.00'), R('r1', 't1', '10.00')]));
  assert.equal(r.status, 'applied');
  assert.equal(bal(s, 'a'), 1000);
  assert.equal(bal(s, 'b'), 0);
});
for (const [id, options] of [['A26 store failure, atomic', { atomic: true }], ['A27 store failure, partial', {}]]) {
  check(id, 'A', 'default', () => {
    const s = mk({ a: [1000], b: [0] });
    const probe = failingStore(s, 'putAccount', 2);
    const batch = B('b1', [T('e1', 'a', 'b', '1.00'), T('e2', 'a', 'b', '2.00')]);
    let r;
    assert.doesNotThrow(() => { r = ab(s, batch, options); });
    assert.equal(r.status, 'rejected');
    assert.equal(r.code, 'STORE_FAILURE');
    assert.equal(bal(s, 'a'), 1000);
    assert.equal(bal(s, 'b'), 0);
    probe.disarm();
    const retry = ab(s, batch, options);
    assert.equal(retry.status, 'applied');
    assert.equal(retry.replayed, undefined);
    assert.equal(bal(s, 'a'), 700);
  });
}
check('A28 store failure on the very last write', 'A', 'default', () => {
  const batch = B('b1', [T('e1', 'a', 'b', '1.00'), T('e2', 'a', 'b', '2.00')]);
  const dry = mk({ a: [1000], b: [0] });
  let total = 0;
  for (const method of ['putAccount', 'putRecord']) {
    const original = dry[method].bind(dry);
    dry[method] = (...args) => { total += 1; return original(...args); };
  }
  ab(dry, batch);
  assert.ok(total > 2, 'expected the batch to write through the store');
  for (const method of ['putAccount', 'putRecord']) {
    const s = mk({ a: [1000], b: [0] });
    let calls = 0;
    const other = method === 'putAccount' ? 'putRecord' : 'putAccount';
    for (const m of [method, other]) {
      const original = s[m].bind(s);
      s[m] = (...args) => { calls += 1; if (calls === total) throw new Error('injected last write'); return original(...args); };
    }
    const r = ab(s, batch);
    assert.equal(r.code, 'STORE_FAILURE');
    assert.equal(bal(s, 'a'), 1000);
    assert.equal(bal(s, 'b'), 0);
  }
});
check('A29 input is not modified', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  const batch = deepFreeze(B('b1', [T('t1', 'a', 'b', '10.00'), F('f1', 't1')]));
  let r;
  assert.doesNotThrow(() => { r = ab(s, batch, deepFreeze({ atomic: true })); });
  assert.equal(r.status, 'applied');
});

// ---------- Group A, part 2: multi-currency, time, limits, dependencies ----------
const D1 = '2025-03-10';
const at = (day, time) => `${day}T${time}Z`;
const mc = (extra = {}) => mk({
  a: [1000000], b: [0], u: [0, false, 'USD'], g: [0, false, 'GBP'], x: [0, false, 'XAU'], ...extra,
});

check('A30 invalid timestamps', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  const badValues = [undefined, '2025-01-01', '2025-01-01T00:00:00', '2025-02-30T00:00:00Z', '2025-13-01T00:00:00Z',
    '2025-01-01T24:00:00Z', '2025-01-01T00:00:00+00:00', 5, '2025-01-01T00:00:00.000Z', '2025-02-29T10:00:00Z'];
  const entries = badValues.map((value, i) => {
    const entry = T(`bad${i}`, 'a', 'b', '1.00');
    if (value === undefined) delete entry.at; else entry.at = value;
    return entry;
  });
  const r = ab(s, B('b1', entries));
  assert.equal(r.status, 'rejected');
  assert.deepEqual(codes(r), badValues.map(() => 'AT_INVALID'));
  assert.equal(bal(s, 'a'), 100000);
  const ok = ab(s, B('b2', [T('leap', 'a', 'b', '1.00', '2024-02-29T10:00:00Z')]));
  assert.equal(ok.status, 'applied');
});
check('A31 entries are processed in time order', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0], c: [0] });
  const r = ab(s, B('b1', [T('e1', 'b', 'c', '5.00', at(D1, '10:00:00')), T('e2', 'a', 'b', '10.00', at(D1, '09:00:00'))]));
  assert.equal(r.status, 'applied');
  assert.deepEqual(statuses(r), ['applied', 'applied']);
  assert.deepEqual(r.results.map((result) => result.id), ['e1', 'e2']);
  assert.equal(bal(s, 'c'), 500);
  assert.equal(bal(s, 'b'), 500);
});
check('A32 equal timestamps keep array order', 'A', 'default', () => {
  const when = at(D1, '10:00:00');
  const s = mk({ a: [100000], b: [0], c: [0] });
  const r = ab(s, B('b1', [T('e1', 'b', 'c', '5.00', when), T('e2', 'a', 'b', '10.00', when)]));
  assert.deepEqual(codes(r), ['INSUFFICIENT_FUNDS', undefined]);
  const s2 = mk({ a: [100000], b: [0], c: [0] });
  const r2 = ab(s2, B('b1', [T('e2', 'a', 'b', '10.00', when), T('e1', 'b', 'c', '5.00', when)]));
  assert.equal(r2.status, 'applied');
});
check('A33 atomic stops at first failure in processing order', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const r = ab(s, B('b1', [
    T('e1', 'a', 'b', '5.00', at(D1, '12:00:00')),
    T('e2', 'a', 'b', '50.00', at(D1, '10:00:00')),
    T('e0', 'a', 'b', '1.00', at(D1, '09:00:00')),
  ]), { atomic: true });
  assert.deepEqual(statuses(r), ['skipped', 'rejected', 'rolled_back']);
  assert.equal(r.results[1].code, 'INSUFFICIENT_FUNDS');
  assert.equal(bal(s, 'a'), 1000);
  const s2 = mk({ a: [1000], b: [0] });
  const r2 = ab(s2, B('b2', [T('e1', 'a', 'b', '5.00'), T('e2', 'a', 'b', '1.00', 'garbage')]), { atomic: true });
  assert.deepEqual(statuses(r2), ['skipped', 'rejected']);
  assert.equal(r2.results[1].code, 'AT_INVALID');
});
check('A34 conversion rounds half to even', 'A', 'default', () => {
  const s = mc();
  assert.equal(ab(s, B('b1', [T('e1', 'a', 'u', '10.00')])).status, 'applied');
  assert.equal(bal(s, 'u'), 1085);
  assert.equal(bal(s, 'a'), 1000000 - 1000);
  const cases = [['1500.00', 2], ['2500.00', 2], ['3500.00', 4]];
  for (const [amount, expected] of cases) {
    const fresh = mc();
    ab(fresh, B('b', [T('t', 'a', 'x', amount)]));
    assert.equal(bal(fresh, 'x'), expected, `${amount} EUR -> XAU cents`);
  }
  const back = mc({ u: [1000, false, 'USD'] });
  ab(back, B('b', [T('t', 'u', 'a', '10.00')]));
  assert.equal(bal(back, 'a'), 1000000 + 922);
});
check('A35 conversion rejects tiny amounts and missing rates', 'A', 'default', () => {
  const s = mc({ u: [10000, false, 'USD'] });
  const r = ab(s, B('b1', [T('e1', 'a', 'x', '500.00'), T('e2', 'a', 'x', '1.00'), T('e3', 'u', 'g', '5.00'), T('e4', 'zzz', 'x', '1.00')]));
  assert.deepEqual(codes(r), ['AMOUNT_INVALID', 'AMOUNT_INVALID', 'RATE_UNAVAILABLE', 'UNKNOWN_ACCOUNT']);
  assert.equal(bal(s, 'a'), 1000000);
  const poor = mc({ u: [0, false, 'USD'] });
  assert.equal(ab(poor, B('b2', [T('e5', 'u', 'g', '5.00')])).results[0].code, 'RATE_UNAVAILABLE');
});
check('A36 daily limit and UTC dates', 'A', 'default', () => {
  const s = mk({ a: [100000, false, 'EUR', 5000], b: [0] });
  const r = ab(s, B('b1', [
    T('e1', 'a', 'b', '30.00', at(D1, '08:00:00')),
    T('e2', 'a', 'b', '20.00', at(D1, '23:59:59')),
    T('e3', 'a', 'b', '0.01', at(D1, '23:59:59')),
    T('e4', 'a', 'b', '50.00', '2025-03-11T00:00:00Z'),
  ]));
  assert.deepEqual(codes(r), [undefined, undefined, 'LIMIT_EXCEEDED', undefined]);
  const poor = mk({ a: [500, false, 'EUR', 1000], b: [0] });
  assert.equal(ab(poor, B('b2', [T('e5', 'a', 'b', '20.00')])).results[0].code, 'LIMIT_EXCEEDED');
});
check('A37 only applied transfers use the limit', 'A', 'default', () => {
  const s = mk({ a: [100000, false, 'EUR', 5000], b: [4500, false, 'EUR', 5000], c: [10000, false, 'EUR', 5000], d: [0] });
  const r = ab(s, B('b1', [T('t1', 'a', 'd', '30.00'), F('f1', 't1'), R('r1', 't1', '30.00'), T('t2', 'a', 'd', '30.00')]));
  assert.equal(r.results[3].code, 'LIMIT_EXCEEDED');
  assert.equal(r.results[2].status, 'applied');
  const r2 = ab(s, B('b2', [T('t3', 'b', 'd', '46.00'), T('t4', 'b', 'd', '45.00')]));
  assert.deepEqual(codes(r2), ['INSUFFICIENT_FUNDS', undefined]);
  const rolled = ab(s, B('b3', [T('t5', 'c', 'd', '40.00'), T('t6', 'c', 'zzz', '1.00')]), { atomic: true });
  assert.equal(rolled.status, 'rejected');
  assert.equal(ab(s, B('b4', [T('t7', 'c', 'd', '40.00')])).results[0].status, 'applied');
  assert.equal(ab(s, B('b5', [T('t8', 'c', 'd', '10.01')])).results[0].code, 'LIMIT_EXCEEDED');
});
check('A38 limit is counted in the sender currency and per sending account', 'A', 'default', () => {
  const s = mc({ u: [100000, false, 'USD', 10000], a: [1000000, false, 'EUR', 10000] });
  const r = ab(s, B('b1', [T('e1', 'u', 'a', '100.00'), T('e2', 'u', 'a', '0.01'), T('e3', 'a', 'u', '100.00'), T('e4', 'a', 'b', '0.01')]));
  assert.deepEqual(codes(r), [undefined, 'LIMIT_EXCEEDED', undefined, 'LIMIT_EXCEEDED']);
});
check('A39 fees are paid in the payer currency', 'A', 'default', () => {
  const s = mc({ u: [20000, false, 'USD'], g: [1000, false, 'GBP'] });
  const r = ab(s, B('b1', [T('t1', 'u', 'a', '100.00'), F('f1', 't1'), T('t2', 'g', 'a', '1.00'), F('f2', 't2')]));
  assert.equal(r.status, 'applied');
  assert.equal(feeBal(s, 'USD'), 150);
  assert.equal(feeBal(s, 'GBP'), 5);
  assert.equal(s.getAccount(FEES('USD')).currency, 'USD');
  assert.equal(s.getAccount(FEES('EUR')), undefined);
  assert.equal(bal(s, 'u'), 20000 - 10000 - 150);
});
check('A40 cumulative refunds across currencies', 'A', 'default', () => {
  const s = mc();
  ab(s, B('b1', [T('t1', 'a', 'u', '33.33')]));
  assert.equal(bal(s, 'u'), 3615);
  ab(s, B('b2', [R('r1', 't1', '10.00')]));
  assert.equal(bal(s, 'u'), 3615 - 1085);
  ab(s, B('b3', [R('r2', 't1', '10.00')]));
  assert.equal(bal(s, 'u'), 3615 - 2169);
  const last = ab(s, B('b4', [R('r3', 't1', '13.33')]));
  assert.equal(last.status, 'applied');
  assert.equal(bal(s, 'u'), 0);
  assert.equal(bal(s, 'a'), 1000000);
});
check('A41 fee refunds in a converted transfer', 'A', 'default', () => {
  const s = mc();
  ab(s, B('b1', [T('t1', 'a', 'u', '100.00'), F('f1', 't1')]));
  assert.equal(feeBal(s), 150);
  ab(s, B('b2', [R('r1', 't1', '50.00')]));
  assert.equal(feeBal(s), 75);
  assert.equal(bal(s, 'u'), 10847 - 5424);
  ab(s, B('b3', [R('r2', 't1', '50.00')]));
  assert.equal(feeBal(s), 0);
  assert.equal(bal(s, 'a'), 1000000);
  assert.equal(bal(s, 'u'), 0);
});
check('A42 refund cannot precede its transfer', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '10.00', at(D1, '12:00:00'))]));
  assert.equal(ab(s, B('b2', [R('r1', 't1', '1.00', at(D1, '11:00:00'))])).results[0].code, 'REF_INVALID');
  assert.equal(ab(s, B('b3', [R('r2', 't1', '1.00', at(D1, '12:00:00'))])).results[0].status, 'applied');
  assert.equal(ab(s, B('b4', [R('r3', 't1', '1.00', at(D1, '13:00:00'))])).results[0].status, 'applied');
  const same = ab(s, B('b5', [T('t2', 'a', 'b', '10.00', at(D1, '12:00:00')), R('r4', 't2', '1.00', at(D1, '11:00:00'))]));
  assert.deepEqual(codes(same), [undefined, 'REF_INVALID']);
});
check('A43 a fee needs its transfer to be processed first', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  const r = ab(s, B('b1', [F('f1', 't1', at(D1, '10:00:00')), T('t1', 'a', 'b', '10.00', at(D1, '11:00:00'))]));
  assert.deepEqual(codes(r), ['REF_INVALID', undefined]);
  const s2 = mk({ a: [100000], b: [0] });
  const r2 = ab(s2, B('b2', [F('f1', 't1', at(D1, '11:00:00')), T('t1', 'a', 'b', '10.00', at(D1, '10:00:00'))]));
  assert.equal(r2.status, 'applied');
  assert.equal(feeBal(s2), 15);
});
check('A44 dependsOn', 'A', 'default', () => {
  const s = mk({ a: [100000], b: [0] });
  assert.equal(ab(s, B('b1', [T('e1', 'a', 'b', '1.00')])).status, 'applied');
  assert.equal(ab(s, B('b2', [T('e2', 'a', 'b', '1.00')], 'b1')).status, 'applied');
  const unmet = ab(s, B('b3', [T('e3', 'a', 'b', '1.00')], 'nope'));
  assert.equal(unmet.status, 'rejected');
  assert.equal(unmet.code, 'DEPENDENCY_UNMET');
  assert.equal(bal(s, 'a'), 100000 - 200);
  ab(s, B('nope', [T('e4', 'a', 'b', '1.00')]));
  const again = ab(s, B('b3', [T('e3', 'a', 'b', '1.00')], 'nope'));
  assert.equal(again.replayed, true);
  assert.equal(again.code, 'DEPENDENCY_UNMET');
  assert.equal(ab(s, B('b3', [T('e3', 'a', 'b', '1.00')])).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(ab(s, B('b2', [T('e2', 'a', 'b', '1.00')])).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(ab(s, B('b5', [T('e3', 'a', 'b', '1.00')])).results[0].status, 'applied', 'ids of unmet batches stay free');
});
check('A45 dependsOn requires status applied', 'A', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  ab(s, B('part', [T('e1', 'a', 'b', '1.00'), T('e2', 'a', 'b', '500.00')]));
  ab(s, B('rej', [T('e3', 'a', 'b', '500.00')]));
  assert.equal(ab(s, B('d1', [T('e4', 'a', 'b', '1.00')], 'part')).code, 'DEPENDENCY_UNMET');
  assert.equal(ab(s, B('d2', [T('e5', 'a', 'b', '1.00')], 'rej')).code, 'DEPENDENCY_UNMET');
  assert.equal(ab(s, B('d3', [T('e6', 'a', 'b', '1.00')], 'd1')).code, 'DEPENDENCY_UNMET');
  assert.equal(bal(s, 'a'), 900);
});
check('A46 refund recipient funds are in the recipient currency', 'A', 'default', () => {
  const s = mc();
  ab(s, B('b1', [T('t1', 'a', 'u', '33.33')]));
  ab(s, B('b2', [T('t2', 'u', 'a', '30.00')]));
  assert.equal(bal(s, 'u'), 615);
  assert.equal(ab(s, B('b3', [R('r1', 't1', '10.00')])).results[0].code, 'INSUFFICIENT_FUNDS');
  assert.equal(ab(s, B('b4', [R('r2', 't1', '5.00')])).results[0].status, 'applied');
  assert.equal(bal(s, 'u'), 615 - 542);
});
check('A47 store failure leaves fee accounts and limits untouched', 'A', 'default', () => {
  const batch = B('b1', [T('t1', 'a', 'b', '10.00', at(D1, '10:00:00')), F('f1', 't1', at(D1, '10:00:01'))]);
  const s = mk({ a: [100000, false, 'EUR', 5000], b: [0] });
  const probe = failingStore(s, 'putAccount', 4);
  const r = ab(s, batch);
  assert.equal(r.code, 'STORE_FAILURE');
  assert.equal(s.getAccount(FEES()), undefined);
  assert.equal(bal(s, 'a'), 100000);
  probe.disarm();
  assert.equal(ab(s, batch).status, 'applied');
  assert.equal(ab(s, B('b2', [T('t2', 'a', 'b', '40.01', at(D1, '11:00:00'))])).results[0].code, 'LIMIT_EXCEEDED');
});

// ---------- Group B: project conventions (not stated in TASK.md) ----------
check('B01 report balances are 2-decimal strings', 'B', 'default', () => {
  const s = mk({ a: [10000], b: [0] });
  const r = ab(s, B('b1', [T('e1', 'a', 'b', '25.50')]));
  assert.equal(r.balances.a, '74.50');
  assert.equal(r.balances.b, '25.50');
});
check('B02 fee rate comes from config', 'B', 'cfg', () => {
  assert.equal(config.FEE_RATE_BPS, 200, 'grader could not rewrite FEE_RATE_BPS in src/config.js');
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  assert.equal(bal(s, 'a'), 100000 - 10000 - 200);
});
check('B03 fees account comes from config', 'B', 'cfg', () => {
  assert.equal(config.FEES_ACCOUNT, 'sys:alt-fees', 'grader could not rewrite FEES_ACCOUNT in src/config.js');
  const s = mk({ a: [100000], b: [0] });
  ab(s, B('b1', [T('t1', 'a', 'b', '100.00'), F('f1', 't1')]));
  assert.equal(bal(s, 'sys:alt-fees:EUR'), 200);
  assert.equal(s.getAccount('sys:fees:EUR'), undefined);
});
check('B04 every error code is registered in ERROR_CODES', 'B', 'default', () => {
  const required = ['REF_INVALID', 'REFUND_EXCEEDS', 'IDEMPOTENCY_CONFLICT', 'ENTRY_TYPE_INVALID', 'STORE_FAILURE', 'BATCH_INVALID',
    'AT_INVALID', 'RATE_UNAVAILABLE', 'LIMIT_EXCEEDED', 'DEPENDENCY_UNMET'];
  for (const code of [...required, ...seenCodes]) assert.ok(ERROR_CODES.includes(code), `${code} missing from ERROR_CODES`);
});
check('B05 never throws on malformed input', 'B', 'default', () => {
  const s = mk({ a: [1000], b: [0] });
  const bad = [null, undefined, 5, {}, { id: 'x' }, { id: 'x', entries: 'no' }];
  for (const batch of bad) {
    let r;
    assert.doesNotThrow(() => { r = ab(s, batch); }, `batch ${JSON.stringify(batch)}`);
    assert.equal(r.status, 'rejected');
    assert.equal(r.code, 'BATCH_INVALID');
  }
  const junk = B('g1', [null, undefined, 5, 's', {}, { id: 'q' }, { id: 'q2', type: 'transfer' }]);
  let r;
  assert.doesNotThrow(() => { r = ab(s, junk); });
  assert.equal(r.results.length, 7);
  assert.ok(r.results.every((result) => result.status !== 'applied'));
  assert.equal(bal(s, 'a'), 1000);
});

// ---------- run ----------
const results = [];
for (const item of checks) {
  if (item.onlyVariant !== variant) continue;
  if (loadError) {
    results.push({ id: item.id, group: item.group, ok: false, error: `load error: ${loadError}` });
    continue;
  }
  try {
    await item.fn();
    results.push({ id: item.id, group: item.group, ok: true });
  } catch (error) {
    results.push({ id: item.id, group: item.group, ok: false, error: String(error?.message ?? error).split('\n')[0].slice(0, 200) });
  }
}
process.stdout.write(`\n${JSON.stringify({ loadError, results })}\n`);
