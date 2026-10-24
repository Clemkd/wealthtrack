import { Transaction } from '../types/database';

// Identifies the content of the list, whatever its order.
export function transactionsSignature(transactions: Transaction[]): string {
  return JSON.stringify([...transactions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

export interface AutoBackupState {
  signature: string;
  // Signature of the last state known to be on Drive (null until the first render)
  lastBackedUp: string | null;
  autoBackup: boolean;
  connected: boolean;
}

// A backup is due when the data differs from what is on Drive: not on page load,
// not when only the connection or the option changed, and again after a pending
// backup was cancelled by a re-render.
export function shouldScheduleBackup(state: AutoBackupState): boolean {
  return (
    state.lastBackedUp !== null &&
    state.signature !== state.lastBackedUp &&
    state.autoBackup &&
    state.connected
  );
}
