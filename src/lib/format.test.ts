import { describe, expect, it } from 'vitest';
import { formatPrice } from './format';

describe('formatPrice', () => {
  it('keeps two decimals for ordinary prices', () => {
    expect(formatPrice(236.1234)).toBe('236,12');
    expect(formatPrice(1)).toBe('1,00');
    expect(formatPrice(50000)).toMatch(/^50\s?000,00$/);
  });

  it('shows enough decimals for prices below one', () => {
    expect(formatPrice(0.5)).toBe('0,50');
    expect(formatPrice(0.00001)).toBe('0,00001');
    expect(formatPrice(0.12345678912)).toBe('0,12345679');
  });

  it('formats a USD price with the US convention', () => {
    expect(formatPrice(0.00001, 'en-US')).toBe('0.00001');
    expect(formatPrice(1234.5, 'en-US')).toBe('1,234.50');
  });
});
