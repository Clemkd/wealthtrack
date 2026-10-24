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
    expect(html).toContain('aria-label="Modifier"');
    expect(html).toContain('aria-label="Supprimer"');
  });
});
