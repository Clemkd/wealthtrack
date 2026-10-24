import { describe, expect, it } from 'vitest';
import { normalizeTransaction, validateTransactionInput } from './transactions';

const valid = {
  id: 'a',
  transaction_type: 'buy',
  currency_from: null,
  currency_to: 'BTC',
  amount: 1,
  price_per_unit: 100,
  total_value: 100,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-01-01T10:00:00.000Z',
  notes: '',
  created_at: 'c',
  updated_at: 'u',
};

describe('normalizeTransaction', () => {
  it('accepts a valid transaction unchanged', () => {
    expect(normalizeTransaction(valid)).toMatchObject(valid);
  });

  it.each([null, undefined, 42, 'x', [], {}])('rejects %j', (raw) => {
    expect(normalizeTransaction(raw)).toBeNull();
  });

  it('normalises type and currency case', () => {
    const tx = normalizeTransaction({ ...valid, transaction_type: ' SELL ', currency_to: ' btc ' });
    expect(tx?.transaction_type).toBe('sell');
    expect(tx?.currency_to).toBe('BTC');
  });

  it('rejects unknown types instead of turning them into buys', () => {
    expect(normalizeTransaction({ ...valid, transaction_type: 'vente' })).toBeNull();
  });

  it('rejects an empty currency', () => {
    expect(normalizeTransaction({ ...valid, currency_to: '' })).toBeNull();
  });

  it('rejects non-numeric or non-finite amounts', () => {
    expect(normalizeTransaction({ ...valid, amount: 'abc' })).toBeNull();
    expect(normalizeTransaction({ ...valid, price_per_unit: NaN })).toBeNull();
    expect(normalizeTransaction({ ...valid, total_value: undefined })).toBeNull();
  });

  it('accepts numeric strings', () => {
    expect(normalizeTransaction({ ...valid, amount: '0.5' })?.amount).toBe(0.5);
  });

  it('rejects an invalid or empty date', () => {
    expect(normalizeTransaction({ ...valid, transaction_date: '' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: 'not a date' })).toBeNull();
  });

  it('turns an unreadable amount_to into null', () => {
    expect(normalizeTransaction({ ...valid, amount_to: 'abc' })?.amount_to).toBeNull();
    expect(normalizeTransaction({ ...valid, amount_to: '5.2' })?.amount_to).toBe(5.2);
  });

  it('fills a missing id, notes and timestamps', () => {
    const tx = normalizeTransaction({ ...valid, id: undefined, notes: undefined, created_at: undefined });
    expect(tx?.id).toBeTruthy();
    expect(tx?.notes).toBe('');
    expect(tx?.created_at).toBeTruthy();
  });

  it('keeps a currency that does not look like a ticker so it stays editable', () => {
    expect(normalizeTransaction({ ...valid, currency_to: 'USDT CTION TYPE' })?.currency_to).toBe(
      'USDT CTION TYPE'
    );
  });
});

const input = {
  type: 'buy' as const,
  currencyFrom: '',
  currencyTo: 'BTC',
  amount: 1,
  amountTo: NaN,
  price: 100,
};

describe('validateTransactionInput', () => {
  it('accepts a valid buy', () => {
    expect(validateTransactionInput(input)).toBeNull();
  });

  it('requires a positive quantity', () => {
    expect(validateTransactionInput({ ...input, amount: 0 })).toMatch(/quantité/i);
    expect(validateTransactionInput({ ...input, amount: -1 })).toMatch(/quantité/i);
    expect(validateTransactionInput({ ...input, amount: NaN })).toMatch(/quantité/i);
  });

  it('allows a zero price (airdrop) but not a negative or missing one', () => {
    expect(validateTransactionInput({ ...input, price: 0 })).toBeNull();
    expect(validateTransactionInput({ ...input, price: -1 })).toMatch(/prix/i);
    expect(validateTransactionInput({ ...input, price: NaN })).toMatch(/prix/i);
  });

  it('refuses a fiat currency as the asset of a buy or sell', () => {
    expect(validateTransactionInput({ ...input, currencyTo: 'EUR' })).toMatch(/fiat|crypto/i);
  });

  describe('swap', () => {
    const swap = { ...input, type: 'swap' as const, currencyFrom: 'SOL', currencyTo: 'USDC', amountTo: 5.2 };

    it('accepts a valid swap, including from a fiat currency', () => {
      expect(validateTransactionInput(swap)).toBeNull();
      expect(validateTransactionInput({ ...swap, currencyFrom: 'EUR' })).toBeNull();
    });

    it('requires a positive received quantity', () => {
      expect(validateTransactionInput({ ...swap, amountTo: 0 })).toMatch(/reçue/i);
      expect(validateTransactionInput({ ...swap, amountTo: NaN })).toMatch(/reçue/i);
    });

    it('refuses identical source and destination', () => {
      expect(validateTransactionInput({ ...swap, currencyFrom: 'SOL', currencyTo: 'SOL' })).toMatch(
        /différente|identique/i
      );
    });

    it('refuses a swap towards fiat, which is a taxable sale', () => {
      expect(validateTransactionInput({ ...swap, currencyTo: 'EUR' })).toMatch(/vente/i);
    });

    it('requires a source currency', () => {
      expect(validateTransactionInput({ ...swap, currencyFrom: '' })).toMatch(/source/i);
    });
  });
});
