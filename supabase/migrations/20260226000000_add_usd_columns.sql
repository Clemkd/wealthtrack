/*
  # Add USD equivalent columns to transactions

  Adds price_per_unit_usd and total_value_usd columns to store the USD
  equivalent of each transaction at the time it was recorded.
  Both columns are nullable to maintain backward compatibility with
  existing transactions.
*/

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS price_per_unit_usd decimal(20, 8);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_value_usd decimal(20, 8);
