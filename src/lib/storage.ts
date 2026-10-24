import { Transaction } from '../types/database';
import { safeLocal } from './safeStorage';
import { dedupeIds, newId, normalizeTransaction } from './transactions';

const STORAGE_KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

// What could not be read is kept, as a list of the different raw contents met, so
// that no later read or write can lose it.
function readUnreadableCopies(): string[] {
  const stored = safeLocal.getItem(CORRUPT_KEY);
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((copy) => typeof copy === 'string')) return parsed;
  } catch {
    // Not a list: it is a single raw copy
  }
  return [stored];
}

// Returns true when this raw content is safely set aside (written now, or already there).
function backUpUnreadableData(raw: string): boolean {
  const copies = readUnreadableCopies();
  // A copy that only lives in memory is not safe: the page can close
  if (copies.includes(raw)) return !safeLocal.isInMemory(CORRUPT_KEY);
  // False when the copy could not really be saved (storage full or refused)
  return safeLocal.setItem(CORRUPT_KEY, JSON.stringify([...copies, raw]));
}

// Whether what is entered would be lost with the page: something could not be saved
// and is held in memory, or the storage refuses a write now. Not sticky: it goes back
// to false as soon as the writes work again.
export function isStorageUnavailable(): boolean {
  return safeLocal.hasUnsaved() || !safeLocal.probe();
}

export function hasUnreadableData(): boolean {
  return safeLocal.getItem(CORRUPT_KEY) !== null;
}

// The set aside copies as one JSON text, for the user to download.
export function getUnreadableDataCopy(): string | null {
  return safeLocal.getItem(CORRUPT_KEY);
}

export function clearUnreadableData(): void {
  safeLocal.removeItem(CORRUPT_KEY);
}

// The user has seen the notice: what could not be read is dropped from the stored
// list too (otherwise it would be set aside again at the next read), then the
// raw copies are released.
export function acknowledgeUnreadableData(): void {
  saveTransactions(getTransactions());
  clearUnreadableData();
}

export function getTransactions(): Transaction[] {
  const raw = safeLocal.getItem(STORAGE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backUpUnreadableData(raw);
    return [];
  }

  if (!Array.isArray(parsed)) {
    backUpUnreadableData(raw);
    return [];
  }

  const normalized = parsed
    .map(normalizeTransaction)
    .filter((tx): tx is Transaction => tx !== null);
  const droppedSome = normalized.length !== parsed.length;
  const droppedLinesAreSafe = droppedSome ? backUpUnreadableData(raw) : true;

  // Ids that were missing or duplicated are fixed once and persisted, so that edit
  // and delete find the transaction that is displayed. The stored list is only
  // rewritten when nothing would be lost by doing so.
  const { transactions, changed } = dedupeIds(normalized);
  const hadUnusableId = parsed.some(
    (el) => typeof el === 'object' && el !== null && (typeof (el as { id?: unknown }).id !== 'string' || (el as { id: string }).id === '')
  );
  if ((changed || hadUnusableId) && droppedLinesAreSafe) {
    try {
      saveTransactions(transactions);
    } catch {
      // Storage full: the list is still returned
    }
  }
  return transactions;
}

export function saveTransactions(transactions: Transaction[]): void {
  safeLocal.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

export function addTransaction(
  tx: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>
): Transaction {
  const now = new Date().toISOString();
  const newTx: Transaction = {
    ...tx,
    id: newId(),
    created_at: now,
    updated_at: now,
  };
  const transactions = getTransactions();
  transactions.push(newTx);
  saveTransactions(transactions);
  return newTx;
}

export function deleteTransaction(id: string): void {
  const transactions = getTransactions().filter((tx) => tx.id !== id);
  saveTransactions(transactions);
}

export function updateTransaction(
  id: string,
  changes: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>
): void {
  const transactions = getTransactions().map((tx) =>
    tx.id === id ? { ...tx, ...changes, updated_at: new Date().toISOString() } : tx
  );
  saveTransactions(transactions);
}
