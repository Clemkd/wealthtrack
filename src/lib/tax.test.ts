import { describe, expect, it, vi } from 'vitest';
import { Transaction } from '../types/database';
import { computePortfolio } from './portfolio';
import { normalizeTransaction } from './transactions';
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
    expect(t.totalBuys).toBe(200);

    // The cost of the SOL follows into the USDC: selling it all gives 240 - 200 = 40
    const later = [
      ...list,
      tx({ transaction_type: 'sell', currency_to: 'USDC', amount: 240, total_value: 240, price_per_unit: 1, ...at('2026-03-01') }),
    ];
    expect(computeTax(later, 2026).netGain).toBeCloseTo(40);
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
    // SOL last known at 200. The legacy swap carries an ambiguous price (10): it must
    // not become the SOL price, otherwise the portfolio value used below is wrong.
    const list = [
      tx({ currency_to: 'SOL', amount: 1, total_value: 200, price_per_unit: 200, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.5, amount_to: undefined, total_value: 5, price_per_unit: 10, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'USDC', amount: 0.5, total_value: 1, price_per_unit: 2, ...at('2026-01-03') }),
    ];
    // VGP = 0.5 SOL x 200 + 0.5 USDC x 2 = 101 (it would be 6 with SOL at 10)
    // PV = 1 - 200 x 1 / 101 = -0.98
    expect(computeTax(list, 2026).capitalLosses).toBeCloseTo(0.9802, 3);
  });

  it('uses the whole portfolio, not only the sold asset (global method)', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 1000, price_per_unit: 1000, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 1, total_value: 1500, price_per_unit: 1500, ...at('2026-01-03') }),
    ];
    // VGP = 10000 + 1 x 1500 = 11500 ; PV = 1500 - 11000 x 1500 / 11500 = 65.217...
    expect(computeTax(list, 2026).netGain).toBe(65.22);
  });

  it('reduces the acquisition cost after each sale', () => {
    const list = [
      tx({ amount: 2, total_value: 20000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 15000, price_per_unit: 15000, ...at('2026-02-01') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 5000, price_per_unit: 5000, ...at('2026-03-01') }),
    ];
    const t = computeTax(list, 2026);
    // 1st: VGP 30000, PV = 15000 - 20000 x 0.5 = 5000 ; PTA left 10000
    // 2nd: VGP 5000, PV = 5000 - 10000 x 1 = -5000
    expect(t.capitalGains).toBeCloseTo(5000);
    expect(t.capitalLosses).toBeCloseTo(5000);
    expect(t.netGain).toBeCloseTo(0);
  });

  it('follows prices through chained swaps', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 12000, price_per_unit: 12000, ...at('2026-01-02') }),
      tx({ transaction_type: 'swap', currency_from: 'ETH', currency_to: 'SOL', amount: 10, amount_to: 100, total_value: 15000, price_per_unit: 1500, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', currency_to: 'SOL', amount: 50, total_value: 9000, price_per_unit: 180, ...at('2026-01-04') }),
    ];
    // SOL known at 150 then 180 : VGP = 100 x 180 = 18000 ; PV = 9000 - 10000 x 9000 / 18000 = 4000
    expect(computeTax(list, 2026).netGain).toBeCloseTo(4000);
  });

  it('restarts the cost after a full sale and a rebuy', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 12000, price_per_unit: 12000, ...at('2026-02-01') }),
      tx({ amount: 1, total_value: 20000, price_per_unit: 20000, ...at('2026-03-01') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 21000, price_per_unit: 21000, ...at('2026-04-01') }),
    ];
    // 1st sale : VGP 12000 , PV 2000, PTA -> 0 ; 2nd sale : PTA 20000 , VGP 21000 , PV = 21000 - 20000 = 1000
    expect(computeTax(list, 2026).netGain).toBeCloseTo(3000);
  });

  it('treats a swap towards fiat as a sale of the source', () => {
    const list = [
      tx({ amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'EUR', amount: 1, amount_to: 30000, total_value: 30000, price_per_unit: 30000, ...at('2026-02-01') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalSells).toBe(30000);
    expect(t.netGain).toBeCloseTo(20000);
  });

  it('agrees with the portfolio on a quantity left over by floating point arithmetic', () => {
    const list = [
      tx({ amount: 0.1, total_value: 1000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ amount: 0.2, total_value: 2000, price_per_unit: 10000, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', amount: 0.3, total_value: 3000, price_per_unit: 10000, ...at('2026-01-03') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 0.05, amount_to: 1, total_value: 1000, price_per_unit: 20000, ...at('2026-01-04') }),
    ];
    // 0.1 + 0.2 - 0.3 is 5.5e-17, not 0: BTC is gone, so the swap brings new money
    expect(computeTax(list, 2026).totalBuys).toBeCloseTo(4000);
    expect(computePortfolio(list).totalInvested).toBeCloseTo(1000);
  });

  it('puts transactions at the same instant in a sensible order', () => {
    const same = '2026-03-01T10:00:00.000Z';
    const sale = tx({ transaction_type: 'sell', amount: 1, total_value: 12000, price_per_unit: 12000, transaction_date: same });
    const purchase = tx({ amount: 1, total_value: 10000, price_per_unit: 10000, transaction_date: same });
    expect(computeTax([sale, purchase], 2026).netGain).toBeCloseTo(2000);
    expect(computeTax([purchase, sale], 2026).netGain).toBeCloseTo(2000);
  });

  it('assigns the year of the local date, at the boundary', () => {
    const list = [
      tx({ amount: 1, total_value: 100, price_per_unit: 100, transaction_date: new Date(2025, 11, 31, 23, 59).toISOString() }),
      tx({ amount: 1, total_value: 100, price_per_unit: 100, transaction_date: new Date(2026, 0, 1, 0, 0).toISOString() }),
    ];
    expect(computeTax(list, 2025).totalBuys).toBe(100);
    expect(computeTax(list, 2026).totalBuys).toBe(100);
  });
});

describe('computeTax rules that must not change silently', () => {
  it('applies a swap before a sale at the same instant, whatever the entry order', () => {
    const same = '2026-03-01T10:00:00.000Z';
    const purchase = tx({ currency_to: 'BTC', amount: 1, total_value: 100, price_per_unit: 100, transaction_date: '2026-02-01T10:00:00.000Z' });
    const swapBtcEth = tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 250, price_per_unit: 250, transaction_date: same });
    const saleEth = tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 10, total_value: 300, price_per_unit: 30, transaction_date: same });
    // VGP = 10 ETH x 30 = 300 ; PV = 300 - 100 x 300 / 300 = 200
    expect(computeTax([purchase, saleEth, swapBtcEth], 2026).netGain).toBeCloseTo(200);
    expect(computeTax([purchase, swapBtcEth, saleEth], 2026).netGain).toBeCloseTo(200);
  });

  it('values what is kept of the source at the swap price (portfolio value after a partial swap)', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 2, total_value: 200, price_per_unit: 100, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 1000, price_per_unit: 1000, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 10, total_value: 1000, price_per_unit: 100, ...at('2026-01-03') }),
    ];
    // VGP = 1 BTC x 1000 + 10 ETH x 100 = 2000 ; PV = 1000 - 200 x 1000 / 2000 = 900
    expect(computeTax(list, 2026).netGain).toBeCloseTo(900);
  });

  it('reopens a position after liquidating a huge one, without treating it as residue', () => {
    const list = [
      tx({ currency_to: 'DOGE', amount: 1e6, total_value: 1000, price_per_unit: 0.001, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 1e6, total_value: 1000, price_per_unit: 0.001, ...at('2026-01-02') }),
      tx({ currency_to: 'DOGE', amount: 0.0005, total_value: 5, price_per_unit: 10000, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 0.0001, total_value: 2, price_per_unit: 20000, ...at('2026-01-04') }),
    ];
    // Second cycle: PTA 5, VGP = 0.0005 x 20000 = 10 ; PV = 2 - 5 x 2 / 10 = 1 (first cycle: 0)
    expect(computeTax(list, 2026).netGain).toBeCloseTo(1);
  });

  it('never moves more cost than the source holds when swapping more than held', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-01-01') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 3, amount_to: 30, total_value: 300, price_per_unit: 100, ...at('2026-01-02') }),
    ];
    // The swap of what is not held is new money: 100 + 300 acquired in total
    expect(computeTax(list, 2026).totalBuys).toBe(100);
  });

  it('reports a break-even sale as exactly zero, not as a -0.00 loss', () => {
    const btc = 0.383 * 49869.66;
    const eth = 1.058 * 581.06;
    const list = [
      tx({ currency_to: 'BTC', amount: 0.383, total_value: btc, price_per_unit: 49869.66, ...at('2026-01-01') }),
      tx({ currency_to: 'ETH', amount: 1.058, total_value: eth, price_per_unit: 581.06, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 0.383, total_value: btc, price_per_unit: 49869.66, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 1.058, total_value: eth, price_per_unit: 581.06, ...at('2026-01-04') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.netGain).toBe(0);
    expect(t.capitalLosses).toBe(0);
    expect(t.capitalGains).toBe(0);
  });

  it('rounds each gain to the cent', () => {
    const list = [
      tx({ amount: 3, total_value: 100, price_per_unit: 100 / 3, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 50, price_per_unit: 50, ...at('2026-02-01') }),
    ];
    // VGP = 3 x 50 = 150 ; PV = 50 - 100 x 50 / 150 = 16.666...
    expect(computeTax(list, 2026).netGain).toBe(16.67);
  });
});

