export type TransactionType = 'buy' | 'sell' | 'swap';

export interface Transaction {
  id: string;
  user_id: string;
  transaction_type: TransactionType;
  currency_from: string | null;
  currency_to: string;
  amount: number;
  price_per_unit: number;
  total_value: number;
  price_per_unit_usd: number | null;
  total_value_usd: number | null;
  transaction_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>;
      };
    };
  };
}
