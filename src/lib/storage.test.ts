import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSafeStorage } from './safeStorage';
import {
  addTransaction,
  clearUnreadableData,
  acknowledgeUnreadableData,
  deleteTransaction,
  getTransactions,
  getUnreadableDataCopy,
  hasUnreadableData,
  isListDurable,
  isStorageUnavailable,
  resetStorageState,
  saveTransactions,
  unreadableCopyStatus,
  updateTransaction,
} from './storage';

const KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

const store = new Map<string, string>();
const copies = (): string[] => JSON.parse(store.get(CORRUPT_KEY) ?? '[]');

beforeEach(() => {
  resetSafeStorage();
  resetStorageState();
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
    expect(copies()).toEqual(['{not json']);
  });

  it.each(['null', '{}', '"text"', '42'])('treats %s as an empty list', (raw) => {
    store.set(KEY, raw);
    expect(getTransactions()).toEqual([]);
    expect(copies()).toEqual([raw]);
  });

  it('drops unusable elements, keeps the others and backs up the original', () => {
    const raw = JSON.stringify([tx(), null, tx({ id: 'b', price_per_unit: undefined })]);
    store.set(KEY, raw);
    const result = getTransactions();
    expect(result.map((t) => t.id)).toEqual(['a']);
    expect(copies()).toEqual([raw]);
  });

  it('does not create a backup when everything is valid', () => {
    store.set(KEY, JSON.stringify([tx()]));
    getTransactions();
    expect(store.has(CORRUPT_KEY)).toBe(false);
  });
});

