import { describe, expect, it } from 'vitest';
import { dedupeIds, isFiat, normalizeTransaction, validateTransactionInput } from './transactions';
import { Transaction } from '../types/database';
import { afterEach, vi } from 'vitest';

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
    const swap = { ...valid, transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC' };
    expect(normalizeTransaction({ ...swap, amount_to: '5.2' })?.amount_to).toBe(5.2);
  });

  it('fills a missing id, notes and timestamps', () => {
    const tx = normalizeTransaction({ ...valid, id: undefined, notes: undefined, created_at: undefined });
    expect(tx?.id).toBeTruthy();
    expect(tx?.notes).toBe('');
    expect(tx?.created_at).toBeTruthy();
  });

  it('rejects zero or negative quantities and negative values (exchange exports write sales as negative)', () => {
    expect(normalizeTransaction({ ...valid, amount: 0 })).toBeNull();
    expect(normalizeTransaction({ ...valid, amount: -0.5 })).toBeNull();
    expect(normalizeTransaction({ ...valid, total_value: -7500 })).toBeNull();
    expect(normalizeTransaction({ ...valid, price_per_unit: -1 })).toBeNull();
  });

  it('accepts a free transaction (airdrop) with a zero price', () => {
    expect(normalizeTransaction({ ...valid, price_per_unit: 0, total_value: 0 })).not.toBeNull();
  });

  it('rejects a received quantity that is zero or negative', () => {
    const swap = { ...valid, transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC' };
    expect(normalizeTransaction({ ...swap, amount_to: 0 })).toBeNull();
    expect(normalizeTransaction({ ...swap, amount_to: -3 })).toBeNull();
    expect(normalizeTransaction({ ...swap, amount_to: '5.2' })?.amount_to).toBe(5.2);
  });

  it('ignores a received quantity on a buy or a sell instead of rejecting the line', () => {
    expect(normalizeTransaction({ ...valid, amount_to: 0 })?.amount_to).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_type: 'sell', amount_to: 7 })?.amount_to).toBeNull();
  });

  it('rejects a buy or a sell of a fiat currency, like the form does', () => {
    expect(normalizeTransaction({ ...valid, currency_to: 'EUR' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_type: 'sell', currency_to: 'usd' })).toBeNull();
  });

  it('only accepts ISO 8601 dates, not day/month ambiguities from a spreadsheet', () => {
    expect(normalizeTransaction({ ...valid, transaction_date: '05/01/2024 10:00' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: 'Jan 5 2024' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-05' })).not.toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-05T10:00:00.123Z' })).not.toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-13-45' })).toBeNull();
  });

  it.each(['2024-02-31', '2023-02-29', '2024-04-31', '2024-02-30T10:00:00Z', '2024-01-15,', '2024-01-15 junk'])(
    'rejects the impossible or malformed date %s',
    (transaction_date) => {
      expect(normalizeTransaction({ ...valid, transaction_date })).toBeNull();
    }
  );

  it.each(['2024-02-29', '2024-01-15T10:00:00+02:00', '2024-01-15T10:00:00.123Z', '2024-12-31T23:59'])(
    'accepts the valid date %s',
    (transaction_date) => {
      expect(normalizeTransaction({ ...valid, transaction_date })).not.toBeNull();
    }
  );

  it('reads plain decimal numbers, not hex, binary or an ambiguous comma', () => {
    expect(normalizeTransaction({ ...valid, amount: '1.5e3' })?.amount).toBe(1500);
    expect(normalizeTransaction({ ...valid, amount: '+5' })?.amount).toBe(5);
    expect(normalizeTransaction({ ...valid, amount: '5.' })?.amount).toBe(5);
    expect(normalizeTransaction({ ...valid, amount: '.5' })?.amount).toBe(0.5);
    for (const amount of ['0x10', '0b11', '1,000', '0,5', '1,5,2', '1 000']) {
      expect(normalizeTransaction({ ...valid, amount })).toBeNull();
    }
  });

  it('stores a date without a time at noon in the local time zone, so that the day stays the day', () => {
    expect(normalizeTransaction({ ...valid, transaction_date: '2025-01-01' })?.transaction_date).toBe(
      new Date(2025, 0, 1, 12).toISOString()
    );
    for (const zone of ['Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Martinique']) {
      vi.stubEnv('TZ', zone);
      const stored = normalizeTransaction({ ...valid, transaction_date: '2024-12-31' })?.transaction_date as string;
      const local = new Date(stored);
      expect([local.getFullYear(), local.getMonth(), local.getDate()]).toEqual([2024, 11, 31]);
      vi.unstubAllEnvs();
    }
    expect(normalizeTransaction({ ...valid, transaction_date: '2025-01-01T08:30:00Z' })?.transaction_date).toBe(
      '2025-01-01T08:30:00Z'
    );
  });

  it('knows the fiat currencies a crypto holder may meet', () => {
    for (const code of ['EUR', 'usd', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'TRY', 'BRL', 'MXN', 'ZAR', 'INR', 'CNY', 'HKD', 'NZD', 'SGD', 'KRW', 'ILS', 'AED']) {
      expect(isFiat(code)).toBe(true);
    }
    for (const code of ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'DOGE', 'RON', 'ALL', 'ONE']) {
      expect(isFiat(code)).toBe(false);
    }
  });

  it('accepts a purchase of RON (Ronin), which is a crypto and not the Romanian leu', () => {
    expect(normalizeTransaction({ ...valid, currency_to: 'RON' })).not.toBeNull();
  });

  it('refuses a swap towards any fiat currency, not only the common ones', () => {
    const swap = { type: 'swap' as const, currencyFrom: 'BTC', currencyTo: 'PLN', amount: 1, amountTo: 5, price: 10 };
    expect(validateTransactionInput(swap)).toMatch(/Vente/);
  });

  it('rejects an hour or a minute that does not exist and accepts every offset form', () => {
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-15T25:00:00Z' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-15T10:61' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-15T10:00:00+0100' })).not.toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_date: '2024-01-15T10:00:00-05:30' })).not.toBeNull();
  });

  it('rejects an unreadable received quantity on a swap instead of replacing it by the sent one', () => {
    const swap = { ...valid, transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC' };
    expect(normalizeTransaction({ ...swap, amount_to: 'abc' })).toBeNull();
    expect(normalizeTransaction({ ...swap, amount_to: '1.234,5' })).toBeNull();
    // Absent, null or empty is a swap recorded before the field existed
    expect(normalizeTransaction({ ...swap, amount_to: undefined })?.amount_to).toBeNull();
    expect(normalizeTransaction({ ...swap, amount_to: null })?.amount_to).toBeNull();
    expect(normalizeTransaction({ ...swap, amount_to: '' })?.amount_to).toBeNull();
  });

  it('rejects a swap between two fiat currencies', () => {
    const swap = { ...valid, transaction_type: 'swap', currency_from: 'EUR', currency_to: 'USD' };
    expect(normalizeTransaction(swap)).toBeNull();
  });

  it('keeps a numeric id, as text, so that it stays the same between reads', () => {
    expect(normalizeTransaction({ ...valid, id: 5 })?.id).toBe('5');
  });

  it('rejects a swap without a source currency', () => {
    expect(normalizeTransaction({ ...valid, transaction_type: 'swap', currency_from: '' })).toBeNull();
    expect(normalizeTransaction({ ...valid, transaction_type: 'swap', currency_from: null })).toBeNull();
  });

  describe('without crypto.randomUUID (insecure context, old browsers)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('still reads a transaction that has an id', () => {
      vi.stubGlobal('crypto', {});
      expect(normalizeTransaction(valid)?.id).toBe('a');
    });

    it('still generates an id when it is missing', () => {
      vi.stubGlobal('crypto', {});
      expect(normalizeTransaction({ ...valid, id: undefined })?.id).toBeTruthy();
    });
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
    expect(validateTransactionInput({ ...input, currencyTo: 'EUR' })).toMatch(/monnaie fiat/);
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
      expect(validateTransactionInput({ ...swap, currencyTo: 'EUR' })).toMatch(/cession imposable.*Vente/);
    });

    it('requires a source currency', () => {
      expect(validateTransactionInput({ ...swap, currencyFrom: '' })).toMatch(/source/i);
    });
  });
});

describe('dedupeIds', () => {
  const tx = (id: string): Transaction => normalizeTransaction({ ...valid, id }) as Transaction;

  it('keeps unique ids and reports no change', () => {
    const result = dedupeIds([tx('a'), tx('b')]);
    expect(result.transactions.map((x) => x.id)).toEqual(['a', 'b']);
    expect(result.changed).toBe(false);
  });

  it('gives a duplicated id a new identity and keeps the first one', () => {
    const result = dedupeIds([tx('a'), tx('a'), tx('a')]);
    expect(result.transactions[0].id).toBe('a');
    expect(new Set(result.transactions.map((x) => x.id)).size).toBe(3);
    expect(result.changed).toBe(true);
  });
});
