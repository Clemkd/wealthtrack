import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addTransaction, deleteTransaction, getTransactions, updateTransaction } from './storage';

const KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const tx = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

describe('getTransactions', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(getTransactions()).toEqual([]);
  });

  it('returns stored transactions', () => {
    store.set(KEY, JSON.stringify([tx()]));
    expect(getTransactions()).toHaveLength(1);
  });

  it('does not throw on invalid JSON and keeps the raw content aside', () => {
    store.set(KEY, '{not json');
    expect(getTransactions()).toEqual([]);
    expect(store.get(CORRUPT_KEY)).toBe('{not json');
  });

  it.each(['null', '{}', '"text"', '42'])('treats %s as an empty list', (raw) => {
    store.set(KEY, raw);
    expect(getTransactions()).toEqual([]);
    expect(store.get(CORRUPT_KEY)).toBe(raw);
  });

  it('drops unusable elements, keeps the others and backs up the original', () => {
    const raw = JSON.stringify([tx(), null, tx({ id: 'b', price_per_unit: undefined })]);
    store.set(KEY, raw);
    const result = getTransactions();
    expect(result.map((t) => t.id)).toEqual(['a']);
    expect(store.get(CORRUPT_KEY)).toBe(raw);
  });

  it('does not create a backup when everything is valid', () => {
    store.set(KEY, JSON.stringify([tx()]));
    getTransactions();
    expect(store.has(CORRUPT_KEY)).toBe(false);
  });
});

describe('write helpers', () => {
  it('adds, updates and deletes transactions', () => {
    const added = addTransaction({
      transaction_type: 'buy',
      currency_from: null,
      currency_to: 'ETH',
      amount: 2,
      price_per_unit: 10,
      total_value: 20,
      price_per_unit_usd: null,
      total_value_usd: null,
      transaction_date: '2026-02-01T10:00:00.000Z',
      notes: 'n',
    });
    expect(getTransactions()).toHaveLength(1);

    updateTransaction(added.id, { ...added, amount: 3, total_value: 30 });
    expect(getTransactions()[0].amount).toBe(3);

    deleteTransaction(added.id);
    expect(getTransactions()).toEqual([]);
  });
});
