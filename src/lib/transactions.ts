import { Transaction, TransactionType } from '../types/database';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'swap'];

// Fiat currencies are not crypto holdings: moving into one is a cession.
const FIAT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];

export function isFiat(currency: string): boolean {
  return FIAT_CURRENCIES.includes(currency.trim().toUpperCase());
}

// crypto.randomUUID is missing in insecure contexts (plain http) and old browsers
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Plain decimal numbers with a point only: 0x10, 0b11 and "1,000" (a thousand or one?)
// are not read. A decimal comma is converted by the CSV import, where the delimiter
// tells that the file comes from a French spreadsheet.
const DECIMAL_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!DECIMAL_NUMBER.test(text)) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

// ISO 8601 only, and a day that exists: JavaScript would move 2024-02-31 to March 2nd
function isValidIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return (
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day &&
    !Number.isNaN(new Date(text).getTime())
  );
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

// Validates and cleans a transaction coming from an untrusted source (CSV import,
// Google Drive backup, localStorage). Returns null when it cannot be trusted.
export function normalizeTransaction(raw: unknown): Transaction | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const type = typeof r.transaction_type === 'string' ? r.transaction_type.trim().toLowerCase() : '';
  if (!VALID_TYPES.includes(type as TransactionType)) return null;

  const currencyTo = toNullableString(r.currency_to);
  if (!currencyTo) return null;

  const amount = toFiniteNumber(r.amount);
  const pricePerUnit = toFiniteNumber(r.price_per_unit);
  const totalValue = toFiniteNumber(r.total_value);
  if (amount === null || pricePerUnit === null || totalValue === null) return null;
  // Exchange exports often write sales with negative quantities: not importable as is
  if (amount <= 0 || pricePerUnit < 0 || totalValue < 0) return null;

  // Fiat is not a crypto holding: only a swap can start from it (new money)
  if (type !== 'swap' && isFiat(currencyTo)) return null;

  const currencyFrom = toNullableString(r.currency_from);
  if (type === 'swap' && !currencyFrom) return null;

  // The received quantity only exists on swaps. Absent (a swap recorded before the
  // field existed) it falls back to the sent quantity; given but unreadable, zero or
  // negative, the line is invalid rather than silently replaced.
  const amountTo = type === 'swap' ? toFiniteNumber(r.amount_to) : null;
  if (amountTo !== null && amountTo <= 0) return null;
  const amountToGiven =
    r.amount_to !== undefined && r.amount_to !== null && String(r.amount_to).trim() !== '';
  if (type === 'swap' && amountToGiven && amountTo === null) return null;
  if (type === 'swap' && currencyFrom && isFiat(currencyFrom) && isFiat(currencyTo)) return null;

  // Other formats (05/01/2024) are read as month/day or day/month depending on the
  // data, which silently moves a transaction to another date
  const date = typeof r.transaction_date === 'string' ? r.transaction_date.trim() : '';
  if (!isValidIsoDate(date)) return null;

  const now = new Date().toISOString();
  const text = (value: unknown, fallback: () => string) =>
    typeof value === 'string' && value !== '' ? value : fallback();

  return {
    id: typeof r.id === 'number' && Number.isFinite(r.id) ? String(r.id) : text(r.id, newId),
    transaction_type: type as TransactionType,
    currency_from: currencyFrom,
    currency_to: currencyTo,
    amount,
    amount_to: amountTo,
    price_per_unit: pricePerUnit,
    total_value: totalValue,
    price_per_unit_usd: toFiniteNumber(r.price_per_unit_usd),
    total_value_usd: toFiniteNumber(r.total_value_usd),
    transaction_date: date,
    notes: typeof r.notes === 'string' ? r.notes : '',
    created_at: text(r.created_at, () => now),
    updated_at: text(r.updated_at, () => now),
  };
}

// Two transactions sharing an id would be deleted or edited together: the later
// ones get a new identity.
export function dedupeIds(transactions: Transaction[]): { transactions: Transaction[]; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const result = transactions.map((tx) => {
    if (!seen.has(tx.id)) {
      seen.add(tx.id);
      return tx;
    }
    changed = true;
    const fresh = { ...tx, id: newId() };
    seen.add(fresh.id);
    return fresh;
  });
  return { transactions: result, changed };
}

// A swap towards a fiat currency (possible in data entered before the form refused
// it, or imported) is a cession of the source currency, not a holding of EUR.
export function treatFiatSwapAsSale(tx: Transaction): Transaction {
  if (tx.transaction_type !== 'swap' || !tx.currency_from) return tx;
  if (!isFiat(tx.currency_to) || isFiat(tx.currency_from)) return tx;
  return {
    ...tx,
    transaction_type: 'sell',
    currency_to: tx.currency_from,
    currency_from: null,
    amount_to: null,
    price_per_unit: tx.amount > 0 ? tx.total_value / tx.amount : 0,
  };
}

// Transactions as the calculations must see them: swaps towards fiat are sales and
// a swap between two fiat currencies is not an investment at all.
export function prepareForCalculation(transactions: Transaction[]): Transaction[] {
  return transactions
    .filter(
      (tx) =>
        !(tx.transaction_type === 'swap' && tx.currency_from && isFiat(tx.currency_from) && isFiat(tx.currency_to))
    )
    .map(treatFiatSwapAsSale);
}

export interface TransactionInput {
  type: TransactionType;
  currencyFrom: string;
  currencyTo: string;
  amount: number;
  amountTo: number;
  price: number;
}

// Returns a user-facing message for the first problem found, or null if valid.
export function validateTransactionInput(input: TransactionInput): string | null {
  const to = input.currencyTo.trim().toUpperCase();
  const from = input.currencyFrom.trim().toUpperCase();

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return 'La quantité doit être un nombre strictement positif.';
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    return 'Le prix unitaire doit être un nombre positif ou nul.';
  }

  if (input.type === 'swap') {
    if (!from) return 'Indiquez la monnaie source du swap.';
    if (from === to) return 'La monnaie source et la monnaie destination doivent être différentes.';
    if (isFiat(to)) {
      return `Un échange vers ${to} est une cession imposable : enregistrez-le comme une Vente.`;
    }
    if (!Number.isFinite(input.amountTo) || input.amountTo <= 0) {
      return 'La quantité reçue doit être un nombre strictement positif.';
    }
    return null;
  }

  if (isFiat(to)) {
    return `${to} est une monnaie fiat, pas une crypto : indiquez la crypto achetée ou vendue.`;
  }
  return null;
}
