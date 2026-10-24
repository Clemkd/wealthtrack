import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import { availableTaxYears, computeTax, estimateTax, resolveTaxYear, taxReportToCsv } from './tax';

let n = 0;
const tx = (o: Partial<Transaction>): Transaction => ({
  id: `t${++n}`,
  transaction_type: 'buy',
  currency_from: null,
  currency_to: 'BTC',
  amount: 1,
  amount_to: null,
  price_per_unit: 0,
  total_value: 0,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-01-01T10:00:00.000Z',
  notes: '',
  created_at: '',
  updated_at: '',
  ...o,
});
const at = (date: string) => ({ transaction_date: `${date}T10:00:00.000Z` });

describe('computeTax (150 VH bis)', () => {
  it('computes the gain on a sale from the global acquisition cost', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 0.5, total_value: 7500, price_per_unit: 15000, ...at('2026-02-01') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalBuys).toBe(10000);
    expect(t.totalSells).toBe(7500);
    expect(t.capitalGains).toBeCloseTo(2500);
    expect(t.netGain).toBeCloseTo(2500);
  });

  it('reports a loss', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 0.5, total_value: 2500, price_per_unit: 5000, ...at('2026-02-01') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.capitalLosses).toBeCloseTo(2500);
    expect(t.capitalGains).toBe(0);
  });

  it('does not tax a swap between cryptos', () => {
    const list = [
      tx({ currency_to: 'SOL', amount: 1, total_value: 200, price_per_unit: 200, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 1, amount_to: 240, total_value: 240, price_per_unit: 240, ...at('2026-02-01') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalSells).toBe(0);
    expect(t.netGain).toBe(0);
  });

  it('counts a swap from EUR as an acquisition, in the totals and in the gain', () => {
    const list = [
      tx({ transaction_type: 'swap', currency_from: 'EUR', currency_to: 'BTC', amount: 50, amount_to: 0.001, total_value: 50, price_per_unit: 1, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 0.0005, total_value: 50, price_per_unit: 100000, ...at('2026-01-02') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalBuys).toBe(50);
    expect(t.netGain).toBeCloseTo(25);
  });

  it('does not count a swap between tracked cryptos in the acquisitions', () => {
    const list = [
      tx({ currency_to: 'SOL', amount: 1, total_value: 200, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 1, amount_to: 240, total_value: 240, ...at('2026-01-02') }),
    ];
    expect(computeTax(list, 2026).totalBuys).toBe(200);
  });

  it('only totals the selected year but uses the whole history for the cost', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2025-06-01') }),
      tx({ transaction_type: 'sell', amount: 0.5, total_value: 7500, price_per_unit: 15000, ...at('2026-02-01') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalBuys).toBe(0);
    expect(t.totalSells).toBe(7500);
    expect(t.netGain).toBeCloseTo(2500);
    expect(t.transactions).toHaveLength(1);
  });

  it('does not reprice a swap source for swaps recorded before amount_to existed', () => {
    const list = [
      tx({ currency_to: 'SOL', amount: 1, total_value: 200, price_per_unit: 200, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.5, amount_to: undefined, total_value: 5, price_per_unit: 10, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'SOL', amount: 0.1, total_value: 20, price_per_unit: 200, ...at('2026-01-03') }),
    ];
    expect(() => computeTax(list, 2026)).not.toThrow();
  });
});

describe('years', () => {
  const list = [tx(at('2024-03-01')), tx(at('2025-03-01')), tx({ transaction_date: '' })];

  it('lists years with transactions, most recent first, ignoring invalid dates', () => {
    expect(availableTaxYears(list)).toEqual([2025, 2024]);
  });

  it('keeps the selected year when it is available', () => {
    expect(resolveTaxYear(2024, [2025, 2024], 2026)).toBe(2024);
  });

  it('falls back to the most recent year with transactions, not the current year', () => {
    expect(resolveTaxYear(null, [2025, 2024], 2026)).toBe(2025);
    expect(resolveTaxYear(2026, [2025, 2024], 2026)).toBe(2025);
  });

  it('uses the current year when there is no transaction', () => {
    expect(resolveTaxYear(null, [], 2026)).toBe(2026);
  });
});

describe('estimateTax', () => {
  const base = { year: 2026, totalBuys: 0, capitalGains: 0, capitalLosses: 0, transactions: [] };

  it('is exempt below the 305 € threshold', () => {
    expect(estimateTax({ ...base, totalSells: 300, netGain: 100 })).toEqual({ isExempt: true, estimatedTax: 0 });
  });

  it('applies the flat tax above the threshold', () => {
    const { isExempt, estimatedTax } = estimateTax({ ...base, totalSells: 1000, netGain: 100 });
    expect(isExempt).toBe(false);
    expect(estimatedTax).toBeCloseTo(30);
  });

  it('never returns a negative tax', () => {
    expect(estimateTax({ ...base, totalSells: 1000, netGain: -50 }).estimatedTax).toBe(0);
  });
});

describe('taxReportToCsv', () => {
  const data = (list: Transaction[]) => computeTax(list, 2026);

  it('escapes notes with commas, quotes and formulas', () => {
    const csv = taxReportToCsv(data([tx({ notes: 'a, "b"', ...at('2026-01-01') }), tx({ notes: '=1+1', ...at('2026-01-02') })]));
    expect(csv).toContain('"a, ""b"""');
    expect(csv).toContain("'=1+1");
  });

  it('shows the received quantity of a swap', () => {
    const csv = taxReportToCsv(data([tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: 5.2, ...at('2026-01-01') })]));
    expect(csv).toContain('SOL → USDC,0.022,5.2');
  });

  it('does not claim an exemption applies when there is no sale', () => {
    const csv = taxReportToCsv(data([tx(at('2026-01-01'))]));
    expect(csv).toContain('Sans objet');
    expect(csv).not.toContain('Applicable - Pas d');
  });

  it('states the exemption when sales stay under the threshold', () => {
    const csv = taxReportToCsv(data([tx({ transaction_type: 'sell', total_value: 100, ...at('2026-01-01') })]));
    expect(csv).toContain("Applicable - Pas d'imposition");
  });

  it('does not prefix negative amounts generated by the app', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 0.5, total_value: 2500, price_per_unit: 5000, ...at('2026-02-01') }),
    ];
    expect(taxReportToCsv(data(list))).toContain('Plus-value nette,-2500.00 €');
  });
});
