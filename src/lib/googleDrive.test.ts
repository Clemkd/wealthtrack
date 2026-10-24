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
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [{ id: 'f1', name: 'b', modifiedTime: '2026-02-02T00:00:00Z' }] }),
    })
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

  it('restoring ids that are duplicated in the backup gives them distinct ids', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [validTx, validTx] }));
    const { transactions } = await drive.restoreFromDrive();
    expect(new Set(transactions.map((t) => t.id)).size).toBe(2);
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

describe('consumeRedirectResponse', () => {
  it('tells nothing happened, accepted, or rejected', () => {
    expect(drive.consumeRedirectResponse()).toBe('none');

    session.set(STATE_KEY, 'expected');
    win.location.hash = '#access_token=t&expires_in=3600&state=expected';
    expect(drive.consumeRedirectResponse()).toBe('accepted');

    win.location.hash = '#access_token=t&expires_in=3600&state=wrong';
    expect(drive.consumeRedirectResponse()).toBe('rejected');

    session.set(STATE_KEY, 'expected');
    win.location.hash = '#error=access_denied&state=expected';
    expect(drive.consumeRedirectResponse()).toBe('rejected');
  });
});

describe('signIn with redirect', () => {
  it('refuses to leave for Google when the state cannot be kept for the return', async () => {
    win.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => {} }) } } };
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {},
    });
    await expect(drive.signIn('client-id', true)).rejects.toThrow(/fenêtre/);
  });

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

  it('forgets the dead token of an expired session, so a reload does not show it as connected', async () => {
    signInWithStoredToken();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await drive.attemptBackup();
    expect(session.has(TOKEN_KEY)).toBe(false);
  });

  it('keeps the connection on other errors', async () => {
    signInWithStoredToken();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await drive.attemptBackup()).toMatchObject({ ok: false, connected: true });
  });
});

