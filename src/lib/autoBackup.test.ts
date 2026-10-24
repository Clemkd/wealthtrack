import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import { shouldScheduleBackup, signatureHash, transactionsSignature } from './autoBackup';

const tx = (id: string, amount = 1): Transaction => ({
  id,
  transaction_type: 'buy',
  currency_from: null,
  currency_to: 'BTC',
  amount,
  amount_to: null,
  price_per_unit: 1,
  total_value: amount,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-01-01T00:00:00.000Z',
  notes: '',
  created_at: '',
  updated_at: '',
});

describe('transactionsSignature', () => {
  it('does not depend on the order of the list', () => {
    expect(transactionsSignature([tx('a'), tx('b')])).toBe(transactionsSignature([tx('b'), tx('a')]));
  });

  it('changes when a transaction changes, is added or removed', () => {
    const base = transactionsSignature([tx('a')]);
    expect(transactionsSignature([tx('a', 2)])).not.toBe(base);
    expect(transactionsSignature([tx('a'), tx('b')])).not.toBe(base);
    expect(transactionsSignature([])).not.toBe(base);
  });
});

describe('shouldScheduleBackup', () => {
  const ready = { signature: 'new', lastBackedUp: 'old', autoBackup: true, connected: true };

  it('schedules when the data differs from the last backed up state', () => {
    expect(shouldScheduleBackup(ready)).toBe(true);
  });

  it('does not before the first state is known', () => {
    expect(shouldScheduleBackup({ ...ready, lastBackedUp: null })).toBe(false);
  });

  it('does not when nothing changed since the last backup (page load, reconnection)', () => {
    expect(shouldScheduleBackup({ ...ready, signature: 'old' })).toBe(false);
  });

  it('does not when the option is off or the session is not connected', () => {
    expect(shouldScheduleBackup({ ...ready, autoBackup: false })).toBe(false);
    expect(shouldScheduleBackup({ ...ready, connected: false })).toBe(false);
  });

  it('keeps asking until the change is backed up, even if the timer was cancelled', () => {
    // Same inputs on a later render: the state is still not backed up
    expect(shouldScheduleBackup(ready)).toBe(true);
    expect(shouldScheduleBackup({ ...ready, lastBackedUp: 'new' })).toBe(false);
  });
});

describe('signatureHash', () => {
  it('is short, stable and sensitive to changes', () => {
    expect(signatureHash('abc')).toBe(signatureHash('abc'));
    expect(signatureHash('abc')).not.toBe(signatureHash('abd'));
    expect(signatureHash('x'.repeat(100000))).toMatch(/^[0-9a-f]{1,8}$/);
  });
});
