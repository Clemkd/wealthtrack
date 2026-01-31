/*
  # Create Crypto Portfolio Management Schema

  1. New Tables
    - `transactions`
      - `id` (uuid, primary key) - Unique transaction identifier
      - `user_id` (uuid, foreign key) - Reference to authenticated user
      - `transaction_type` (text) - Type: 'buy', 'sell', or 'swap'
      - `currency_from` (text) - Source currency (for swaps) or null
      - `currency_to` (text) - Destination currency/crypto
      - `amount` (decimal) - Quantity of currency/crypto
      - `price_per_unit` (decimal) - Price per unit in EUR
      - `total_value` (decimal) - Total transaction value in EUR
      - `transaction_date` (timestamptz) - Date of transaction
      - `notes` (text) - Optional notes
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp

  2. Security
    - Enable RLS on `transactions` table
    - Add policies for authenticated users to manage only their own transactions:
      - Users can view their own transactions
      - Users can insert their own transactions
      - Users can update their own transactions
      - Users can delete their own transactions

  3. Indexes
    - Index on user_id for fast user-specific queries
    - Index on transaction_date for chronological sorting
    - Index on currency_to for currency-specific queries
*/

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('buy', 'sell', 'swap')),
  currency_from text,
  currency_to text NOT NULL,
  amount decimal(20, 8) NOT NULL CHECK (amount > 0),
  price_per_unit decimal(20, 8) NOT NULL CHECK (price_per_unit > 0),
  total_value decimal(20, 8) NOT NULL CHECK (total_value > 0),
  transaction_date timestamptz NOT NULL DEFAULT now(),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON transactions(currency_to);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();