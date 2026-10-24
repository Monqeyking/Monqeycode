// Every error code used anywhere in this project must be listed in ERROR_CODES.
export const ERROR_CODES = Object.freeze([
  'AMOUNT_INVALID',
  'UNKNOWN_ACCOUNT',
  'INSUFFICIENT_FUNDS',
  'DUPLICATE_ENTRY',
]);

export class DomainError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
  }
}
