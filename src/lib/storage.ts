import { Transaction } from '../types/database';
import { dedupeIds, newId, normalizeTransaction } from './transactions';

const STORAGE_KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

function generateId(): string {
  return newId();
}

// Keeps what could not be read so it is never silently lost by the next save. The
// first copy is kept: later reads must not overwrite it. Returns true when this raw
// content is safely set aside (written now, or already there).
function backUpUnreadableData(raw: string): boolean {
  try {
    const existing = localStorage.getItem(CORRUPT_KEY);
    if (existing === null) {
      localStorage.setItem(CORRUPT_KEY, raw);
      return true;
    }
    return existing === raw;
  } catch {
    // Storage full: reading must still work, but nothing was set aside
    return false;
  }
}

export function hasUnreadableData(): boolean {
  return localStorage.getItem(CORRUPT_KEY) !== null;
}

export function clearUnreadableData(): void {
  localStorage.removeItem(CORRUPT_KEY);
}

// The user has seen the notice: what could not be read is dropped from the stored
// list too (otherwise it would be set aside again at the next read), then the
// raw copy is released.
export function acknowledgeUnreadableData(): void {
  saveTransactions(getTransactions());
  clearUnreadableData();
}

export function getTransactions(): Transaction[] {
  const raw = localStorage.getItem(STORAGE_KEY);
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

export function addTransaction(
  tx: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>
): Transaction {
  const now = new Date().toISOString();
  const newTx: Transaction = {
    ...tx,
    id: generateId(),
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
