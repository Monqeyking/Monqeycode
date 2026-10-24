# Task: batch processing for the ledger

Implement `applyBatch(store, batch, options = {})` in `src/batch.js` (named export, synchronous). Work only inside this project folder. Do not change the public behaviour of existing exports.

## Input

```js
batch   = { id: string, entries: Entry[], dependsOn?: string }
options = { atomic?: boolean }          // default false
Entry   = { id: string, at: string, type: 'transfer', from: string, to: string, amount: string }   // amount like "12.50"
        | { id: string, at: string, type: 'fee',      ref: string }                                  // ref = id of a transfer entry
        | { id: string, at: string, type: 'refund',   ref: string, amount: string }                  // ref = id of a transfer entry
```

All money is kept in whole cents. Accounts (see `src/accounts.js`) have a `currency`, may have `allowOverdraft`, and may have a `dailyLimitCents`.

## Time and order

`at` must be a valid UTC timestamp of exactly the form `YYYY-MM-DDTHH:MM:SSZ` (a real calendar date and time). Otherwise the entry is rejected with `AT_INVALID`.

Entries are processed in ascending `at` order; entries with equal `at` keep their order in the array. Entries whose `at` is missing or invalid are evaluated before all others, in array order. "Earlier" and "later" below always refer to this processing order. The `results` list in the report is in the original array order.

## Checks common to every entry (in this order)

1. Entry is an object with a non-empty string `id` and a `type` of `transfer`, `fee` or `refund`, otherwise `ENTRY_TYPE_INVALID`.
2. `at` as above, otherwise `AT_INVALID`.
3. An entry id may be used by at most one applied entry across all batches; a second use is rejected with `DUPLICATE_ENTRY`. Entries that were rejected, skipped or rolled back do not consume their id.

## Entry rules

**transfer** — moves `amount` (in the currency of the `from` account) from `from` to `to`. Checks in this order: `AMOUNT_INVALID` for a bad amount; `UNKNOWN_ACCOUNT` if either account does not exist; `RATE_UNAVAILABLE` if the currencies differ and `RATES` in `src/config.js` has no entry for `"<from currency>><to currency>"`; `LIMIT_EXCEEDED`; `INSUFFICIENT_FUNDS` if `from` would go below zero and does not have `allowOverdraft`.

- If the currencies differ, the `to` account is credited `amount × num / den` of the rate, in whole cents rounded half-to-even. If that rounds to 0 the entry is rejected with `AMOUNT_INVALID`.
- Daily limit: if the `from` account has `dailyLimitCents`, the sum of the amounts (in the `from` currency) of all applied transfers out of that account on the same UTC calendar date of `at`, plus this amount, may not exceed it. Fees and refunds do not count and do not free up the limit. Entries that are not applied do not count.

**fee** — charges the payer (the `from` account of the referenced transfer) a fee in the payer's currency, paid to the account with id `FEES_ACCOUNT + ':' + <payer currency>` (for example `sys:fees:EUR`); create that account (balance 0, no overdraft, that currency) if it does not exist. The fee is `FEE_RATE_BPS` basis points of the transfer amount (in the payer's currency), rounded to whole cents with round-half-to-even, but never below `FEE_MIN_CENTS`. Checks in this order: the referenced entry must be a transfer that was applied earlier in the same batch and does not already have a fee, otherwise `REF_INVALID`; then `INSUFFICIENT_FUNDS` if the payer cannot cover the fee.

**refund** — returns `amount` (in the payer's currency, the currency of the transfer's `from` account) to the transfer's `from` account. Checks in this order: the referenced entry must be an applied transfer (from an earlier batch or earlier in this batch) whose `at` is not later than this refund's `at`, otherwise `REF_INVALID`; `AMOUNT_INVALID`; the total refunded for one transfer may never exceed the transfer amount (`REFUND_EXCEEDS`); the recipient (the transfer's `to` account) must be able to fund what it gives back (`INSUFFICIENT_FUNDS`, unless it allows overdraft).

- What the recipient gives back is in its own currency. After each refund, the cumulative amount the recipient has given back equals the amount it originally received × (cumulative refunded / transfer amount), rounded half-to-even; the exchange rate is not applied again. A full refund therefore returns exactly what was received, in whatever number of parts.
- If the transfer had a fee, the fee is refunded from the fees account to the payer in the same way: after each refund the cumulative fee refunded equals the fee × (cumulative refunded / transfer amount), rounded half-to-even, so the fee is refunded exactly once in total, down to the cent.

## Batch rules

- **Partial mode** (default): each entry succeeds or is rejected on its own.
- **Atomic mode** (`options.atomic === true`): evaluation stops at the first entry (in processing order) that is rejected, and nothing from the batch is applied. Entries before the failure are reported `rolled_back`, the failing entry keeps its code, entries after it (in processing order) are `skipped` and are not evaluated.
- **dependsOn**: if present, the batch with that id must already have been processed with status `applied`; otherwise the whole batch is rejected with batch-level code `DEPENDENCY_UNMET` and nothing is applied.
- **Idempotent**: applying a batch whose `id` was already processed returns the stored report again with `replayed: true` and changes nothing. If the same batch id arrives with different entries, options or `dependsOn`, return a rejected report with the batch-level code `IDEMPOTENCY_CONFLICT` and change nothing. Batches rejected by validation (including `DEPENDENCY_UNMET`) are remembered too.
- **Storage failures**: if the store throws while the batch is being applied, the store must end up exactly as it was before the batch, the report is rejected with batch-level code `STORE_FAILURE`, and the batch is not remembered, so the same batch can be retried later.
- The input (batch, entries, options) must not be modified.
- A malformed batch (not an object, missing id, entries not an array) is rejected with batch-level code `BATCH_INVALID`.

## Report

```js
{
  batchId,
  status: 'applied' | 'partial' | 'rejected',   // all applied | some applied | none applied
  code?,                                         // batch-level code, only when the whole batch failed before/outside entries
  replayed?: true,                               // only on a replay
  results: [{ id, status: 'applied' | 'rejected' | 'rolled_back' | 'skipped', code? }],   // original array order
  balances: { [accountId]: ... }                 // resulting balance of every account touched or referenced by the batch
}
```

Error codes used for the cases above: `AMOUNT_INVALID`, `UNKNOWN_ACCOUNT`, `INSUFFICIENT_FUNDS`, `DUPLICATE_ENTRY`, `REF_INVALID`, `REFUND_EXCEEDS`, `ENTRY_TYPE_INVALID`, `AT_INVALID`, `RATE_UNAVAILABLE`, `LIMIT_EXCEEDED`, `IDEMPOTENCY_CONFLICT`, `DEPENDENCY_UNMET`, `STORE_FAILURE`, `BATCH_INVALID`.

When you are done, make sure the existing tests still pass and tell me what you verified.