describe('computeTax with free transactions (airdrop, gift, staking reward)', () => {
  it('does not reset the last known price of a coin that is already held', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...at('2024-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 2000, price_per_unit: 2000, ...at('2024-01-02') }),
      tx({ currency_to: 'BTC', amount: 0.001, total_value: 0, price_per_unit: 0, ...at('2024-02-01') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 0.5, total_value: 1000, price_per_unit: 2000, ...at('2024-03-01') }),
      tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1.001, total_value: 30030, price_per_unit: 30000, ...at('2025-04-01') }),
    ];
    // VGP in 2024 = 1.001 BTC x 30000 + 1 ETH x 2000 = 32030 ; PV = 1000 - 32000 x 1000 / 32030 = 0.94
    expect(computeTax(list, 2024).netGain).toBe(0.94);
    expect(Math.abs(computeTax(list, 2025).netGain)).toBeLessThan(100);
  });

  it('does not reset the price of the source of a free swap either', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...at('2024-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 2000, price_per_unit: 2000, ...at('2024-01-02') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'SOL', amount: 0.001, amount_to: 1, total_value: 0, price_per_unit: 0, ...at('2024-02-01') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 0.5, total_value: 1000, price_per_unit: 2000, ...at('2024-03-01') }),
    ];
    // BTC stays valued at 30000 (0.999 BTC) ; SOL has no known price: VGP = 29970 + 2000
    expect(computeTax(list, 2024).netGain).toBeCloseTo(1000 - (32000 * 1000) / 31970, 1);
  });
});

