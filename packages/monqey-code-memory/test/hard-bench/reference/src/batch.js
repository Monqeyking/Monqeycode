import { DomainError } from './errors.js';
import { parseAmount, formatCents } from './money.js';
import { FEE_RATE_BPS, FEE_MIN_CENTS, FEES_ACCOUNT, RATES } from './config.js';

// Integer division rounded half-to-even; num >= 0, den > 0.
function divHalfEven(num, den) {
  const quotient = Math.floor(num / den);
  const remainder = num - quotient * den;
  if (remainder * 2 > den) return quotient + 1;
  if (remainder * 2 === den) return quotient + (quotient % 2);
  return quotient;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entryKey = (id) => `entry:${id}`;

function fail(code, message) {
  throw new DomainError(code, message);
}

function validAt(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function loadAccount(store, id) {
  const account = typeof id === 'string' ? store.getAccount(id) : undefined;
  if (!account) fail('UNKNOWN_ACCOUNT', `unknown account: ${String(id)}`);
  return account;
}

function canPay(account, cents) {
  return account.allowOverdraft || account.balance >= cents;
}

function applyEntry(store, entry, at, batchId, touched) {
  if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '') fail('ENTRY_TYPE_INVALID', 'malformed entry');
  if (!['transfer', 'fee', 'refund'].includes(entry.type)) fail('ENTRY_TYPE_INVALID', `unknown type: ${String(entry.type)}`);
  if (at === null) fail('AT_INVALID', 'bad timestamp');
  if (store.getRecord(entryKey(entry.id))) fail('DUPLICATE_ENTRY', `entry id already used: ${entry.id}`);

  if (entry.type === 'transfer') {
    const cents = parseAmount(entry.amount);
    const from = loadAccount(store, entry.from);
    const to = loadAccount(store, entry.to);
    let credited = cents;
    if (from.currency !== to.currency) {
      const rate = RATES[`${from.currency}>${to.currency}`];
      if (!rate) fail('RATE_UNAVAILABLE', `no rate ${from.currency}>${to.currency}`);
      credited = divHalfEven(cents * rate.num, rate.den);
      if (credited === 0) fail('AMOUNT_INVALID', 'converted amount rounds to zero');
    }
    const dayKey = `daily:${entry.from}:${at.slice(0, 10)}`;
    const used = store.getRecord(dayKey) ?? 0;
    if (from.dailyLimitCents !== undefined && used + cents > from.dailyLimitCents) fail('LIMIT_EXCEEDED', 'daily limit exceeded');
    if (!canPay(from, cents)) fail('INSUFFICIENT_FUNDS', 'insufficient funds');
    from.balance -= cents;
    to.balance += credited;
    store.putAccount(entry.from, from);
    store.putAccount(entry.to, to);
    touched.add(entry.from);
    touched.add(entry.to);
    store.putRecord(dayKey, used + cents);
    store.putRecord(entryKey(entry.id), {
      type: 'transfer', batchId, at, from: entry.from, to: entry.to, cents, credited,
      feeCents: 0, feeCharged: false, feeAccount: null, refundedCents: 0, refundedFeeCents: 0, refundedGiveCents: 0,
    });
    return;
  }

  const ref = typeof entry.ref === 'string' ? store.getRecord(entryKey(entry.ref)) : undefined;
  if (!ref || ref.type !== 'transfer') fail('REF_INVALID', `bad reference: ${String(entry.ref)}`);

  if (entry.type === 'fee') {
    if (ref.batchId !== batchId || ref.feeCharged) fail('REF_INVALID', 'transfer not eligible for a fee');
    const fee = Math.max(FEE_MIN_CENTS, divHalfEven(ref.cents * FEE_RATE_BPS, 10000));
    const payer = loadAccount(store, ref.from);
    if (!canPay(payer, fee)) fail('INSUFFICIENT_FUNDS', 'insufficient funds for fee');
    const feeAccountId = `${FEES_ACCOUNT}:${payer.currency}`;
    const fees = store.getAccount(feeAccountId) ?? { id: feeAccountId, balance: 0, allowOverdraft: false, currency: payer.currency };
    payer.balance -= fee;
    fees.balance += fee;
    store.putAccount(ref.from, payer);
    store.putAccount(feeAccountId, fees);
    touched.add(ref.from);
    touched.add(feeAccountId);
    store.putRecord(entryKey(entry.ref), { ...ref, feeCents: fee, feeCharged: true, feeAccount: feeAccountId });
    store.putRecord(entryKey(entry.id), { type: 'fee', batchId });
    return;
  }

  // refund
  if (ref.at > at) fail('REF_INVALID', 'refund precedes transfer');
  const cents = parseAmount(entry.amount);
  const cumulative = ref.refundedCents + cents;
  if (cumulative > ref.cents) fail('REFUND_EXCEEDS', 'refund exceeds original');
  const giveAfter = divHalfEven(ref.credited * cumulative, ref.cents);
  const giveNow = giveAfter - ref.refundedGiveCents;
  const feeAfter = ref.feeCharged ? divHalfEven(ref.feeCents * cumulative, ref.cents) : 0;
  const feeNow = feeAfter - ref.refundedFeeCents;
  const recipient = loadAccount(store, ref.to);
  const payer = loadAccount(store, ref.from);
  if (!canPay(recipient, giveNow)) fail('INSUFFICIENT_FUNDS', 'insufficient funds for refund');
  recipient.balance -= giveNow;
  payer.balance += cents + feeNow;
  store.putAccount(ref.to, recipient);
  store.putAccount(ref.from, payer);
  touched.add(ref.to);
  touched.add(ref.from);
  if (feeNow > 0) {
    const fees = loadAccount(store, ref.feeAccount);
    fees.balance -= feeNow;
    store.putAccount(ref.feeAccount, fees);
    touched.add(ref.feeAccount);
  }
  store.putRecord(entryKey(entry.ref), { ...ref, refundedCents: cumulative, refundedFeeCents: feeAfter, refundedGiveCents: giveAfter });
  store.putRecord(entryKey(entry.id), { type: 'refund', batchId });
}

function balancesFor(store, ids) {
  const balances = {};
  for (const id of ids) {
    const account = typeof id === 'string' ? store.getAccount(id) : undefined;
    if (account) balances[id] = formatCents(account.balance);
  }
  return balances;
}

function rejectedReport(batchId, code) {
  return { batchId, status: 'rejected', code, results: [], balances: {} };
}

export function applyBatch(store, batch, options = {}) {
  if (!isObject(batch) || typeof batch.id !== 'string' || batch.id === '' || !Array.isArray(batch.entries)) {
    return rejectedReport(isObject(batch) && typeof batch.id === 'string' ? batch.id : null, 'BATCH_INVALID');
  }
  const atomic = isObject(options) && options.atomic === true;
  const fingerprint = stable({ entries: batch.entries, atomic, dependsOn: batch.dependsOn ?? null });
  const known = store.getRecord(`batch:${batch.id}`);
  if (known) {
    if (known.fingerprint === fingerprint) return { ...known.report, replayed: true };
    return rejectedReport(batch.id, 'IDEMPOTENCY_CONFLICT');
  }

  const snapshot = store.snapshot();
  try {
    if (batch.dependsOn !== undefined) {
      const dependency = typeof batch.dependsOn === 'string' ? store.getRecord(`batch:${batch.dependsOn}`) : undefined;
      if (!dependency || dependency.report.status !== 'applied') {
        const report = rejectedReport(batch.id, 'DEPENDENCY_UNMET');
        store.putRecord(`batch:${batch.id}`, { fingerprint, report });
        return report;
      }
    }

    const results = new Array(batch.entries.length);
    const touched = new Set();
    for (const entry of batch.entries) {
      if (isObject(entry)) for (const key of ['from', 'to']) if (typeof entry[key] === 'string') touched.add(entry[key]);
    }
    const order = batch.entries.map((entry, index) => ({ entry, index, at: isObject(entry) && validAt(entry.at) ? entry.at : null }));
    order.sort((a, b) => {
      if (a.at === null && b.at === null) return a.index - b.index;
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      return a.index - b.index;
    });

    let failed = false;
    for (const { entry, index, at } of order) {
      const id = isObject(entry) && typeof entry.id === 'string' ? entry.id : null;
      if (failed) {
        results[index] = { id, status: 'skipped' };
        continue;
      }
      try {
        applyEntry(store, entry, at, batch.id, touched);
        results[index] = { id, status: 'applied' };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results[index] = { id, status: 'rejected', code: error.code };
        if (atomic) failed = true;
      }
    }
    if (failed) {
      store.restore(snapshot);
      for (const result of results) if (result.status === 'applied') result.status = 'rolled_back';
    }
    const applied = results.filter((result) => result.status === 'applied').length;
    const status = applied === 0 ? 'rejected' : applied === results.length ? 'applied' : 'partial';
    const report = { batchId: batch.id, status, results, balances: balancesFor(store, touched) };
    store.putRecord(`batch:${batch.id}`, { fingerprint, report });
    return report;
  } catch (error) {
    store.restore(snapshot);
    return rejectedReport(batch.id, 'STORE_FAILURE');
  }
}
