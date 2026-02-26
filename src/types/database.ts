export type TransactionType = 'buy' | 'sell' | 'swap';

export interface Transaction {
  id: string;
  transaction_type: TransactionType;
  currency_from: string | null;
  currency_to: string;
  amount: number;
  price_per_unit: number;
  total_value: number;
  transaction_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}