describe('computeTax amounts are exact to the cent', () => {
  it('totals three sales of 305.00 exactly, so the exemption applies', () => {
    const list = [
      tx({ amount: 1000, total_value: 100, price_per_unit: 0.1, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 100, total_value: 127.48, price_per_unit: 1.2748, ...at('2026-02-01') }),
      tx({ transaction_type: 'sell', amount: 100, total_value: 177.36, price_per_unit: 1.7736, ...at('2026-02-02') }),
      tx({ transaction_type: 'sell', amount: 100, total_value: 0.16, price_per_unit: 0.0016, ...at('2026-02-03') }),
    ];
    const t = computeTax(list, 2026);
    expect(t.totalSells).toBe(305);
    expect(estimateTax(t)).toEqual({ isExempt: true, estimatedTax: 0, incomeTax: 0, socialContributions: 0 });
  });

  // Seeded pseudo-random scenarios: every reported amount must be an exact number of cents
  it('reports cent-exact totals, gains, losses and net gain on varied histories', () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const cents = (x: number) => Math.round(x * 100) / 100;
    for (let run = 0; run < 200; run++) {
      const list: Transaction[] = [];
      const coins = ['BTC', 'ETH', 'SOL'];
      coins.forEach((coin, i) => {
        const amount = cents(1 + random() * 5);
        const total = cents(50 + random() * 1000);
        list.push(tx({ currency_to: coin, amount, total_value: total, price_per_unit: total / amount, ...at(`2026-01-0${i + 1}`) }));
      });
      for (let k = 0; k < 4; k++) {
        const coin = coins[Math.floor(random() * 3)];
        const amount = cents(0.1 + random());
        const total = cents(10 + random() * 400);
        list.push(tx({ transaction_type: 'sell', currency_to: coin, amount, total_value: total, price_per_unit: total / amount, ...at(`2026-02-0${k + 1}`) }));
      }
      const t = computeTax(list, 2026);
      for (const value of [t.totalBuys, t.totalSells, t.capitalGains, t.capitalLosses, t.netGain]) {
        expect(value).toBe(cents(value));
        expect(Object.is(value, -0)).toBe(false);
      }
      expect(t.netGain).toBe(cents(t.capitalGains - t.capitalLosses));
    }
  });

  it('never shows a negative zero as the net gain of gains and losses that cancel out', () => {
    // 0.10 + 0.20 gained, 0.30 lost: the float sum is not exactly 0
    const list = [
      tx({ currency_to: 'A', amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', currency_to: 'A', amount: 1, total_value: 100.1, price_per_unit: 100.1, ...at('2026-01-02') }),
      tx({ currency_to: 'B', amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-02-01') }),
      tx({ transaction_type: 'sell', currency_to: 'B', amount: 1, total_value: 100.2, price_per_unit: 100.2, ...at('2026-02-02') }),
      tx({ currency_to: 'C', amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-03-01') }),
      tx({ transaction_type: 'sell', currency_to: 'C', amount: 1, total_value: 99.7, price_per_unit: 99.7, ...at('2026-03-02') }),
    ];
    const t = computeTax(list, 2026);
    expect(Object.is(t.netGain, -0)).toBe(false);
    expect(t.netGain).toBe(cents(t.capitalGains - t.capitalLosses));
    function cents(x: number) { return Math.round(x * 100) / 100 + 0; }
  });
});

describe('computeTax transactions at the same instant', () => {
  const d = (iso: string) => ({ transaction_date: `${iso}T12:00:00.000Z` });

  it('chains swaps made on the same day whichever way the file lists them', () => {
    const purchase = tx({ currency_to: 'BTC', amount: 1, total_value: 1000, price_per_unit: 1000, ...d('2024-01-01') });
    const btcToEth = tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'ETH', amount: 1, amount_to: 10, total_value: 1500, price_per_unit: 1500, ...d('2024-01-02') });
    const ethToSol = tx({ transaction_type: 'swap', currency_from: 'ETH', currency_to: 'SOL', amount: 10, amount_to: 100, total_value: 1500, price_per_unit: 150, ...d('2024-01-02') });
    const sale = tx({ transaction_type: 'sell', currency_to: 'SOL', amount: 100, total_value: 1600, price_per_unit: 16, ...d('2024-01-03') });
    for (const list of [[purchase, btcToEth, ethToSol, sale], [sale, ethToSol, btcToEth, purchase]]) {
      const t = computeTax(list, 2024);
      expect(t.totalBuys).toBe(1000);
      expect(t.netGain).toBe(600);
    }
  });

  it('keeps a sale followed by a rebuy on the same instant in that order', () => {
    const first = tx({ currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...d('2024-01-01') });
    const sale = tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 60000, price_per_unit: 60000, ...d('2024-05-01') });
    const rebuy = tx({ currency_to: 'BTC', amount: 1, total_value: 61000, price_per_unit: 61000, ...d('2024-05-01') });
    expect(computeTax([first, sale, rebuy], 2024).netGain).toBe(30000);
  });

  it('counts a date without time in the right year west of UTC (French overseas)', () => {
    vi.stubEnv('TZ', 'America/Martinique');
    try {
      const raw = (date: string, type: string, total: number) => ({
        id: date + type, transaction_type: type, currency_to: 'BTC', amount: 1, price_per_unit: total,
        total_value: total, transaction_date: date,
      });
      const list = [raw('2024-06-01', 'buy', 10000), raw('2025-01-01', 'sell', 10500)]
        .map((t) => normalizeTransaction(t)) as Transaction[];
      expect(computeTax(list, 2025).totalSells).toBe(10500);
      expect(computeTax(list, 2024).totalSells).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('computeTax values received and kept', () => {
  it('values the currency received in a swap by what it was worth per unit received', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 10000, price_per_unit: 10000, ...at('2026-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 1000, price_per_unit: 1000, ...at('2026-01-02') }),
      tx({ transaction_type: 'swap', currency_from: 'BTC', currency_to: 'SOL', amount: 0.5, amount_to: 50, total_value: 5000, price_per_unit: 10000, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', currency_to: 'ETH', amount: 0.5, total_value: 600, price_per_unit: 1200, ...at('2026-01-04') }),
    ];
    // SOL at 5000 / 50 = 100: VGP = 0.5 BTC x 10000 + 1 ETH x 1200 + 50 SOL x 100 = 11200
    // PV = 600 - 11000 x 600 / 11200 = 10.71
    expect(computeTax(list, 2026).netGain).toBe(10.71);
  });

  it('never lets the acquisition cost go negative after a sale of more than was held', () => {
    const list = [
      tx({ amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', amount: 2, total_value: 300, price_per_unit: 150, ...at('2026-01-02') }),
      tx({ amount: 1, total_value: 50, price_per_unit: 50, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', amount: 1, total_value: 80, price_per_unit: 80, ...at('2026-01-04') }),
    ];
    // First sale: the 2 sold were in the portfolio (VGP 300), all the cost goes with them:
    // PV = 300 - 100 = 200, cost left 0 (not -100). Second: PTA 50, VGP 80, PV = 80 - 50 = 30
    expect(computeTax(list, 2026).netGain).toBe(230);
  });

  it('tolerates dust relative to the largest quantity ever held, not to the current one', () => {
    const list = [
      tx({ currency_to: 'DOGE', amount: 1e6, total_value: 1000, price_per_unit: 0.001, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 5e5, total_value: 500, price_per_unit: 0.001, ...at('2026-01-02') }),
      tx({ currency_to: 'DOGE', amount: 1, total_value: 0.001, price_per_unit: 0.001, ...at('2026-01-03') }),
      tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 500001 - 0.0007, total_value: 500, price_per_unit: 0.001, ...at('2026-01-04') }),
      tx({ transaction_type: 'swap', currency_from: 'DOGE', currency_to: 'ETH', amount: 10, amount_to: 1, total_value: 777, price_per_unit: 77.7, ...at('2026-01-05') }),
    ];
    // 0.0007 DOGE is dust next to a 1 000 000 peak: nothing is held, the swap is new money
    expect(computeTax(list, 2026).totalBuys).toBeCloseTo(1000 + 0.001 + 777, 2);
  });

  it('counts the year in local time', () => {
    vi.stubEnv('TZ', 'Pacific/Auckland');
    try {
      // 23:30 UTC on 31 December is already 1 January in Auckland
      const list = [tx({ amount: 1, total_value: 100, price_per_unit: 100, transaction_date: '2025-12-31T23:30:00.000Z' })];
      expect(computeTax(list, 2026).totalBuys).toBe(100);
      expect(computeTax(list, 2025).totalBuys).toBe(0);
      expect(availableTaxYears(list)).toEqual([2026]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('computeTax prices', () => {
  it('values holdings from total_value, like the portfolio, when price_per_unit is 0', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 1, total_value: 1000, price_per_unit: 0, ...at('2026-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 100, price_per_unit: 100, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 1500, price_per_unit: 0, ...at('2026-01-03') }),
    ];
    // VGP = 1500 + 100 ; PV = 1500 - 1100 x 1500 / 1600 = 468.75
    expect(computeTax(list, 2026).netGain).toBeCloseTo(468.75);
  });

  it('leaves no ghost holding after selling exactly what was bought (large quantities)', () => {
    const list = [
      tx({ currency_to: 'DOGE', amount: 5691757.7, total_value: 569175.77, ...at('2026-01-01') }),
      tx({ currency_to: 'DOGE', amount: 6853413.15, total_value: 685341.315, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'DOGE', amount: 12545170.85, total_value: 2509034.17, ...at('2026-01-03') }),
      tx({ transaction_type: 'swap', currency_from: 'DOGE', currency_to: 'ETH', amount: 1000000, amount_to: 50, total_value: 150000, ...at('2026-01-04') }),
    ];
    expect(computeTax(list, 2026).totalBuys).toBe(1404517.09);
  });

  it('does not count a swap between two fiat currencies as an acquisition', () => {
    const list = [tx({ transaction_type: 'swap', currency_from: 'EUR', currency_to: 'USD', amount: 1000, amount_to: 1080, total_value: 1000, ...at('2026-01-01') })];
    expect(computeTax(list, 2026).totalBuys).toBe(0);
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
    expect(estimateTax({ ...base, totalSells: 300, netGain: 100 })).toEqual({
      isExempt: true,
      estimatedTax: 0,
      incomeTax: 0,
      socialContributions: 0,
    });
  });

  it('computes each part to the cent so that the lines add up to the total', () => {
    // 20.25 x 12.8 % = 2.592 and x 17.2 % = 3.483
    // Exact half cents round up: 6.25 x 17.2 % = 1.075
    expect(estimateTax({ ...base, totalSells: 1000, netGain: 6.25 })).toMatchObject({
      incomeTax: 0.8,
      socialContributions: 1.08,
      estimatedTax: 1.88,
    });
    expect(estimateTax({ ...base, totalSells: 1000, netGain: 21.25 }).socialContributions).toBe(3.66);
    expect(estimateTax({ ...base, totalSells: 1000, netGain: 20.25 })).toEqual({
      isExempt: false,
      incomeTax: 2.59,
      socialContributions: 3.48,
      estimatedTax: 6.07,
    });
    // The CSV and the screen agree on half cents: 500.15 x 30 % = 150.045
    const { incomeTax, socialContributions, estimatedTax } = estimateTax({ ...base, totalSells: 1000, netGain: 500.15 });
    expect(incomeTax + socialContributions).toBeCloseTo(estimatedTax, 10);
    expect(estimatedTax).toBe(150.05);
  });

  it('is exempt exactly at the threshold, not above', () => {
    expect(estimateTax({ ...base, totalSells: 305, netGain: 100 }).isExempt).toBe(true);
    expect(estimateTax({ ...base, totalSells: 305.01, netGain: 100 }).isExempt).toBe(false);
  });

  it('applies the flat tax above the threshold', () => {
    const { isExempt, estimatedTax } = estimateTax({ ...base, totalSells: 1000, netGain: 100 });
    expect(isExempt).toBe(false);
    expect(estimatedTax).toBe(30);
  });

  it('never returns a negative tax', () => {
    expect(estimateTax({ ...base, totalSells: 1000, netGain: -50 }).estimatedTax).toBe(0);
  });
});

describe('taxReportToCsv', () => {
  const data = (list: Transaction[]) => computeTax(list, 2026);

  it('writes the same estimated tax as the screen computes', () => {
    const base = { year: 2026, totalBuys: 0, totalSells: 1000, capitalGains: 500.15, capitalLosses: 0, netGain: 500.15, transactions: [] };
    expect(taxReportToCsv(base)).toContain('Impôt estimé (PFU 30%);150,05 €');
  });

  it('escapes notes with commas, quotes and formulas', () => {
    const csv = taxReportToCsv(data([tx({ notes: 'a, "b"', ...at('2026-01-01') }), tx({ notes: '=1+1', ...at('2026-01-02') })]));
    expect(csv).toContain('"a, ""b"""');
    expect(csv).toContain("'=1+1");
  });

  it('shows the received quantity of a swap', () => {
    const csv = taxReportToCsv(data([tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: 5.2, ...at('2026-01-01') })]));
    expect(csv).toContain('SOL → USDC;0,022;5,2');
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
    expect(taxReportToCsv(data(list))).toContain('Plus-value nette;-2500,00 €');
  });
});

describe('computeTax when more is sold than the recorded holdings', () => {
  it('values the sold crypto in the portfolio even if it was never recorded', () => {
    const list = [
      tx({ currency_to: 'ETH', amount: 1, total_value: 2000, price_per_unit: 2000, ...at('2026-01-01') }),
      tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...at('2026-02-01') }),
    ];
    // Portfolio 32 000 €, acquisition fraction 2 000 × 30 000 / 32 000 = 1 875 €
    expect(computeTax(list, 2026).capitalGains).toBe(28125);
  });

  it('declares the whole price as a gain when nothing at all was bought', () => {
    const list = [tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...at('2026-02-01') })];
    expect(computeTax(list, 2026).capitalGains).toBe(30000);
  });

  it('adds only the missing quantity when the sale is partly covered', () => {
    const list = [
      tx({ currency_to: 'BTC', amount: 0.5, total_value: 20000, price_per_unit: 40000, ...at('2026-01-01') }),
      tx({ currency_to: 'ETH', amount: 1, total_value: 2000, price_per_unit: 2000, ...at('2026-01-02') }),
      tx({ transaction_type: 'sell', currency_to: 'BTC', amount: 1, total_value: 30000, price_per_unit: 30000, ...at('2026-02-01') }),
    ];
    // Portfolio before the sale: 0.5 BTC and 0.5 missing BTC at 30 000 = 30 000, + 2 000 ETH = 32 000
    // Fraction 22 000 × 30 000 / 32 000 = 20 625 -> gain 9 375
    expect(computeTax(list, 2026).capitalGains).toBe(9375);
  });
});

describe('taxReportToCsv type labels', () => {
  it('writes the transaction types in French', () => {
    const csv = taxReportToCsv(computeTax([tx(at('2026-01-01')), tx({ transaction_type: 'sell', total_value: 10, ...at('2026-01-02') })], 2026));
    expect(csv).toContain(';Achat;');
    expect(csv).toContain(';Vente;');
    expect(csv).not.toMatch(/;(buy|sell|swap);/);
  });
});

describe('taxReportToCsv for a French spreadsheet', () => {
  const csvOf = (list: Transaction[]) => taxReportToCsv(computeTax(list, 2026));

  it('separates fields with semicolons and writes decimals with a comma', () => {
    const csv = csvOf([tx({ amount: 0.3, price_per_unit: 100.5, total_value: 30.15, ...at('2026-01-01') })]);
    const row = csv.split('\n').find((line) => line.includes(';Achat;')) as string;
    expect(row.split(';').slice(3, 7)).toEqual(['0,3', '', '100,5', '30,15']);
  });

  it('rounds amounts to the cent so that the detail matches the summary', () => {
    const csv = csvOf([tx({ transaction_type: 'sell', amount: 0.3, total_value: 300.00000000000006, price_per_unit: 1000.0000000000001, ...at('2026-01-01') })]);
    const row = csv.split('\n').find((line) => line.includes(';Vente;')) as string;
    expect(row).toContain(';300,00;');
    expect(row).toContain(';1000;');
    expect(row).not.toContain('00000000006');
  });

  it('writes tiny unit prices in full, never as an exponent or as zero', () => {
    const csv = csvOf([
      tx({ currency_to: 'BABYDOGE', amount: 5e9, price_per_unit: 1e-7, total_value: 500, ...at('2026-01-01') }),
      tx({ currency_to: 'TINY', amount: 1, price_per_unit: 4e-9, total_value: 0.01, ...at('2026-01-02') }),
    ]);
    expect(csv).toContain(';0,0000001;');
    expect(csv).toContain(';0,000000004;');
    expect(csv).not.toMatch(/\de-\d/);
  });

  it('keeps a text that contains a semicolon in one field', () => {
    const csv = csvOf([tx({ notes: 'a;b', ...at('2026-01-01') })]);
    expect(csv).toContain('"a;b"');
  });
});
