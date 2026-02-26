import { Transaction } from '../types/database';
import { getTransactions } from './storage';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_API_BASE = 'https://www.googleapis.com';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload';
const BACKUP_FILENAME = 'wealthtrack_backup.json';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const SETTINGS_KEY = 'wealthtrack_gdrive_settings';

export interface GDriveSettings {
  autoBackup: boolean;
  lastBackupDate: string | null;
  clientId: string;
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

// --- Settings ---

export function getGDriveSettings(): GDriveSettings {
  const defaults: GDriveSettings = { autoBackup: false, lastBackupDate: null, clientId: '' };
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    return JSON.parse(raw) as GDriveSettings;
  } catch {
    return defaults;
  }
}

export function saveGDriveSettings(settings: GDriveSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// --- Script Loading ---

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
    document.head.appendChild(script);
  });
}

export async function initGoogleDrive(): Promise<void> {
  await loadScript(GIS_SCRIPT_URL);
}

// --- Authentication ---

export function isSignedIn(): boolean {
  return accessToken !== null && Date.now() < tokenExpiresAt;
}

export function signIn(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error('Google Identity Services non chargé'));
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Erreur d'authentification: ${response.error}`));
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + response.expires_in * 1000;
        resolve(response.access_token);
      },
    });

    client.requestAccessToken();
  });
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
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

export async function backupToDrive(): Promise<string> {
  const transactions = getTransactions();
  const content = JSON.stringify({
    transactions,
    exportedAt: new Date().toISOString(),
  });

  const existing = await findBackupFile();
  const file = existing
    ? await updateBackupFile(existing.id, content)
    : await createBackupFile(content);

  const now = file.modifiedTime ?? new Date().toISOString();
  const settings = getGDriveSettings();
  saveGDriveSettings({ ...settings, lastBackupDate: now });
  return now;
}

export async function restoreFromDrive(): Promise<Transaction[]> {
  const file = await findBackupFile();
  if (!file) throw new Error('Aucune sauvegarde trouvée sur Google Drive');

  const content = await readBackupFile(file.id);

  let data: { transactions?: unknown };
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Le fichier de sauvegarde est corrompu');
  }

  if (!data.transactions || !Array.isArray(data.transactions)) {
    throw new Error('Le fichier de sauvegarde est invalide');
  }

  return data.transactions as Transaction[];
}

export async function getBackupInfo(): Promise<{ modifiedTime: string } | null> {
  const file = await findBackupFile();
  if (!file?.modifiedTime) return null;
  return { modifiedTime: file.modifiedTime };
}
