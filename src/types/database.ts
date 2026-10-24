export type TransactionType = 'buy' | 'sell' | 'swap';

export interface Transaction {
  id: string;
  transaction_type: TransactionType;
  currency_from: string | null;
  currency_to: string;
  amount: number;
  amount_to?: number | null;
  price_per_unit: number;
  total_value: number;
  price_per_unit_usd: number | null;
  total_value_usd: number | null;
  transaction_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// Quantity of currency_to received. Swaps recorded before amount_to existed
// only stored `amount`, so fall back to it for those.
export function getReceivedAmount(tx: Transaction): number {
  return tx.amount_to ?? tx.amount;
}
