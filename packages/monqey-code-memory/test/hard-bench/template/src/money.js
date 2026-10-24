import { DomainError } from './errors.js';

// "12.5" -> 1250, "12.50" -> 1250. Only positive amounts with at most two decimals.
export function parseAmount(text) {
  if (typeof text !== 'string' || !/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new DomainError('AMOUNT_INVALID', `invalid amount: ${String(text)}`);
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new DomainError('AMOUNT_INVALID', `invalid amount: ${text}`);
  }
  return cents;
}

// 1250 -> "12.50", -5 -> "-0.05"
export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
