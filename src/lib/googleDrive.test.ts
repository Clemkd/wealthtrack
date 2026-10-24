import { beforeEach, describe, expect, it, vi } from 'vitest';

type Drive = typeof import('./googleDrive');

const TOKEN_KEY = 'wealthtrack_gdrive_token';
const STATE_KEY = 'wealthtrack_gdrive_oauth_state';

const session = new Map<string, string>();
const local = new Map<string, string>();
const fetchMock = vi.fn();
const replaceState = vi.fn();
let win: { location: { hash: string; pathname: string; search: string; origin: string }; history: unknown; google?: unknown };
let drive: Drive;

const storage = (map: Map<string, string>) => ({
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => void map.set(k, v),
  removeItem: (k: string) => void map.delete(k),
});

const validTx = {
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

const signInWithStoredToken = () => {
  session.set(TOKEN_KEY, JSON.stringify({ accessToken: 'tok', tokenExpiresAt: Date.now() + 3_600_000 }));
  expect(drive.restoreSession()).toBe(true);
};

const driveReturns = (backupJson: string) => {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ id: 'f1', name: 'b' }] }) })
    .mockResolvedValueOnce({ ok: true, text: async () => backupJson });
};

beforeEach(async () => {
  session.clear();
  local.clear();
  fetchMock.mockReset();
  replaceState.mockReset();
  win = {
    location: { hash: '', pathname: '/wealthtrack/', search: '', origin: 'https://example.github.io' },
    history: { replaceState },
  };
  vi.resetModules();
  vi.stubGlobal('sessionStorage', storage(session));
  vi.stubGlobal('localStorage', storage(local));
  vi.stubGlobal('window', win);
  vi.stubGlobal('fetch', fetchMock);
  drive = await import('./googleDrive');
});

describe('restoreFromDrive', () => {
  it('returns the valid transactions of a backup', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [validTx] }));
    const result = await drive.restoreFromDrive();
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it('drops malformed entries and reports them', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [validTx, null, { ...validTx, id: 'b', price_per_unit: undefined }] }));
    const result = await drive.restoreFromDrive();
    expect(result.transactions.map((t) => t.id)).toEqual(['a']);
    expect(result.skipped).toBe(2);
  });

  it('refuses a backup whose transactions are all unusable', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [null, 42] }));
    await expect(drive.restoreFromDrive()).rejects.toThrow(/aucune transaction valide/i);
  });

  it('accepts a genuinely empty backup', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [] }));
    expect((await drive.restoreFromDrive()).transactions).toEqual([]);
  });

  it('refuses a file that is not a backup', async () => {
    signInWithStoredToken();
    driveReturns('not json');
    await expect(drive.restoreFromDrive()).rejects.toThrow(/corrompu/i);
  });
});

describe('handleRedirectResponse', () => {
  const answer = (state?: string) =>
    `#access_token=attacker-token&expires_in=3600${state ? `&state=${state}` : ''}`;

  it('ignores a token in the URL when no sign-in was started, and clears it', () => {
    win.location.hash = answer('whatever');
    expect(drive.handleRedirectResponse()).toBe(false);
    expect(drive.isSignedIn()).toBe(false);
    expect(replaceState).toHaveBeenCalled();
  });

  it('ignores a token whose state does not match the one that was issued', () => {
    session.set(STATE_KEY, 'expected');
    win.location.hash = answer('other');
    expect(drive.handleRedirectResponse()).toBe(false);
    expect(drive.isSignedIn()).toBe(false);
  });

  it('ignores a token without state', () => {
    session.set(STATE_KEY, 'expected');
    win.location.hash = answer();
    expect(drive.handleRedirectResponse()).toBe(false);
  });

  it('accepts a token with the issued state, once', () => {
    session.set(STATE_KEY, 'expected');
    win.location.hash = answer('expected');
    expect(drive.handleRedirectResponse()).toBe(true);
    expect(drive.isSignedIn()).toBe(true);
    expect(session.has(STATE_KEY)).toBe(false);

    win.location.hash = answer('expected');
    drive.signOut();
    expect(drive.handleRedirectResponse()).toBe(false);
  });

  it('does nothing without a hash', () => {
    expect(drive.handleRedirectResponse()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('signIn with redirect', () => {
  it('issues a random state, remembers it and sends it to Google', () => {
    let config: { state?: string; ux_mode?: string } = {};
    win.google = {
      accounts: {
        oauth2: {
          initTokenClient: (c: typeof config) => {
            config = c;
            return { requestAccessToken: () => {} };
          },
        },
      },
    };
    void drive.signIn('client-id', true);
    expect(config.ux_mode).toBe('redirect');
    expect(config.state).toBeTruthy();
    expect(session.get(STATE_KEY)).toBe(config.state);
  });
});

describe('attemptBackup', () => {
  it('reports success with the backup date', async () => {
    signInWithStoredToken();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'f', modifiedTime: '2026-01-01T00:00:00Z' }) });
    expect(await drive.attemptBackup()).toEqual({ ok: true, date: '2026-01-01T00:00:00Z' });
  });

  it('reports an expired session so the interface stops showing "connected"', async () => {
    signInWithStoredToken();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    const result = await drive.attemptBackup();
    expect(result).toMatchObject({ ok: false, connected: false });
    expect(drive.isSignedIn()).toBe(false);
  });

  it('keeps the connection on other errors', async () => {
    signInWithStoredToken();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await drive.attemptBackup()).toMatchObject({ ok: false, connected: true });
  });
});