describe('backupToDrive', () => {
  const putLocal = (list: unknown[]) => local.set(TX_KEY, JSON.stringify(list));
  const MODIFIED = '2026-02-02T00:00:00Z';
  const found = { ok: true, json: async () => ({ files: [{ id: 'f1', name: 'b', modifiedTime: MODIFIED }] }) };
  const none = { ok: true, json: async () => ({ files: [] }) };
  const saved = { ok: true, json: async () => ({ id: 'f1', modifiedTime: MODIFIED }) };
  const remoteHolds = (transactions: unknown[]) => ({
    ok: true,
    text: async () => JSON.stringify({ transactions }),
  });
  const inSync = () => local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: false, lastBackupDate: MODIFIED, clientId: '' }));

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
    inSync();
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

  it('refuses to overwrite a backup that this device never synchronised, even with local data', async () => {
    signInWithStoredToken();
    putLocal([validTx]); // new device, one transaction entered
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(remoteHolds([validTx, validTx, validTx, validTx]));
    await expect(drive.backupToDrive()).rejects.toBeInstanceOf(drive.BackupConflictError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // search + read, no write
  });

  it('refuses when another device changed the backup since this one last synchronised', async () => {
    signInWithStoredToken();
    local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: false, lastBackupDate: '2026-01-01T00:00:00Z', clientId: '' }));
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(remoteHolds([validTx]));
    await expect(drive.backupToDrive()).rejects.toBeInstanceOf(drive.BackupConflictError);
  });

  it('lets a synchronised device back up an empty list (everything deleted on purpose)', async () => {
    signInWithStoredToken();
    inSync();
    putLocal([]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  it('overwrites on purpose when asked to', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive({ force: true })).resolves.toBeTruthy();
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  it('writes over a remote backup that holds no transaction', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock
      .mockResolvedValueOnce(found)
      .mockResolvedValueOnce(remoteHolds([]))
      .mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
  });

  it('refuses while unreadable local data is set aside, as the local list may be incomplete', async () => {
    signInWithStoredToken();
    inSync();
    local.set('wealthtrack_transactions_corrupt', JSON.stringify(['[lost]']));
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found);
    await expect(drive.backupToDrive()).rejects.toThrow(/illisibles/);
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'PATCH' || o?.method === 'POST')).toBe(false);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive({ force: true })).resolves.toBeTruthy();
  });

  it('explains a synchronisation conflict differently from unreadable data', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(remoteHolds([validTx]));
    await expect(drive.backupToDrive()).rejects.toThrow(/synchronisées/);
  });

  it('notices entries that became unreadable since the last read, before sending a partial list', async () => {
    signInWithStoredToken();
    inSync();
    local.set(TX_KEY, JSON.stringify([validTx, { junk: true }]));
    fetchMock.mockResolvedValueOnce(found);
    await expect(drive.backupToDrive()).rejects.toBeInstanceOf(drive.BackupConflictError);
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'PATCH' || o?.method === 'POST')).toBe(false);
  });

  it('lifts the unreadable data guard once Drive has been restored', async () => {
    signInWithStoredToken();
    local.set('wealthtrack_transactions_corrupt', JSON.stringify(['[lost]']));
    putLocal([validTx]);
    drive.recordRestore({ modifiedTime: MODIFIED, transactionsHash: 'h' });
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();

    // A different unreadable content set aside later is not covered by that restore
    local.set('wealthtrack_transactions_corrupt', JSON.stringify(['[lost]', '[lost later]']));
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(found);
    await expect(drive.backupToDrive()).rejects.toThrow(/illisibles/);
  });

  it('records the restore as the reference of what is on Drive', () => {
    drive.recordRestore({ modifiedTime: MODIFIED, transactionsHash: 'abc' });
    expect(drive.getGDriveSettings()).toMatchObject({ lastBackupDate: MODIFIED, lastBackedUpHash: 'abc' });
  });

  it('keeps the first fingerprint as the reference so that a change before a reload is not forgotten', () => {
    expect(drive.loadBackedUpBaseline('now')).toBe('now');
    expect(drive.getGDriveSettings().lastBackedUpHash).toBe('now');
    // Later loads start from the persisted reference, whatever the data is now
    expect(drive.loadBackedUpBaseline('changed')).toBe('now');
  });

  it('does not count a restore as a synchronisation by itself (the local save may still fail)', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [validTx, validTx] }));
    const restored = await drive.restoreFromDrive();
    expect(restored.modifiedTime).toBe('2026-02-02T00:00:00Z');
    expect(drive.getGDriveSettings().lastBackupDate).toBeNull();
  });

  it('keeps the other settings when a backup records its date', async () => {
    signInWithStoredToken();
    local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: true, lastBackupDate: MODIFIED, clientId: 'abc', lastBackedUpHash: 'h1' }));
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await drive.backupToDrive();
    expect(drive.getGDriveSettings()).toMatchObject({ autoBackup: true, clientId: 'abc', lastBackedUpHash: 'h1' });
  });

  it('writes over a remote file that is not a backup at all', async () => {
    signInWithStoredToken();
    putLocal([validTx]);
    fetchMock
      .mockResolvedValueOnce(found)
      .mockResolvedValueOnce({ ok: true, text: async () => 'not json' })
      .mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
  });

  it('is considered synchronised once the restore has been recorded', async () => {
    signInWithStoredToken();
    driveReturns(JSON.stringify({ transactions: [validTx] }));
    const { modifiedTime } = await drive.restoreFromDrive();
    drive.recordRestore({ modifiedTime, transactionsHash: 'h' });
    fetchMock.mockReset();
    putLocal([validTx]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(saved);
    await expect(drive.backupToDrive()).resolves.toBeTruthy();
  });

  it('does not write when the remote backup cannot be read (server error)', async () => {
    signInWithStoredToken();
    putLocal([]);
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(drive.backupToDrive()).rejects.toThrow(/503/);
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'PATCH' || o?.method === 'POST')).toBe(false);
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

  it('does not read the backup for a restore while a backup is being written', async () => {
    signInWithStoredToken();
    inSync();
    putLocal([validTx]);
    let running = 0;
    let maxRunning = 0;
    const log: string[] = [];
    fetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      const kind = String(url).includes('alt=media') ? 'media' : String(url).includes('/upload/') ? 'upload' : 'find';
      log.push(`${options?.method ?? 'GET'} ${kind}`);
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (kind === 'media') return { ok: true, text: async () => JSON.stringify({ transactions: [validTx] }) };
      return kind === 'upload' ? saved : found;
    });
    await Promise.all([drive.backupToDrive(), drive.restoreFromDrive()]);
    expect(maxRunning).toBe(1);
    expect(log.indexOf('PATCH upload')).toBeLessThan(log.indexOf('GET media'));
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
    expect(drive.getGDriveSettings()).toEqual({
      autoBackup: false,
      lastBackupDate: null,
      clientId: '',
      lastBackedUpHash: null,
      coveredUnreadableHash: null,
    });
  });

  it('fills the missing or mistyped fields of a partial object', () => {
    local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: 'yes', clientId: 'abc' }));
    expect(drive.getGDriveSettings()).toEqual({
      autoBackup: false,
      lastBackupDate: null,
      clientId: 'abc',
      lastBackedUpHash: null,
      coveredUnreadableHash: null,
    });
  });

  it('merges a change into what is stored now instead of a stale copy', () => {
    drive.saveGDriveSettings({ autoBackup: false, lastBackupDate: null, clientId: '', lastBackedUpHash: null, coveredUnreadableHash: null });
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

describe('when the browser storage does not work', () => {
  const refuse = () => {
    throw new DOMException('denied', 'SecurityError');
  };

  it('does not fail the Drive features that only keep small settings', () => {
    vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    expect(drive.restoreSession()).toBe(false);
    expect(drive.getGDriveSettings().autoBackup).toBe(false);
    expect(drive.loadBackedUpBaseline('now')).toBe('now');
    expect(() => drive.signOut()).not.toThrow();
    expect(drive.handleRedirectResponse()).toBe(false);
  });
});

describe('when the list could not be saved on this device', () => {
  const found = { ok: true, json: async () => ({ files: [{ id: 'f1', name: 'b', modifiedTime: '2026-02-02T00:00:00Z' }] }) };
  const remoteHolds = (transactions: unknown[]) => ({
    ok: true,
    text: async () => JSON.stringify({ transactions }),
  });
  const refuseList = () =>
    vi.stubGlobal('localStorage', {
      ...storage(local),
      setItem: (k: string, v: string) => {
        if (k === TX_KEY) throw new DOMException('full', 'QuotaExceededError');
        local.set(k, v);
      },
    });

  it('does not make a restore count as a synchronisation after a reload', async () => {
    signInWithStoredToken();
    local.set(SETTINGS_KEY, JSON.stringify({ autoBackup: false, lastBackupDate: 'old', clientId: '' }));
    putOld();
    refuseList();
    driveReturns(JSON.stringify({ transactions: [validTx, { ...validTx, id: 'b' }] }));
    const restored = await drive.restoreFromDrive();
    const storage_ = await import('./storage');
    expect(storage_.saveTransactions(restored.transactions)).toBe(false);
    drive.recordRestore({ modifiedTime: restored.modifiedTime, transactionsHash: 'h' });

    // This session sees the restore as done ...
    expect(drive.getGDriveSettings().lastBackupDate).toBe(restored.modifiedTime);
    // ... but what is stored still says the last synchronisation was the old one
    expect(JSON.parse(local.get(SETTINGS_KEY) as string).lastBackupDate).toBe('old');

    // After a reload the old local list must not overwrite Drive
    vi.resetModules();
    session.set(TOKEN_KEY, JSON.stringify({ accessToken: 'tok', tokenExpiresAt: Date.now() + 3_600_000 }));
    drive = await import('./googleDrive');
    expect(drive.restoreSession()).toBe(true);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(found).mockResolvedValueOnce(remoteHolds([validTx, validTx, validTx]));
    await expect(drive.backupToDrive()).rejects.toBeInstanceOf(drive.BackupConflictError);
  });

  it('keeps the backup reference of the session while the list is not saved, and persists it once it is', async () => {
    signInWithStoredToken();
    putOld();
    refuseList();
    const storage_ = await import('./storage');
    storage_.saveTransactions([validTx as never]);
    drive.updateGDriveSettings({ lastBackedUpHash: 'session' });
    expect(drive.getGDriveSettings().lastBackedUpHash).toBe('session');
    expect(local.get(SETTINGS_KEY)).toBeUndefined();
  });

  const putOld = () => local.set(TX_KEY, JSON.stringify([validTx]));
});
