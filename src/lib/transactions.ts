import { Transaction, TransactionType } from '../types/database';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'swap'];

// Fiat currencies are not crypto holdings: moving into one is a cession.
const FIAT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];

export function isFiat(currency: string): boolean {
  return FIAT_CURRENCIES.includes(currency.trim().toUpperCase());
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

  const date = typeof r.transaction_date === 'string' ? r.transaction_date.trim() : '';
  if (!date || Number.isNaN(new Date(date).getTime())) return null;

  const now = new Date().toISOString();
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' && value !== '' ? value : fallback;

  return {
    id: text(r.id, crypto.randomUUID()),
    transaction_type: type as TransactionType,
    currency_from: toNullableString(r.currency_from),
    currency_to: currencyTo,
    amount,
    amount_to: toFiniteNumber(r.amount_to),
    price_per_unit: pricePerUnit,
    total_value: totalValue,
    price_per_unit_usd: toFiniteNumber(r.price_per_unit_usd),
    total_value_usd: toFiniteNumber(r.total_value_usd),
    transaction_date: date,
    notes: typeof r.notes === 'string' ? r.notes : '',
    created_at: text(r.created_at, now),
    updated_at: text(r.updated_at, now),
  };
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
