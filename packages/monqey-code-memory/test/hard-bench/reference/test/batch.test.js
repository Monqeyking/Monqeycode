import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { openAccount, getBalance } from '../src/accounts.js';
import { applyBatch } from '../src/batch.js';

test('applyBatch applies a transfer and replays idempotently', () => {
  const store = createStore();
  openAccount(store, 'a', { balanceCents: 1000 });
  openAccount(store, 'b');
  const batch = { id: 'b1', entries: [{ id: 'e1', at: '2025-01-01T00:00:00Z', type: 'transfer', from: 'a', to: 'b', amount: '4.00' }] };
  const first = applyBatch(store, batch);
  assert.equal(first.status, 'applied');
  assert.equal(applyBatch(store, structuredClone(batch)).replayed, true);
  assert.equal(getBalance(store, 'a'), 600);
});
