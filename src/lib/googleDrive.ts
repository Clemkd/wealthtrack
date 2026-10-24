import { Transaction } from '../types/database';
import { getTransactions, getUnreadableDataCopy } from './storage';
import { signatureHash } from './autoBackup';
import { safeLocal, safeSession } from './safeStorage';
import { dedupeIds, normalizeTransaction } from './transactions';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_API_BASE = 'https://www.googleapis.com';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload';
const BACKUP_FILENAME = 'wealthtrack_backup.json';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const SETTINGS_KEY = 'wealthtrack_gdrive_settings';
const TOKEN_KEY = 'wealthtrack_gdrive_token';
const STATE_KEY = 'wealthtrack_gdrive_oauth_state';

export interface GDriveSettings {
  autoBackup: boolean;
  lastBackupDate: string | null;
  clientId: string;
  // Fingerprint of the transactions as of the last backup or restore
  lastBackedUpHash: string | null;
  // Fingerprint of the set aside unreadable data that a restore has made harmless
  coveredUnreadableHash: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface DriveFileList {
  files: DriveFile[];
}

let accessToken: string | null = null;
let tokenExpiresAt = 0;

// --- Token Persistence ---

function persistToken(): void {
  if (accessToken && tokenExpiresAt > Date.now()) {
    safeSession.setItem(TOKEN_KEY, JSON.stringify({ accessToken, tokenExpiresAt }));
  } else {
    safeSession.removeItem(TOKEN_KEY);
  }
}

function clearPersistedToken(): void {
  safeSession.removeItem(TOKEN_KEY);
}

export function restoreSession(): boolean {
  if (accessToken && Date.now() < tokenExpiresAt) return true;
  const raw = safeSession.getItem(TOKEN_KEY);
  if (!raw) return false;
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === 'object' && data !== null &&
      'accessToken' in data && typeof (data as Record<string, unknown>).accessToken === 'string' &&
      'tokenExpiresAt' in data && typeof (data as Record<string, unknown>).tokenExpiresAt === 'number'
    ) {
      const parsed = data as { accessToken: string; tokenExpiresAt: number };
      if (parsed.tokenExpiresAt > Date.now()) {
        accessToken = parsed.accessToken;
        tokenExpiresAt = parsed.tokenExpiresAt;
        return true;
      }
    }
    clearPersistedToken();
    return false;
  } catch {
    clearPersistedToken();
    return false;
  }
}

// --- Settings ---

export function getGDriveSettings(): GDriveSettings {
  const settings: GDriveSettings = {
    autoBackup: false,
    lastBackupDate: null,
    clientId: '',
    lastBackedUpHash: null,
    coveredUnreadableHash: null,
  };
  const raw = safeLocal.getItem(SETTINGS_KEY);
  if (!raw) return settings;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return settings;
    const stored = data as Record<string, unknown>;
    return {
      autoBackup: typeof stored.autoBackup === 'boolean' ? stored.autoBackup : settings.autoBackup,
      lastBackupDate:
        typeof stored.lastBackupDate === 'string' ? stored.lastBackupDate : settings.lastBackupDate,
      clientId: typeof stored.clientId === 'string' ? stored.clientId : settings.clientId,
      lastBackedUpHash:
        typeof stored.lastBackedUpHash === 'string' ? stored.lastBackedUpHash : settings.lastBackedUpHash,
      coveredUnreadableHash:
        typeof stored.coveredUnreadableHash === 'string'
          ? stored.coveredUnreadableHash
          : settings.coveredUnreadableHash,
    };
  } catch {
    return settings;
  }
}

export function saveGDriveSettings(settings: GDriveSettings): void {
  safeLocal.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Applies a change on top of what is stored now, not on a copy that may predate a
// backup which recorded its date in the meantime.
export function updateGDriveSettings(changes: Partial<GDriveSettings>): GDriveSettings {
  const merged = { ...getGDriveSettings(), ...changes };
  saveGDriveSettings(merged);
  return merged;
}

// --- Script Loading ---

const scriptLoads = new Map<string, Promise<void>>();

// One load per script: a second caller waits for the first one, and a failed load
// is forgotten (its tag removed) so that it can be retried.
function loadScript(src: string): Promise<void> {
  const pending = scriptLoads.get(src);
  if (pending) return pending;

  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoads.delete(src);
      reject(new Error(`Impossible de charger ${src}`));
    };
    document.head.appendChild(script);
  });
  scriptLoads.set(src, load);
  return load;
}

export async function initGoogleDrive(): Promise<void> {
  await loadScript(GIS_SCRIPT_URL);
}

