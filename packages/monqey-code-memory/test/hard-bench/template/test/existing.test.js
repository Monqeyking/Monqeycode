import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatCents } from '../src/money.js';
import { createStore } from '../src/store.js';
import { openAccount, getBalance } from '../src/accounts.js';
import { transfer } from '../src/transfer.js';

test('parseAmount and formatCents', () => {
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('0.01'), 1);
  assert.throws(() => parseAmount('12.345'), { code: 'AMOUNT_INVALID' });
  assert.equal(formatCents(1250), '12.50');
  assert.equal(formatCents(-5), '-0.05');
});

test('transfer moves money once', () => {
  const store = createStore();
  openAccount(store, 'a', { balanceCents: 1000 });
  openAccount(store, 'b');
  transfer(store, { id: 't1', from: 'a', to: 'b', cents: 400 });
  transfer(store, { id: 't1', from: 'a', to: 'b', cents: 400 });
  assert.equal(getBalance(store, 'a'), 600);
  assert.equal(getBalance(store, 'b'), 400);
});

test('snapshot and restore', () => {
  const store = createStore();
  openAccount(store, 'a', { balanceCents: 100 });
  const snapshot = store.snapshot();
  openAccount(store, 'a', { balanceCents: 5 });
  store.restore(snapshot);
  assert.equal(getBalance(store, 'a'), 100);
});
