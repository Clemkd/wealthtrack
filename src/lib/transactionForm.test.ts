import { describe, expect, it, vi } from 'vitest';
import { FormValues, buildTransactionData } from './transactionForm';

const values: FormValues = {
  type: 'buy',
  currencyFrom: '',
  currencyTo: 'BTC',
  amount: '2',
  amountTo: '',
  pricePerUnit: '100',
  priceCurrency: 'EUR',
  transactionDate: '2023-03-01T10:00:00.000',
  notes: 'ma note',
};

const rate = async () => 1.25;

describe('buildTransactionData', () => {
  it('builds a buy', async () => {
    const data = await buildTransactionData(values, rate);
    expect(data).toMatchObject({
      transaction_type: 'buy',
      currency_from: null,
      currency_to: 'BTC',
      amount: 2,
      amount_to: null,
      price_per_unit: 100,
      total_value: 200,
      price_per_unit_usd: 125,
      total_value_usd: 250,
      notes: 'ma note',
    });
    expect(data.transaction_date).toBe(new Date('2023-03-01T10:00:00.000').toISOString());
  });

  it('keeps the sent and received quantities of a swap', async () => {
    const data = await buildTransactionData(
      { ...values, type: 'swap', currencyFrom: 'SOL', currencyTo: 'USDC', amount: '0.022', amountTo: '5.2', pricePerUnit: '236' },
      rate
    );
    expect(data).toMatchObject({ currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: 5.2 });
    expect(data.total_value).toBeCloseTo(5.192);
  });

  it('fetches the rate of the transaction date', async () => {
    const getRate = vi.fn().mockResolvedValue(1.25);
    await buildTransactionData(values, getRate);
    expect(getRate).toHaveBeenCalledWith(new Date('2023-03-01T10:00:00.000'));
  });

  it('converts a USD price', async () => {
    const data = await buildTransactionData({ ...values, priceCurrency: 'USD', pricePerUnit: '125' }, rate);
    expect(data).toMatchObject({ price_per_unit: 100, total_value: 200, price_per_unit_usd: 125 });
  });

  it('does not ask for a rate when the form is invalid', async () => {
    const getRate = vi.fn();
    await expect(buildTransactionData({ ...values, amount: '0' }, getRate)).rejects.toThrow(/quantité/i);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('refuses a swap towards fiat and a swap to the same currency', async () => {
    const swap = { ...values, type: 'swap' as const, currencyFrom: 'BTC', amountTo: '1' };
    await expect(buildTransactionData({ ...swap, currencyTo: 'EUR' }, rate)).rejects.toThrow(/vente/i);
    await expect(buildTransactionData({ ...swap, currencyTo: 'BTC' }, rate)).rejects.toThrow(/différentes/i);
  });

  it('refuses an invalid date', async () => {
    await expect(buildTransactionData({ ...values, transactionDate: '' }, rate)).rejects.toThrow(/date/i);
  });

  it('refuses a USD price when the rate is unavailable', async () => {
    await expect(
      buildTransactionData({ ...values, priceCurrency: 'USD' }, async () => null)
    ).rejects.toThrow(/taux/i);
  });

  it('keeps the recorded USD price when editing without touching price or date', async () => {
    const date = new Date('2023-03-01T10:00:00.000');
    const existing = { price_per_unit: 100, price_per_unit_usd: 110, transaction_date: date.toISOString() };
    const getRate = vi.fn();
    const data = await buildTransactionData(values, getRate, existing);
    expect(getRate).not.toHaveBeenCalled();
    expect(data.price_per_unit_usd).toBe(110);
  });
});