// --- Authentication ---

export function isSignedIn(): boolean {
  return accessToken !== null && Date.now() < tokenExpiresAt;
}

// A random value sent with the sign-in request and checked on return: without it,
// anyone could make the app sign in with their own token through a crafted link.
function beginRedirectFlow(): string {
  const state = crypto.randomUUID();
  safeSession.setItem(STATE_KEY, state);
  return state;
}

export function handleRedirectResponse(): boolean {
  const hash = window.location.hash;
  if (!hash) return false;

  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');
  // A refusal (#error=...) is cleaned up like an answer carrying a token
  if (!token && !params.get('error')) return false;

  const expectedState = safeSession.getItem(STATE_KEY);
  safeSession.removeItem(STATE_KEY);
  // The token never stays in the address bar, whether it is accepted or not
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!token) return false;

  const expiresIn = parseInt(params.get('expires_in') ?? '', 10);
  if (!expectedState || params.get('state') !== expectedState || !Number.isFinite(expiresIn)) {
    return false;
  }

  accessToken = token;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  persistToken();
  return true;
}

function getRedirectUri(): string {
  return window.location.origin + window.location.pathname;
}

export function signIn(clientId: string, useRedirect = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services non chargé'));
      return;
    }

    const config: Parameters<GoogleOAuth2['initTokenClient']>[0] = {
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Erreur d'authentification: ${response.error}`));
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + response.expires_in * 1000;
        persistToken();
        resolve(response.access_token);
      },
    };

    if (useRedirect) {
      config.ux_mode = 'redirect';
      config.redirect_uri = getRedirectUri();
      config.state = beginRedirectFlow();
    } else {
      config.error_callback = (error) => {
        reject(new Error(`Erreur d'authentification: ${error.type || 'unknown'}`));
      };
    }

    const client = oauth2.initTokenClient(config);
    client.requestAccessToken();
  });
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  clearPersistedToken();
}

// --- Drive API Helpers ---

async function driveApiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!accessToken) throw new Error('Non connecté à Google Drive');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  if (options.headers) {
    const extra = options.headers as Record<string, string>;
    Object.assign(headers, extra);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      accessToken = null;
      tokenExpiresAt = 0;
      clearPersistedToken();
      throw new Error('Session expirée. Veuillez vous reconnecter.');
    }
    throw new Error(`Erreur Google Drive (${response.status})`);
  }

  return response;
}

async function findBackupFile(): Promise<DriveFile | null> {
  const query = encodeURIComponent(`name='${BACKUP_FILENAME}'`);
  const response = await driveApiFetch(
    `${DRIVE_API_BASE}/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`
  );
  const data: DriveFileList = await response.json();
  return data.files?.[0] ?? null;
}

async function createBackupFile(content: string): Promise<DriveFile> {
  const metadata = {
    name: BACKUP_FILENAME,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  };

  const boundary = 'wealthtrack_boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const response = await driveApiFetch(
    `${DRIVE_UPLOAD_BASE}/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  return response.json();
}

async function updateBackupFile(fileId: string, content: string): Promise<DriveFile> {
  const response = await driveApiFetch(
    `${DRIVE_UPLOAD_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    }
  );
  return response.json();
}

