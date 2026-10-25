import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import TransactionList from './TransactionList';

const base: Transaction = {
  id: 'a',
  transaction_type: 'buy',
  currency_from: null,
  currency_to: 'BTC',
  amount: 1,
  amount_to: null,
  price_per_unit: 100,
  total_value: 100,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-03-01T10:00:00.000Z',
  notes: '',
  created_at: '',
  updated_at: '',
};

const render = (transactions: Transaction[]) =>
  renderToStaticMarkup(<TransactionList transactions={transactions} onUpdate={() => {}} />);

describe('TransactionList', () => {
  it('tells two purchases of the same day apart by their quantity and time', () => {
    const morning = { ...base, id: 'm', amount: 2, transaction_date: '2025-01-01T09:00:00.000Z' };
    const afternoon = { ...base, id: 'p', amount: 5, transaction_date: '2025-01-01T15:00:00.000Z' };
    const labels = [...render([morning, afternoon]).matchAll(/aria-label="(Supprimer : [^"]+)"/g)].map((m) => m[1]);
    // Each transaction is listed twice (cards on mobile, table on desktop): two distinct names
    expect(new Set(labels).size).toBe(2);
    expect(labels.some((l) => /2[^"]*BTC/.test(l))).toBe(true);
  });

  it('shows the notes of a transaction', () => {
    expect(render([{ ...base, notes: 'note visible' }])).toContain('note visible');
  });

  it('says that the price of a swap is the one of the source currency', () => {
    const swap = { ...base, transaction_type: 'swap' as const, currency_from: 'SOL', currency_to: 'USDC', amount_to: 5 };
    expect(render([swap])).toContain('Prix unitaire (monnaie source)');
    expect(render([base])).not.toContain('Prix unitaire (monnaie source)');
  });

  it('shows the sent and received quantities of a swap', () => {
    const swap = { ...base, transaction_type: 'swap' as const, currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: 5.2 };
    const html = render([swap]);
    expect(html).toContain('Quantité envoyée');
    expect(html).toContain('Quantité reçue');
  });

  it('gives icon-only buttons an accessible name', () => {
    const html = render([base]);
    expect(html).toMatch(/aria-label="Modifier : /);
    expect(html).toMatch(/aria-label="Supprimer : /);
  });

  it('labels a swap towards fiat as the sale it is counted as', () => {
    const toFiat = { ...base, transaction_type: 'swap' as const, currency_from: 'BTC', currency_to: 'EUR', amount_to: 15000 };
    const html = render([toFiat]);
    expect(html).toContain('Vente');
    expect(html).not.toContain('Swap');
    expect(html).not.toContain('BTC → EUR');
  });

  it('shows a swap towards fiat at the price it is counted with (value over quantity)', () => {
    const toFiat = { ...base, transaction_type: 'swap' as const, currency_from: 'BTC', currency_to: 'EUR', amount: 2, total_value: 30, price_per_unit: 99, amount_to: 30 };
    const html = render([toFiat]);
    expect(html).toContain('15,00');
    expect(html).not.toContain('99,00');
  });

  it('shows the price of a very cheap crypto with enough decimals', () => {
    expect(render([{ ...base, price_per_unit: 0.00001, total_value: 0.00001 }])).toContain('0,00001');
  });
});
