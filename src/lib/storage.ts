import { Transaction } from '../types/database';
import { safeLocal } from './safeStorage';
import { dedupeIds, newId, normalizeTransaction } from './transactions';

const STORAGE_KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

// While the original stored state cannot be preserved durably, writes stay in memory
// and the stored data is not touched: losing the page then costs the session's changes,
// never what was on disk.
//
// pendingRaw: the stored list holds lines that were rejected and whose raw copy could not
// be saved; rewriting the list would destroy them.
// readBlocked: the stored list (or the copies) could not even be read; "nothing there"
// would be a guess, and writing over it a loss.
let pendingRaw: string | null = null;
let readBlocked = false;

// For tests
export function resetStorageState(): void {
  pendingRaw = null;
  readBlocked = false;
}

// What could not be read is kept, as a list of the different raw contents met, so
// that no later read or write can lose it. Null when the copies could not be read.
function readUnreadableCopies(): string[] | null {
  const { value: stored, failed } = safeLocal.read(CORRUPT_KEY);
  if (failed) return null;
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
  // Existing copies that cannot be read must not be overwritten by a new list
  if (copies === null) return false;
  // A copy that only lives in memory is not safe: the page can close
  if (copies.includes(raw)) return !safeLocal.isInMemory(CORRUPT_KEY);
  // False when the copy could not really be saved (storage full or refused)
  return safeLocal.setItem(CORRUPT_KEY, JSON.stringify([...copies, raw]));
}

// Whether what is entered would be lost with the page: something could not be saved
// and is held in memory, or the storage refuses a write now. Not sticky: it goes back
// to false as soon as the writes work again.
export function isStorageUnavailable(): boolean {
  return readBlocked || safeLocal.hasUnsaved() || !safeLocal.probe();
}

// Whether the list on this device is what the app holds: false while changes only live
// in memory (or are kept off the disk to protect what is stored there).
export function isListDurable(): boolean {
  return !pendingRaw && !readBlocked && !safeLocal.isInMemory(STORAGE_KEY);
}

export function hasUnreadableData(): boolean {
  return safeLocal.getItem(CORRUPT_KEY) !== null;
}

// 'unsaved': what was set aside could not be saved on this device (it only lives in
// this page, or nowhere); 'saved': it is kept; 'none': nothing was set aside.
export function unreadableCopyStatus(): 'none' | 'saved' | 'unsaved' {
  if (pendingRaw !== null || safeLocal.isInMemory(CORRUPT_KEY)) return 'unsaved';
  return safeLocal.getItem(CORRUPT_KEY) !== null ? 'saved' : 'none';
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
  const transactions = getTransactions();
  // The user accepts to lose what could not be kept
  pendingRaw = null;
  readBlocked = false;
  saveTransactions(transactions);
  clearUnreadableData();
}

export function getTransactions(): Transaction[] {
  const { value: raw, failed } = safeLocal.read(STORAGE_KEY);
  if (failed) {
    readBlocked = true;
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!backUpUnreadableData(raw)) pendingRaw = raw;
    return [];
  }

  if (!Array.isArray(parsed)) {
    if (!backUpUnreadableData(raw)) pendingRaw = raw;
    return [];
  }

  // A stable id for the lines that have none, so that two reads of the same data agree
  // even when the list cannot be rewritten
  const normalized = parsed
    .map((el, index) => normalizeTransaction(el, `legacy-${index + 1}`))
    .filter((tx): tx is Transaction => tx !== null);
  const droppedSome = normalized.length !== parsed.length;
  const droppedLinesAreSafe = droppedSome ? backUpUnreadableData(raw) : true;
  if (!droppedLinesAreSafe) pendingRaw = raw;

  // Ids that were missing or duplicated are fixed once and persisted, so that edit
  // and delete find the transaction that is displayed. The stored list is only
  // rewritten when nothing would be lost by doing so.
  const { transactions, changed } = dedupeIds(normalized);
  const hadUnusableId = parsed.some(
    (el) => typeof el === 'object' && el !== null && (typeof (el as { id?: unknown }).id !== 'string' || (el as { id: string }).id === '')
  );
  if ((changed || hadUnusableId) && droppedLinesAreSafe) saveTransactions(transactions);
  return transactions;
}

// Returns whether the list is now saved on this device.
export function saveTransactions(transactions: Transaction[]): boolean {
  const text = JSON.stringify(transactions);
  // Raw lines that could not be set aside: try again now, the room may have been made
  if (pendingRaw !== null && backUpUnreadableData(pendingRaw)) pendingRaw = null;
  if (pendingRaw !== null || readBlocked) {
    safeLocal.setItemInMemory(STORAGE_KEY, text);
    return false;
  }
  return safeLocal.setItem(STORAGE_KEY, text);
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
