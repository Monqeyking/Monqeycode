import { DomainError } from './errors.js';

// Single transfer, idempotent by id. Used by simple callers; batches are a separate feature.
export function transfer(store, { id, from, to, cents }) {
  const done = store.getRecord(`transfer:${id}`);
  if (done) return done;
  const source = store.getAccount(from);
  const target = store.getAccount(to);
  if (!source || !target) throw new DomainError('UNKNOWN_ACCOUNT', 'unknown account');
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new DomainError('AMOUNT_INVALID', 'invalid amount');
  if (!source.allowOverdraft && source.balance < cents) {
    throw new DomainError('INSUFFICIENT_FUNDS', 'insufficient funds');
  }
  source.balance -= cents;
  target.balance += cents;
  store.putAccount(from, source);
  store.putAccount(to, target);
  const record = { id, from, to, cents };
  store.putRecord(`transfer:${id}`, record);
  return record;
}
