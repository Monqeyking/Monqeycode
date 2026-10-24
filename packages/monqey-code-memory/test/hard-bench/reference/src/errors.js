// Every error code used anywhere in this project must be listed in ERROR_CODES.
export const ERROR_CODES = Object.freeze([
  'AMOUNT_INVALID',
  'UNKNOWN_ACCOUNT',
  'INSUFFICIENT_FUNDS',
  'DUPLICATE_ENTRY',
  'REF_INVALID',
  'REFUND_EXCEEDS',
  'ENTRY_TYPE_INVALID',
  'AT_INVALID',
  'RATE_UNAVAILABLE',
  'LIMIT_EXCEEDED',
  'IDEMPOTENCY_CONFLICT',
  'DEPENDENCY_UNMET',
  'STORE_FAILURE',
  'BATCH_INVALID',
]);

export class DomainError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
  }
}
