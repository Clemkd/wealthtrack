import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addTransaction,
  clearUnreadableData,
  acknowledgeUnreadableData,
  deleteTransaction,
  getTransactions,
  hasUnreadableData,
  updateTransaction,
} from './storage';

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

describe('unreadable data safety', () => {
  it('never overwrites a copy that was already set aside', () => {
    store.set(CORRUPT_KEY, 'first copy');
    store.set(KEY, '{broken');
    getTransactions();
    expect(store.get(CORRUPT_KEY)).toBe('first copy');
  });

  it('still reads when the backup cannot be written (quota)', () => {
    store.set(KEY, JSON.stringify([tx(), null]));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string) => {
        if (k === CORRUPT_KEY) throw new Error('QuotaExceededError');
        store.set(k, 'x');
      },
      removeItem: (k: string) => void store.delete(k),
    });
    expect(getTransactions().map((t) => t.id)).toEqual(['a']);
  });

  it('tells whether something was set aside and can acknowledge it', () => {
    expect(hasUnreadableData()).toBe(false);
    store.set(KEY, '{broken');
    getTransactions();
    expect(hasUnreadableData()).toBe(true);
    clearUnreadableData();
    expect(hasUnreadableData()).toBe(false);
  });

  it('keeps the acknowledgement: set aside entries are purged and not set aside again', () => {
    store.set(KEY, JSON.stringify([tx(), { amount: 0 }]));
    getTransactions();
    expect(hasUnreadableData()).toBe(true);

    acknowledgeUnreadableData();
    expect(hasUnreadableData()).toBe(false);
    expect(getTransactions().map((t) => t.id)).toEqual(['a']);
    expect(hasUnreadableData()).toBe(false);
    expect(JSON.parse(store.get(KEY) as string)).toHaveLength(1);
  });

  it('keeps a numeric id stable and usable for edit and delete', () => {
    store.set(KEY, JSON.stringify([tx({ id: 5 })]));
    expect(getTransactions()[0].id).toBe('5');
    deleteTransaction('5');
    expect(getTransactions()).toEqual([]);
  });

  it('does not rewrite the stored list when the rejected lines could not be set aside', () => {
    store.set(CORRUPT_KEY, 'OLD COPY');
    const raw = JSON.stringify([tx({ id: undefined }), { note: 'rejected', amount: '1,5' }]);
    store.set(KEY, raw);
    getTransactions();
    expect(store.get(KEY)).toBe(raw);
  });

  it('rewrites once the rejected lines are safely set aside', () => {
    const raw = JSON.stringify([tx({ id: undefined }), { note: 'rejected' }]);
    store.set(KEY, raw);
    getTransactions();
    expect(store.get(CORRUPT_KEY)).toBe(raw);
    expect(JSON.parse(store.get(KEY) as string)).toHaveLength(1);
  });

  it('keeps ids stable between reads when they were missing', () => {
    store.set(KEY, JSON.stringify([tx({ id: undefined })]));
    const first = getTransactions()[0].id;
    expect(first).toBeTruthy();
    expect(getTransactions()[0].id).toBe(first);
  });

  it('separates duplicated ids once and for all', () => {
    store.set(KEY, JSON.stringify([tx(), tx()]));
    const first = getTransactions().map((t) => t.id);
    expect(new Set(first).size).toBe(2);
    expect(getTransactions().map((t) => t.id)).toEqual(first);
  });

  it('deleting one of two former duplicates keeps the other', () => {
    store.set(KEY, JSON.stringify([tx(), tx()]));
    const [a, b] = getTransactions();
    deleteTransaction(b.id);
    expect(getTransactions().map((t) => t.id)).toEqual([a.id]);
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