async function readBackupFile(fileId: string): Promise<string> {
  const response = await driveApiFetch(
    `${DRIVE_API_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  return response.text();
}

// --- Public API ---

// A failed read (network, 5xx, 403...) throws and cancels the backup: only a file
// that is really not a backup counts as having nothing to protect.
async function remoteBackupHasTransactions(fileId: string): Promise<boolean> {
  const content = await readBackupFile(fileId);
  try {
    const data: unknown = JSON.parse(content);
    const list = (data as { transactions?: unknown } | null)?.transactions;
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

const NOT_SYNCHRONISED_MESSAGE =
  "Sauvegarde annulée : la sauvegarde Google Drive contient des transactions que cet appareil n'a pas synchronisées (autre appareil, ou première connexion). Restaurez-la d'abord.";
const UNREADABLE_DATA_MESSAGE =
  'Sauvegarde annulée : des données locales illisibles ont été écartées, la liste de cet appareil est peut-être incomplète. Téléchargez la copie et acquittez l\'avertissement, ou restaurez Google Drive.';

export class BackupConflictError extends Error {
  constructor(message = NOT_SYNCHRONISED_MESSAGE) {
    super(message);
    this.name = 'BackupConflictError';
  }
}

// Unreadable data is set aside while reading, so the list is read first: entries
// that became unreadable since the last read are noticed before anything is sent.
function hasUncoveredUnreadableData(): boolean {
  const copy = getUnreadableDataCopy();
  return copy !== null && signatureHash(copy) !== getGDriveSettings().coveredUnreadableHash;
}

async function runBackup(force: boolean): Promise<string> {
  const transactions = getTransactions();
  if (!force && hasUncoveredUnreadableData()) throw new BackupConflictError(UNREADABLE_DATA_MESSAGE);

  const existing = await findBackupFile();

  // The file is only replaced when it is the one this device last wrote or restored.
  // Otherwise (new device, another device backed up since) it may hold data that
  // would be lost, whatever the local list contains.
  if (
    !force &&
    existing &&
    existing.modifiedTime !== getGDriveSettings().lastBackupDate &&
    (await remoteBackupHasTransactions(existing.id))
  ) {
    throw new BackupConflictError();
  }

  const content = JSON.stringify({ transactions, exportedAt: new Date().toISOString() });
  const file = existing
    ? await updateBackupFile(existing.id, content)
    : await createBackupFile(content);

  const now = file.modifiedTime ?? new Date().toISOString();
  updateGDriveSettings({ lastBackupDate: now });
  return now;
}

let backupQueue: Promise<unknown> = Promise.resolve();

// Everything that reads or writes the Drive file goes through one queue: two backups
// at once could create two files, or let an older state finish last; a restore that
// read while a backup was overwriting the file would restore the amputated state.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = backupQueue.then(task, task);
  backupQueue = result.catch(() => undefined);
  return result;
}

export function backupToDrive(options: { force?: boolean } = {}): Promise<string> {
  return enqueue(() => runBackup(options.force === true));
}

export function restoreFromDrive(): Promise<RestoreResult> {
  return enqueue(runRestore);
}

// Called once a restore is really saved locally: this device is then in sync with
// that file, what is on Drive is what is held here, and the unreadable data that was
// set aside no longer makes the local list suspect.
export function recordRestore(restore: { modifiedTime: string | null; transactionsHash: string }): void {
  const copy = getUnreadableDataCopy();
  updateGDriveSettings({
    lastBackupDate: restore.modifiedTime,
    lastBackedUpHash: restore.transactionsHash,
    coveredUnreadableHash: copy === null ? null : signatureHash(copy),
  });
}

// The fingerprint that the data is compared with to know whether a backup is due:
// the persisted one, or the current one the first time (and then persisted, so that
// a change made before a reload is not forgotten).
export function loadBackedUpBaseline(currentHash: string): string {
  const stored = getGDriveSettings().lastBackedUpHash;
  if (stored !== null) return stored;
  updateGDriveSettings({ lastBackedUpHash: currentHash });
  return currentHash;
}

export interface RestoreResult {
  transactions: Transaction[];
  skipped: number;
  // Version of the Drive file that was read. The caller records it as synchronised
  // once the transactions are really saved locally.
  modifiedTime: string | null;
}

async function runRestore(): Promise<RestoreResult> {
  const file = await findBackupFile();
  if (!file) throw new Error('Aucune sauvegarde trouvée sur Google Drive');

  const content = await readBackupFile(file.id);

  let data: { transactions?: unknown };
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Le fichier de sauvegarde est corrompu');
  }

  if (!data || !Array.isArray(data.transactions)) {
    throw new Error('Le fichier de sauvegarde est invalide');
  }

  const transactions = dedupeIds(
    data.transactions.map(normalizeTransaction).filter((tx): tx is Transaction => tx !== null)
  ).transactions;
  if (data.transactions.length > 0 && transactions.length === 0) {
    throw new Error(
      'Aucune transaction valide dans la sauvegarde : la restauration est annulée, vos données actuelles sont conservées.'
    );
  }
  return {
    transactions,
    skipped: data.transactions.length - transactions.length,
    modifiedTime: file.modifiedTime ?? null,
  };
}

export type BackupAttempt =
  | { ok: true; date: string }
  | { ok: false; message: string; connected: boolean };

// Backup that reports instead of throwing, with the connection state after the
// attempt (an expired session must not keep showing as connected).
export async function attemptBackup(): Promise<BackupAttempt> {
  try {
    return { ok: true, date: await backupToDrive() };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Erreur lors de la sauvegarde',
      connected: isSignedIn(),
    };
  }
}

export async function getBackupInfo(): Promise<{ modifiedTime: string } | null> {
  const file = await findBackupFile();
  if (!file?.modifiedTime) return null;
  return { modifiedTime: file.modifiedTime };
}
