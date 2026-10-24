import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import { computePortfolio } from './portfolio';

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
  transaction_date: '2026-01-01T00:00:00.000Z',
  notes: '',
  created_at: '',
  updated_at: '',
  ...o,
});

const buy = (currency: string, amount: number, total: number, day: number) =>
  tx({ currency_to: currency, amount, total_value: total, transaction_date: `2026-01-0${day}T00:00:00.000Z` });
const sell = (currency: string, amount: number, total: number, day: number) =>
  tx({ transaction_type: 'sell', currency_to: currency, amount, total_value: total, transaction_date: `2026-01-0${day}T00:00:00.000Z` });
const swap = (from: string, to: string, amount: number, received: number, total: number, day: number) =>
  tx({ transaction_type: 'swap', currency_from: from, currency_to: to, amount, amount_to: received, total_value: total, transaction_date: `2026-01-0${day}T00:00:00.000Z` });

const find = (p: ReturnType<typeof computePortfolio>, c: string) => p.holdings.find((h) => h.currency === c);

describe('computePortfolio', () => {
  it('computes quantity, invested amount and average price for buys', () => {
    const p = computePortfolio([buy('SOL', 1, 200, 1), buy('SOL', 1, 400, 2)]);
    expect(find(p, 'SOL')).toMatchObject({ quantity: 2, totalInvested: 600, averagePrice: 300 });
    expect(p.totalInvested).toBe(600);
  });

  it('keeps the average price after a sale and removes the matching cost', () => {
    const p = computePortfolio([buy('SOL', 1, 200, 1), sell('SOL', 0.25, 60, 2)]);
    expect(find(p, 'SOL')).toMatchObject({ quantity: 0.75, totalInvested: 150, averagePrice: 200 });
    expect(p.totalInvested).toBe(150);
  });

  it('transfers the cost on a swap without adding money', () => {
    const p = computePortfolio([buy('SOL', 1, 200, 1), swap('SOL', 'USDC', 0.5, 100, 120, 2)]);
    expect(find(p, 'SOL')).toMatchObject({ quantity: 0.5, totalInvested: 100, averagePrice: 200 });
    expect(find(p, 'USDC')).toMatchObject({ quantity: 100, totalInvested: 100, averagePrice: 1 });
    expect(p.totalInvested).toBe(200);
  });

  it('treats a swap from an untracked source (EUR) as new money', () => {
    const p = computePortfolio([swap('EUR', 'BTC', 50, 0.001, 50, 1)]);
    expect(find(p, 'BTC')).toMatchObject({ quantity: 0.001, totalInvested: 50, averagePrice: 50000 });
    expect(find(p, 'EUR')).toBeUndefined();
  });

  it('replays in chronological order whatever the input order', () => {
    const list = [buy('SOL', 1, 200, 1), swap('SOL', 'USDC', 0.5, 100, 120, 2), sell('SOL', 0.25, 60, 4)];
    const asc = computePortfolio(list);
    const desc = computePortfolio([...list].reverse());
    expect(desc.holdings).toEqual(asc.holdings);
    expect(asc.totalInvested).toBe(150);
  });

  it('drops fully sold positions and zeroes their cost', () => {
    const p = computePortfolio([buy('BTC', 1, 10000, 1), sell('BTC', 0.5, 15000, 2), sell('BTC', 0.5, 15000, 3)]);
    expect(p.holdings).toEqual([]);
    expect(p.totalInvested).toBe(0);
  });

  it('does not let an untracked source go negative and distort a later buy', () => {
    const p = computePortfolio([
      swap('USDT', 'BTC', 500, 0.01, 500, 1),
      buy('USDT', 1000, 1000, 2),
    ]);
    expect(find(p, 'USDT')).toMatchObject({ quantity: 1000, totalInvested: 1000, averagePrice: 1 });
  });

  it('falls back to the sent quantity for swaps recorded before amount_to existed', () => {
    const legacy = tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: undefined, total_value: 5 , transaction_date: '2026-01-02T00:00:00.000Z' });
    const p = computePortfolio([buy('SOL', 1, 200, 1), legacy]);
    expect(find(p, 'USDC')?.quantity).toBe(0.022);
  });

  describe('timeline', () => {
    it('gives the total invested after each transaction, consistent with the final total', () => {
      const list = [buy('BTC', 1, 10000, 1), sell('BTC', 0.5, 15000, 2), sell('BTC', 0.5, 15000, 3)];
      const p = computePortfolio(list);
      expect(p.timeline.map((point) => point.totalInvested)).toEqual([10000, 5000, 0]);
      expect(p.timeline[p.timeline.length - 1].totalInvested).toBe(p.totalInvested);
    });

    it('does not move on a swap between tracked holdings and rises on fresh money', () => {
      const p = computePortfolio([
        buy('SOL', 1, 200, 1),
        swap('SOL', 'USDC', 1, 200, 200, 2),
        swap('EUR', 'ETH', 1000, 0.5, 1000, 3),
      ]);
      expect(p.timeline.map((point) => point.totalInvested)).toEqual([200, 200, 1200]);
    });
  });

  describe('ordering', () => {
    it('applies a buy before a sale made at the same instant, whatever the entry order', () => {
      const sameTime = '2026-03-01T10:00:00.000Z';
      const sale = tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 12000, transaction_date: sameTime });
      const purchase = tx({ currency_to: 'BTC', amount: 1, total_value: 10000, transaction_date: sameTime });
      for (const list of [[sale, purchase], [purchase, sale]]) {
        const p = computePortfolio(list);
        expect(p.holdings).toEqual([]);
        expect(p.totalInvested).toBe(0);
      }
    });
  });

  describe('swap towards fiat (legacy or imported data)', () => {
    it('is a sale of the source, not a holding of EUR', () => {
      const p = computePortfolio([
        buy('BTC', 1, 10000, 1),
        swap('BTC', 'EUR', 1, 30000, 30000, 2),
      ]);
      expect(find(p, 'EUR')).toBeUndefined();
      expect(find(p, 'BTC')).toBeUndefined();
      expect(p.totalInvested).toBe(0);
    });

    it('removes only the swapped share of the cost', () => {
      const p = computePortfolio([buy('BTC', 1, 10000, 1), swap('BTC', 'EUR', 0.5, 15000, 15000, 2)]);
      expect(find(p, 'BTC')).toMatchObject({ quantity: 0.5, totalInvested: 5000 });
    });
  });

  describe('capping', () => {
    it('does not go below zero when selling more than held', () => {
      const p = computePortfolio([buy('BTC', 1, 100, 1), sell('BTC', 2, 300, 2)]);
      expect(p.holdings).toEqual([]);
      expect(p.totalInvested).toBe(0);
    });

    it('lets a full sale then a rebuy restart from the new price', () => {
      const p = computePortfolio([buy('BTC', 1, 100, 1), sell('BTC', 1, 300, 2), buy('BTC', 2, 800, 3)]);
      expect(find(p, 'BTC')).toMatchObject({ quantity: 2, totalInvested: 800, averagePrice: 400 });
    });
  });

  describe('large quantities', () => {
    it('leaves no ghost position after selling exactly what was bought', () => {
      const p = computePortfolio([
        tx({ currency_to: 'DOGE', amount: 5691757.7, total_value: 569175.77, transaction_date: '2026-01-01T00:00:00.000Z' }),
        tx({ currency_to: 'DOGE', amount: 6853413.15, total_value: 685341.315, transaction_date: '2026-01-02T00:00:00.000Z' }),
        tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 12545170.85, total_value: 2509034.17, transaction_date: '2026-01-03T00:00:00.000Z' }),
      ]);
      expect(p.holdings).toEqual([]);
      expect(p.totalInvested).toBe(0);
    });

    it('then treats a later swap from that currency as new money', () => {
      const p = computePortfolio([
        tx({ currency_to: 'DOGE', amount: 5691757.7, total_value: 569175.77, transaction_date: '2026-01-01T00:00:00.000Z' }),
        tx({ currency_to: 'DOGE', amount: 6853413.15, total_value: 685341.315, transaction_date: '2026-01-02T00:00:00.000Z' }),
        tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 12545170.85, total_value: 2509034.17, transaction_date: '2026-01-03T00:00:00.000Z' }),
        swap('DOGE', 'ETH', 1000000, 50, 150000, 4),
      ]);
      expect(find(p, 'ETH')).toMatchObject({ quantity: 50, totalInvested: 150000 });
    });
  });

  it('does not count a swap between two fiat currencies as an investment', () => {
    const p = computePortfolio([swap('EUR', 'USD', 1000, 1080, 1000, 1)]);
    expect(p.totalInvested).toBe(0);
    expect(p.holdings).toEqual([]);
  });
});
