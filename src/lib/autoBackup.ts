import { Transaction } from '../types/database';

// Identifies the content of the list, whatever its order.
export function transactionsSignature(transactions: Transaction[]): string {
  return JSON.stringify([...transactions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

// Short fingerprint (FNV-1a), small enough to be kept in the settings.
export function signatureHash(signature: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export interface AutoBackupState {
  signature: string;
  // Fingerprint of the last state known to be on Drive
  lastBackedUp: string;
  autoBackup: boolean;
  connected: boolean;
}

// A backup is due when the data differs from what is on Drive: not on page load,
// not when only the connection or the option changed, and again after a pending
// backup was cancelled by a re-render.
export function shouldScheduleBackup(state: AutoBackupState): boolean {
  return state.signature !== state.lastBackedUp && state.autoBackup && state.connected;
}
