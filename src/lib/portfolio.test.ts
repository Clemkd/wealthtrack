import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import { applyToHeld, canRun, computePortfolio, createHeldState, sortChronologically } from './portfolio';

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

  describe('rules that must not change silently', () => {
    const same = '2026-03-01T10:00:00.000Z';

    it('applies a swap before a sale made at the same instant, whatever the entry order', () => {
      const purchase = tx({ currency_to: 'BTC', amount: 1, total_value: 100, transaction_date: '2026-02-01T10:00:00.000Z' });
      const swapBtcEth = tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 250, transaction_date: same });
      const saleEth = tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 10, total_value: 300, transaction_date: same });
      for (const list of [[purchase, saleEth, swapBtcEth], [purchase, swapBtcEth, saleEth]]) {
        const p = computePortfolio(list);
        expect(p.holdings).toEqual([]);
        expect(p.totalInvested).toBe(0);
      }
    });

    it('reopens a position after liquidating a huge one, without treating it as residue', () => {
      const p = computePortfolio([
        tx({ currency_to: 'DOGE', amount: 1e6, total_value: 1000, transaction_date: '2026-01-01T00:00:00.000Z' }),
        tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 1e6, total_value: 1000, transaction_date: '2026-01-02T00:00:00.000Z' }),
        tx({ currency_to: 'DOGE', amount: 0.0005, total_value: 0.0005, transaction_date: '2026-01-03T00:00:00.000Z' }),
        tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 0.0001, total_value: 0.0002, transaction_date: '2026-01-04T00:00:00.000Z' }),
      ]);
      expect(find(p, 'DOGE')?.quantity).toBeCloseTo(0.0004, 10);
      expect(find(p, 'DOGE')?.totalInvested).toBeCloseTo(0.0004, 10);
    });

    it('never moves more cost than the source holds when swapping more than held', () => {
      const p = computePortfolio([buy('BTC', 1, 100, 1), swap('BTC', 'ETH', 3, 30, 300, 2)]);
      expect(p.totalInvested).toBe(100);
      expect(find(p, 'ETH')?.totalInvested).toBe(100);
    });
  });

  describe('transactions at the same instant keep their entry order unless they cannot run', () => {
    const d = (iso: string) => ({ transaction_date: `${iso}T00:00:00.000Z` });
    const chain = () => ({
      purchase: tx({ currency_to: 'BTC', amount: 1, total_value: 1000, ...d('2024-01-01') }),
      btcToEth: tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 1500, ...d('2024-01-02') }),
      ethToSol: tx({ transaction_type: 'swap', currency_from: 'ETH', currency_to: 'SOL', amount: 10, amount_to: 100, total_value: 1500, ...d('2024-01-02') }),
      sale: tx({ transaction_type: 'sell', currency_to: 'SOL', amount: 100, total_value: 1600, ...d('2024-01-03') }),
    });

    it('chains swaps made on the same day whichever way the file lists them', () => {
      const { purchase, btcToEth, ethToSol, sale } = chain();
      for (const list of [[purchase, btcToEth, ethToSol, sale], [sale, ethToSol, btcToEth, purchase]]) {
        const p = computePortfolio(list);
        expect(p.holdings).toEqual([]);
        expect(p.totalInvested).toBe(0);
      }
    });

    it('keeps a sale followed by a rebuy on the same instant in that order', () => {
      const first = tx({ currency_to: 'BTC', amount: 1, total_value: 30000, ...d('2024-01-01') });
      const sale = tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 60000, ...d('2024-05-01') });
      const rebuy = tx({ currency_to: 'BTC', amount: 1, total_value: 61000, ...d('2024-05-01') });
      const p = computePortfolio([first, sale, rebuy]);
      expect(find(p, 'BTC')).toMatchObject({ quantity: 1, totalInvested: 61000 });
    });
  });

  describe('same-instant ordering with partial holdings and dust', () => {
    const noon = '2024-03-01T12:00:00.000Z';

    it('defers a sale of more than is held until the purchase that covers it', () => {
      const first = tx({ currency_to: 'BTC', amount: 1, total_value: 100, transaction_date: '2024-01-01T12:00:00.000Z' });
      const sale = tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 5, total_value: 2000, transaction_date: noon });
      const rebuy = tx({ currency_to: 'BTC', amount: 4, total_value: 800, transaction_date: noon });
      const p = computePortfolio([first, sale, rebuy]);
      expect(p.holdings).toEqual([]);
      expect(p.totalInvested).toBe(0);
    });

    it('treats a quantity that is short by floating point error as enough to sell', () => {
      // 0.7 + 0.1 is 0.7999999999999999, not 0.8
      const buys = [
        tx({ currency_to: 'BTC', amount: 0.7, total_value: 70, transaction_date: '2024-01-01T12:00:00.000Z' }),
        tx({ currency_to: 'BTC', amount: 0.1, total_value: 10, transaction_date: '2024-01-02T12:00:00.000Z' }),
      ];
      const sale = tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 0.8, total_value: 90, transaction_date: noon });
      const rebuy = tx({ currency_to: 'BTC', amount: 5, total_value: 1000, transaction_date: noon });
      const p = computePortfolio([...buys, sale, rebuy]);
      // The sale runs first (entry order): only the rebuy is left, at its own cost
      expect(find(p, 'BTC')).toMatchObject({ quantity: 5, totalInvested: 1000 });
    });

    it('does not count dust left by floating point as a holding', () => {
      const buys = [1234567.891, 2345678.912, 3456789.123].map((amount, i) =>
        tx({ currency_to: 'DOGE', amount, total_value: amount / 10, transaction_date: `2024-01-0${i + 1}T12:00:00.000Z` })
      );
      const sold = tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 7037035.926, total_value: 100000, transaction_date: '2024-01-15T12:00:00.000Z' });
      const sale = tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 1000, total_value: 300, transaction_date: '2024-02-01T12:00:00.000Z' });
      const rebuy = tx({ currency_to: 'DOGE', amount: 1000, total_value: 100, transaction_date: '2024-02-01T12:00:00.000Z' });
      const p = computePortfolio([...buys, sold, sale, rebuy]);
      expect(p.holdings).toEqual([]);
    });
  });

  describe('sortChronologically scales and keeps its rule', () => {
    // The rule, written the simple way: run the first transaction that can run, or the first one
    const reference = (group: ReturnType<typeof tx>[], state = createHeldState()) => {
      const pending = [...group];
      const out: string[] = [];
      while (pending.length > 0) {
        const index = pending.findIndex((t) => canRun(t, state));
        const [next] = pending.splice(index === -1 ? 0 : index, 1);
        applyToHeld(next, state);
        out.push(next.id);
      }
      return out;
    };

    it('orders exactly like the simple rule on random histories', () => {
      let seed = 987654321;
      const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const coins = ['A', 'B', 'C', 'EUR'];
      for (let run = 0; run < 300; run++) {
        const list = Array.from({ length: 2 + Math.floor(random() * 14) }, () => {
          const kind = Math.floor(random() * 3);
          const from = coins[Math.floor(random() * 4)];
          const to = coins[Math.floor(random() * 3)];
          const amount = 1 + Math.floor(random() * 4);
          const common = { amount, total_value: amount * 10, transaction_date: '2024-05-01T12:00:00.000Z' };
          if (kind === 0) return tx({ currency_to: to, ...common });
          if (kind === 1) return tx({ transaction_type: 'sell', currency_to: to, ...common });
          return tx({ transaction_type: 'swap', currency_from: from, currency_to: to === from ? 'A' : to, amount_to: 1 + Math.floor(random() * 4), ...common });
        });
        const expected = reference(list);
        expect(sortChronologically(list).map((t) => t.id)).toEqual(expected);
      }
    });

    it('stays fast with 20 000 transactions at the same instant that cannot run', () => {
      const instant = '2024-01-01T12:00:00.000Z';
      const sells = Array.from({ length: 20000 }, (_, i) =>
        tx({ transaction_type: 'sell', currency_to: `C${i % 7}`, amount: 1, total_value: 1, transaction_date: instant })
      );
      const swaps = Array.from({ length: 20000 }, (_, i) =>
        tx({ transaction_type: 'swap', currency_from: `S${i}`, currency_to: `S${i + 1}`, amount: 1, amount_to: 1, total_value: 1, transaction_date: instant })
      ).reverse();
      for (const list of [sells, swaps]) {
        const started = performance.now();
        expect(sortChronologically(list)).toHaveLength(20000);
        expect(performance.now() - started).toBeLessThan(1500);
      }
    });

    it('stays fast when many sales are listed before the purchases that cover them', () => {
      const instant = '2024-01-01T12:00:00.000Z';
      const n = 16000;
      const sales = Array.from({ length: n }, () =>
        tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 1, transaction_date: instant })
      );
      const buys = Array.from({ length: n }, () => tx({ currency_to: 'BTC', amount: 1, total_value: 1, transaction_date: instant }));
      const started = performance.now();
      const sorted = sortChronologically([...sales, ...buys]);
      expect(performance.now() - started).toBeLessThan(1500);
      // Each sale waits for one purchase: they alternate buy, sale, buy, sale...
      expect(sorted.slice(0, 4).map((t) => t.transaction_type)).toEqual(['buy', 'sell', 'buy', 'sell']);
    });

    it('stays fast when sales that cannot be covered wait for many small purchases', () => {
      const instant = '2024-01-01T12:00:00.000Z';
      const n = 20000;
      const sales = Array.from({ length: n }, () =>
        tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1000, total_value: 1, transaction_date: instant })
      );
      const buys = Array.from({ length: n }, () => tx({ currency_to: 'BTC', amount: 0.01, total_value: 1, transaction_date: instant }));
      const started = performance.now();
      expect(sortChronologically([...sales, ...buys])).toHaveLength(2 * n);
      expect(performance.now() - started).toBeLessThan(1500);
    });

    it('stays fast when many sales and swaps are already covered by one large purchase', () => {
      const instant = '2024-01-01T12:00:00.000Z';
      const n = 6000;
      const purchase = tx({ currency_to: 'BTC', amount: 1e9, total_value: 1, transaction_date: instant });
      const sales = Array.from({ length: n }, () =>
        tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 1, transaction_date: instant })
      );
      const swaps = Array.from({ length: n }, () =>
        tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 1, total_value: 1, transaction_date: instant })
      );
      for (const list of [[purchase, ...sales], [purchase, ...sales, ...swaps], [...swaps, ...sales, purchase]]) {
        const started = performance.now();
        const sorted = sortChronologically(list);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(sorted).toHaveLength(list.length);
      }
    });

    it('puts a chain of swaps listed in reverse in the order it can run', () => {
      const instant = '2024-01-01T12:00:00.000Z';
      const first = tx({ currency_to: 'S0', amount: 1, total_value: 1, transaction_date: '2023-12-31T12:00:00.000Z' });
      const chain = Array.from({ length: 50 }, (_, i) =>
        tx({ transaction_type: 'swap', currency_from: `S${i}`, currency_to: `S${i + 1}`, amount: 1, amount_to: 1, total_value: 1, transaction_date: instant })
      );
      const sorted = sortChronologically([first, ...[...chain].reverse()]);
      expect(sorted.slice(1).map((t) => t.id)).toEqual(chain.map((t) => t.id));
    });
  });
});
