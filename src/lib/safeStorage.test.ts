import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSafeStorage, safeLocal, safeSession } from './safeStorage';

const working = () => {
  const data = new Map<string, string>();
  return {
    data,
    api: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  };
};

beforeEach(() => resetSafeStorage());
afterEach(() => vi.unstubAllGlobals());

describe('safeStorage', () => {
  it('reads and writes the browser storage when it works', () => {
    const { data, api } = working();
    vi.stubGlobal('localStorage', api);
    expect(safeLocal.setItem('k', 'v')).toBe(true);
    expect(data.get('k')).toBe('v');
    expect(safeLocal.getItem('k')).toBe('v');
    safeLocal.removeItem('k');
    expect(safeLocal.getItem('k')).toBeNull();
    expect(safeLocal.hasFailed()).toBe(false);
  });

  it('does not throw when reading is refused (blocked cookies and site data)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(safeLocal.getItem('k')).toBeNull();
    expect(() => safeLocal.removeItem('k')).not.toThrow();
    expect(safeLocal.hasFailed()).toBe(true);
  });

  it('does not throw when the storage object itself cannot be reached', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(safeLocal.getItem('k')).toBeNull();
      expect(safeLocal.setItem('k', 'v')).toBe(false);
      expect(safeLocal.getItem('k')).toBe('v');
    } finally {
      // Remove the throwing property so the following tests can stub it again
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('keeps what could not be saved in memory for the rest of the session', () => {
    const { data, api } = working();
    vi.stubGlobal('localStorage', {
      ...api,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    expect(safeLocal.setItem('k', 'v')).toBe(false);
    expect(safeLocal.getItem('k')).toBe('v');
    expect(data.has('k')).toBe(false);
    expect(safeLocal.hasFailed()).toBe(true);
  });

  it('tells which values live in memory only', () => {
    const { api } = working();
    let full = true;
    vi.stubGlobal('localStorage', {
      ...api,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException('full', 'QuotaExceededError');
        api.setItem(k, v);
      },
    });
    safeLocal.setItem('k', 'v');
    expect(safeLocal.isInMemory('k')).toBe(true);
    expect(safeLocal.hasUnsaved()).toBe(true);
    full = false;
    safeLocal.setItem('k', 'v2');
    expect(safeLocal.isInMemory('k')).toBe(false);
    expect(safeLocal.hasUnsaved()).toBe(false);
  });

  it('tells a failed read from a missing value', () => {
    const { data, api } = working();
    data.set('k', 'v');
    vi.stubGlobal('localStorage', api);
    expect(safeLocal.read('k')).toEqual({ value: 'v', failed: false });
    expect(safeLocal.read('missing')).toEqual({ value: null, failed: false });
    vi.stubGlobal('localStorage', {
      ...api,
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(safeLocal.read('k')).toEqual({ value: null, failed: true });
  });

  it('can keep a value in memory only, without touching the stored one', () => {
    const { data, api } = working();
    data.set('k', 'stored');
    vi.stubGlobal('localStorage', api);
    safeLocal.setItemInMemory('k', 'session');
    expect(data.get('k')).toBe('stored');
    expect(safeLocal.getItem('k')).toBe('session');
    expect(safeLocal.isInMemory('k')).toBe(true);
    expect(safeLocal.hasUnsaved()).toBe(true);
  });

  it('hides a value it could not remove', () => {
    const { data, api } = working();
    data.set('k', 'old');
    vi.stubGlobal('localStorage', {
      ...api,
      removeItem: () => {
        throw new Error('nope');
      },
    });
    safeLocal.removeItem('k');
    expect(safeLocal.getItem('k')).toBeNull();
  });

  it('tells whether the storage can be used at all', () => {
    vi.stubGlobal('localStorage', working().api);
    expect(safeLocal.probe()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {},
    });
    expect(safeLocal.probe()).toBe(false);
  });

  it('has a separate session storage', () => {
    vi.stubGlobal('localStorage', working().api);
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    });
    expect(safeSession.getItem('k')).toBeNull();
    expect(safeLocal.hasFailed()).toBe(false);
    expect(safeSession.hasFailed()).toBe(true);
  });
});
