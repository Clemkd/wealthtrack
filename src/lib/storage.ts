import { Transaction } from '../types/database';
import { normalizeTransaction } from './transactions';

const STORAGE_KEY = 'wealthtrack_transactions';
const CORRUPT_KEY = 'wealthtrack_transactions_corrupt';

function generateId(): string {
  return crypto.randomUUID();
}

// Keeps what could not be read so it is never silently lost by the next save.
function backUpUnreadableData(raw: string): void {
  localStorage.setItem(CORRUPT_KEY, raw);
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

  const transactions = parsed
    .map(normalizeTransaction)
    .filter((tx): tx is Transaction => tx !== null);
  if (transactions.length !== parsed.length) {
    backUpUnreadableData(raw);
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
