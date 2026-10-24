import { beforeEach, describe, expect, it, vi } from 'vitest';

type Drive = typeof import('./googleDrive');

const TOKEN_KEY = 'wealthtrack_gdrive_token';
const STATE_KEY = 'wealthtrack_gdrive_oauth_state';
const SETTINGS_KEY = 'wealthtrack_gdrive_settings';
const TX_KEY = 'wealthtrack_transactions';

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

describe('backupToDrive', () => {
  const putLocal = (list: unknown[]) => local.set(TX_KEY, JSON.stringify(list));
  const found = { ok: true, json: async () => ({ files: [{ id: 'f1', name: 'b' }] }) };
  const none = { ok: true, json: async () => ({ files: [] }) };
  const saved = { ok: true, json: async () => ({ id: 'f1', modifiedTime: '2026-02-02T00:00:00Z' }) };

  it('creates the backup file when none exists, with the local transactions', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(none).mockResolvedValueOnce(saved);
    await drive.backupToDrive();
    const [url, options] = fetchMock.mock.calls[1];
    expect(options.method).toBe('POST');
    expect(String(url)).toContain('uploadType=multipart');
    expect(options.body).toContain('"currency_to":"BTC"');
  });

  it('updates the existing file', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await drive.backupToDrive();
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  it('refuses to replace a backup that has transactions by an empty local list', async () => {
    signInWithStoredToken();
    putLocal([]);
    fetchMock
      .mockResolvedValueOnce(found)
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ transactions: [validTx] }) });
    await expect(drive.backupToDrive()).rejects.toThrow(/restaur/i);
    expect(fetchMock).toHaveBeenCalledTimes(2); // search + read, no write
  });

  it('accepts an empty local list when the remote backup is empty or absent', async () => {
    signInWithStoredToken();
    putLocal([]);
    fetchMock.mockResolvedValueOnce(none).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
  });

  it('runs concurrent backups one after the other and creates a single file', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    let created = false;
    let running = 0;
    let maxRunning = 0;
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (String(url).includes('/upload/') && options?.method === 'POST') {
        created = true;
        return saved;
      }
      if (String(url).includes('/upload/')) return saved;
      return created ? found : none;
    });
    await Promise.all([drive.backupToDrive(), drive.backupToDrive()]);
    const creations = fetchMock.mock.calls.filter(([, o]) => o?.method === 'POST').length;
    expect(creations).toBe(1);
    expect(maxRunning).toBe(1);
  });

  it('keeps working after a failed backup', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(drive.backupToDrive()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(none).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
  });
});

describe('session', () => {
  it('does not restore an expired token', () => {
    session.set(TOKEN_KEY, JSON.stringify({ accessToken: 'tok', tokenExpiresAt: Date.now() - 1000 }));
    expect(drive.restoreSession()).toBe(false);
    expect(session.has(TOKEN_KEY)).toBe(false);
  });

  it('rejects a redirect answer with an unreadable expires_in', () => {
    session.set(STATE_KEY, 'expected');
    win.location.hash = '#access_token=t&expires_in=abc&state=expected';
    expect(drive.handleRedirectResponse()).toBe(false);
    expect(drive.isSignedIn()).toBe(false);
  });

  it('clears an error answer from the address bar', () => {
    session.set(STATE_KEY, 'expected');
    win.location.hash = '#error=access_denied&state=expected';
    drive.handleRedirectResponse();
    expect(replaceState).toHaveBeenCalled();
    expect(session.has(STATE_KEY)).toBe(false);
  });
});

describe('settings', () => {
  it.each(['null', '"text"', '42', '[]', 'not json'])('falls back to defaults for %s', (raw) => {
    local.set(SETTINGS_KEY, raw);
    expect(drive.getGDriveSettings()).toEqual({ autoBackup: false, lastBackupDate: null, clientId: '' });
  });

  it('fills the missing or mistyped fields of a partial object', () => {
    local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: 'yes', clientId: 'abc' }));
    expect(drive.getGDriveSettings()).toEqual({ autoBackup: false, lastBackupDate: null, clientId: 'abc' });
  });

  it('merges a change into what is stored now instead of a stale copy', () => {
    drive.saveGDriveSettings({ autoBackup: false, lastBackupDate: null, clientId: '' });
    // A backup finishing elsewhere records its date
    local.set(
      SETTINGS_KEY,
      JSON.stringify({ autoBackup: false, lastBackupDate: '2026-02-02T00:00:00Z', clientId: '' })
    );
    const merged = drive.updateGDriveSettings({ autoBackup: true });
    expect(merged.lastBackupDate).toBe('2026-02-02T00:00:00Z');
    expect(drive.getGDriveSettings()).toEqual(merged);
  });
});

describe('Google script loading', () => {
  type Fake = { src?: string; onload?: () => void; onerror?: () => void; remove: () => void };
  let appended: Fake[];

  beforeEach(() => {
    appended = [];
    vi.stubGlobal('document', {
      querySelector: (selector: string) => appended.find((s) => selector.includes(String(s.src))) ?? null,
      createElement: () => {
        const el: Fake = {
          remove: () => {
            const i = appended.indexOf(el);
            if (i >= 0) appended.splice(i, 1);
          },
        };
        return el;
      },
      head: { appendChild: (el: Fake) => void appended.push(el) },
    });
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('loads the script once, even when asked twice at the same time', async () => {
    const first = drive.initGoogleDrive();
    const second = drive.initGoogleDrive();
    expect(appended).toHaveLength(1);
    appended[0].onload?.();
    await Promise.all([first, second]);
  });

  it('waits for the script instead of reporting success while it loads', async () => {
    let done = false;
    const first = drive.initGoogleDrive();
    void drive.initGoogleDrive().then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    appended[0].onload?.();
    await first;
    await settle();
    expect(done).toBe(true);
  });

  it('removes a script that failed to load and loads a fresh one on retry', async () => {
    const first = drive.initGoogleDrive();
    appended[0].onerror?.();
    await expect(first).rejects.toThrow();
    expect(appended).toHaveLength(0);

    const retry = drive.initGoogleDrive();
    expect(appended).toHaveLength(1);
    appended[0].onload?.();
    await retry;
  });
});
