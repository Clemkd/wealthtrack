import { describe, expect, it, vi } from 'vitest';
import { computePricing } from './pricing';

const date = new Date('2023-03-01T10:00:00.000Z');

describe('computePricing', () => {
  it('converts a USD price with the rate of the transaction date', async () => {
    const rate = vi.fn().mockResolvedValue(1.25);
    const p = await computePricing({ amount: 2, price: 100, priceCurrency: 'USD', date }, rate);
    expect(rate).toHaveBeenCalledWith(date);
    expect(p).toEqual({ price_per_unit: 80, total_value: 160, price_per_unit_usd: 100, total_value_usd: 200 });
  });

  it('refuses a USD price when the rate is unavailable', async () => {
    await expect(
      computePricing({ amount: 1, price: 100, priceCurrency: 'USD', date }, async () => null)
    ).rejects.toThrow(/taux de change/i);
  });

  it('computes the USD equivalent of a EUR price', async () => {
    const p = await computePricing({ amount: 2, price: 100, priceCurrency: 'EUR', date }, async () => 1.25);
    expect(p).toEqual({ price_per_unit: 100, total_value: 200, price_per_unit_usd: 125, total_value_usd: 250 });
  });

  it('still saves a EUR price when the rate is unavailable', async () => {
    const p = await computePricing({ amount: 2, price: 100, priceCurrency: 'EUR', date }, async () => null);
    expect(p).toMatchObject({ price_per_unit: 100, total_value: 200, price_per_unit_usd: null, total_value_usd: null });
  });

  describe('editing', () => {
    const existing = { price_per_unit: 100, price_per_unit_usd: 110, transaction_date: date.toISOString() };

    it('keeps the recorded USD price when price and date are untouched', async () => {
      const rate = vi.fn();
      const p = await computePricing({ amount: 3, price: 100, priceCurrency: 'EUR', date, existing }, rate);
      expect(rate).not.toHaveBeenCalled();
      expect(p).toMatchObject({ price_per_unit_usd: 110, total_value_usd: 330, total_value: 300 });
    });

    it('compares instants, not text: an imported date with an offset is the same instant', async () => {
      const rate = vi.fn();
      const sameInstant = { price_per_unit: 100, price_per_unit_usd: 110, transaction_date: '2023-03-01T11:00:00+01:00' };
      const p = await computePricing({ amount: 1, price: 100, priceCurrency: 'EUR', date, existing: sameInstant }, rate);
      expect(rate).not.toHaveBeenCalled();
      expect(p.price_per_unit_usd).toBe(110);
    });

    it('recomputes the USD price when the date changes', async () => {
      const p = await computePricing(
        { amount: 1, price: 100, priceCurrency: 'EUR', date: new Date('2023-04-01T10:00:00.000Z'), existing },
        async () => 1.2
      );
      expect(p.price_per_unit_usd).toBe(120);
    });

    it('recomputes the USD price when the price changes', async () => {
      const p = await computePricing({ amount: 1, price: 200, priceCurrency: 'EUR', date, existing }, async () => 1.2);
      expect(p.price_per_unit_usd).toBe(240);
    });
  });
});
