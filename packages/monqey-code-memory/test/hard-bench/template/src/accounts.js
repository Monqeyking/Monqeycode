import { DomainError } from './errors.js';

export function openAccount(store, id, { balanceCents = 0, allowOverdraft = false, currency = 'EUR', dailyLimitCents } = {}) {
  const account = { id, balance: balanceCents, allowOverdraft, currency };
  if (dailyLimitCents !== undefined) account.dailyLimitCents = dailyLimitCents;
  store.putAccount(id, account);
}

export function getBalance(store, id) {
  const account = store.getAccount(id);
  if (!account) throw new DomainError('UNKNOWN_ACCOUNT', `unknown account: ${id}`);
  return account.balance;
}