describe('unreadable data safety', () => {
  it('keeps every different unreadable content, never replacing an earlier copy', () => {
    store.set(CORRUPT_KEY, JSON.stringify(['first copy']));
    store.set(KEY, '{broken');
    getTransactions();
    expect(copies()).toEqual(['first copy', '{broken']);
  });

  it('does not store the same content twice', () => {
    store.set(KEY, '{broken');
    getTransactions();
    getTransactions();
    expect(copies()).toEqual(['{broken']);
  });

  it('still reads, without rewriting anything, when the copy cannot be written (quota)', () => {
    const raw = JSON.stringify([tx({ id: undefined }), null]);
    store.set(KEY, raw);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string) => {
        if (k === CORRUPT_KEY) throw new Error('QuotaExceededError');
        store.set(k, 'x');
      },
      removeItem: (k: string) => void store.delete(k),
    });
    expect(getTransactions()).toHaveLength(1);
    expect(store.get(KEY)).toBe(raw);
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

  it('purges a broken main key on acknowledgement so that the notice does not come back', () => {
    store.set(KEY, '{broken');
    getTransactions();
    expect(hasUnreadableData()).toBe(true);
    acknowledgeUnreadableData();
    getTransactions();
    expect(hasUnreadableData()).toBe(false);
  });

  it('keeps a numeric id stable and usable for edit and delete', () => {
    store.set(KEY, JSON.stringify([tx({ id: 5 })]));
    expect(getTransactions()[0].id).toBe('5');
    deleteTransaction('5');
    expect(getTransactions()).toEqual([]);
  });

  it('rewrites the list once the rejected lines are safely set aside, even next to an older copy', () => {
    store.set(CORRUPT_KEY, JSON.stringify(['OLD COPY']));
    const raw = JSON.stringify([tx({ id: undefined }), { note: 'rejected', amount: '1,5' }]);
    store.set(KEY, raw);
    getTransactions();
    expect(copies()).toEqual(['OLD COPY', raw]);
    expect(JSON.parse(store.get(KEY) as string)).toHaveLength(1);
  });

  it('keeps unreadable lines after a later write', () => {
    store.set(CORRUPT_KEY, JSON.stringify(['OLD COPY']));
    const raw = JSON.stringify([tx(), { note: 'LOST?' }]);
    store.set(KEY, raw);
    addTransaction({ ...tx(), id: undefined } as never);
    expect(copies().some((c) => c.includes('LOST?'))).toBe(true);
  });

  it('gives the set aside copies back so that they can be downloaded', () => {
    expect(getUnreadableDataCopy()).toBeNull();
    store.set(KEY, '{broken');
    getTransactions();
    expect(getUnreadableDataCopy()).toContain('{broken');
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

describe('when the browser storage does not work', () => {
  const refuse = () => {
    throw new DOMException('denied', 'SecurityError');
  };

  it('reads an empty list and keeps new transactions in memory for the session', () => {
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(getTransactions()).toEqual([]);
    expect(hasUnreadableData()).toBe(false);
    const added = addTransaction({
      transaction_type: 'buy',
      currency_from: null,
      currency_to: 'BTC',
      amount: 1,
      price_per_unit: 1,
      total_value: 1,
      price_per_unit_usd: null,
      total_value_usd: null,
      transaction_date: '2026-01-01T10:00:00.000Z',
      notes: '',
    });
    expect(getTransactions().map((t) => t.id)).toEqual([added.id]);
    deleteTransaction(added.id);
    expect(getTransactions()).toEqual([]);
  });

  it('tells that the storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(isStorageUnavailable()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    resetSafeStorage();
    expect(isStorageUnavailable()).toBe(false);
  });
});

describe('storage that fills up', () => {
  // A storage that refuses a write once the stored text would exceed a size
  const limited = (limit: number) => {
    const data = new Map<string, string>();
    const size = (except?: string) =>
      [...data.entries()].reduce((sum, [k, v]) => sum + (k === except ? 0 : k.length + v.length), 0);
    return {
      data,
      api: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (size(k) + k.length + v.length > limit) throw new DOMException('full', 'QuotaExceededError');
          data.set(k, v);
        },
        removeItem: (k: string) => void data.delete(k),
      },
    };
  };

  it('never rewrites the list while the copy of what is dropped only exists in memory', () => {
    const { data, api } = limited(900);
    vi.stubGlobal('localStorage', api);
    const raw = JSON.stringify([tx({ id: undefined }), { note: 'x'.repeat(200), amount: 'abc' }]);
    data.set(KEY, raw);
    getTransactions(); // the copy does not fit: it stays in memory
    getTransactions(); // read again, as the dashboard does
    expect(data.get(KEY)).toBe(raw);
    expect(data.has(CORRUPT_KEY)).toBe(false);
  });

  it('stops saying that nothing is kept once the writes work again', () => {
    let refuse = true;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (refuse) throw new DOMException('full', 'QuotaExceededError');
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    });
    const entry = {
      transaction_type: 'buy' as const,
      currency_from: null,
      currency_to: 'BTC',
      amount: 1,
      price_per_unit: 1,
      total_value: 1,
      price_per_unit_usd: null,
      total_value_usd: null,
      transaction_date: '2026-01-01T10:00:00.000Z',
      notes: '',
    };
    addTransaction(entry);
    expect(isStorageUnavailable()).toBe(true);
    refuse = false;
    addTransaction(entry);
    expect(isStorageUnavailable()).toBe(false);
    expect(getTransactions()).toHaveLength(2);
  });
});

