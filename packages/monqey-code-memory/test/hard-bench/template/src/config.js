export const FEE_RATE_BPS = 150;
export const FEE_MIN_CENTS = 5;
export const FEES_ACCOUNT = 'sys:fees';

// Exchange rates as exact fractions: 1 unit of the first currency = num/den units of the second.
export const RATES = {
  'EUR>USD': { num: 10847, den: 10000 },
  'USD>EUR': { num: 9219, den: 10000 },
  'EUR>GBP': { num: 8561, den: 10000 },
  'GBP>EUR': { num: 11681, den: 10000 },
  'EUR>XAU': { num: 1, den: 100000 },
};