describe('degraded storage never costs the user data that is on disk', () => {
  const limited = (limit: number, refused: string[] = []) => {
    const data = new Map<string, string>();
    const size = (except?: string) =>
      [...data.entries()].reduce((sum, [k, v]) => sum + (k === except ? 0 : k.length + v.length), 0);
    return {
      data,
      api: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (refused.includes(k) || size(k) + k.length + v.length > limit) {
            throw new DOMException('full', 'QuotaExceededError');
          }
          data.set(k, v);
        },
        removeItem: (k: string) => void data.delete(k),
      },
    };
  };
  const entry = {
    transaction_type: 'buy' as const,
    currency_from: null,
    currency_to: 'DOGE',
    amount: 1,
    price_per_unit: 1,
    total_value: 1,
    price_per_unit_usd: null,
    total_value_usd: null,
    transaction_date: '2026-01-01T10:00:00.000Z',
    notes: '',
  };

  it('keeps the stored list, rejected lines included, while their copy is not durable', () => {
    const { data, api } = limited(1500);
    vi.stubGlobal('localStorage', api);
    const raw = JSON.stringify([tx({ id: 'v0' }), tx({ id: 'v1' }), tx({ id: 'v2' }), { junk: 'x'.repeat(100), amount: 'abc' }]);
    data.set(KEY, raw);
    getTransactions();
    expect(unreadableCopyStatus()).toBe('unsaved');

    // The cleaned list would fit now that the junk line is gone: it must still not replace the raw one
    const added = addTransaction(entry);
    expect(data.get(KEY)).toBe(raw);
    expect(getTransactions().map((t) => t.id)).toContain(added.id);
    expect(isListDurable()).toBe(false);
  });

  it('writes the list again once the copy of the rejected lines can be saved', () => {
    const { data, api } = limited(1500);
    vi.stubGlobal('localStorage', api);
    const raw = JSON.stringify([tx({ id: 'v0' }), tx({ id: 'v1' }), tx({ id: 'v2' }), { junk: 'x'.repeat(100), amount: 'abc' }]);
    data.set(KEY, raw);
    getTransactions();
    addTransaction(entry);
    // Room is made (the user frees space elsewhere)
    vi.stubGlobal('localStorage', limited(100000).api);
    const { data: roomy, api: roomyApi } = limited(100000);
    roomy.set(KEY, raw);
    vi.stubGlobal('localStorage', roomyApi);
    resetSafeStorage(); // new session on a storage with room: nothing is pending any more
    resetStorageState();
    getTransactions();
    expect(unreadableCopyStatus()).toBe('saved');
    expect(saveTransactions([tx({ id: 'only' })] as never)).toBe(true);
    expect(JSON.parse(roomy.get(KEY) as string)).toHaveLength(1);
  });

  it('keeps the ids of a list that cannot be rewritten the same between reads', () => {
    const { api } = limited(100000, [CORRUPT_KEY]);
    vi.stubGlobal('localStorage', api);
    store.clear();
    api.setItem(KEY, JSON.stringify([tx({ id: undefined, currency_to: 'BTC' }), tx({ id: undefined, currency_to: 'ETH' }), { junk: 1 }]));
    const first = getTransactions().map((t) => t.id);
    expect(getTransactions().map((t) => t.id)).toEqual(first);
    deleteTransaction(first[0]);
    expect(getTransactions().map((t) => t.currency_to)).toEqual(['ETH']);
  });

  it('does not overwrite a list that could not be read', () => {
    const original = JSON.stringify([tx({ id: 'a' }), tx({ id: 'b' })]);
    store.set(KEY, original);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        if (k === KEY) throw new Error('read refused');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(getTransactions()).toEqual([]);
    expect(isStorageUnavailable()).toBe(true);
    const added = addTransaction(entry);
    expect(store.get(KEY)).toBe(original);
    expect(getTransactions().map((t) => t.id)).toEqual([added.id]);
  });

  it('does not overwrite the copies it could not read either', () => {
    const copies = JSON.stringify(['older copy']);
    store.set(CORRUPT_KEY, copies);
    store.set(KEY, '{broken');
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        if (k === CORRUPT_KEY) throw new Error('read refused');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    getTransactions();
    expect(store.get(CORRUPT_KEY)).toBe(copies);
  });

  it('tells whether the list was really saved', () => {
    store.clear();
    expect(saveTransactions([tx()] as never)).toBe(true);
    expect(isListDurable()).toBe(true);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} });
    expect(saveTransactions([tx()] as never)).toBe(false);
    expect(isListDurable()).toBe(false);
  });
});
