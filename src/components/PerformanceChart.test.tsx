import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import PerformanceChart from './PerformanceChart';
import PortfolioStats from './PortfolioStats';

const buy: Transaction = {
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

describe('invested capital labels', () => {
  it('does not call a figure reduced by sales a cumulative investment', () => {
    const html = renderToStaticMarkup(<PerformanceChart transactions={[buy]} />);
    expect(html).not.toContain('Investissement cumulé');
    expect(html).toContain('Capital investi');
    expect(html).toMatch(/ventes/i);
  });

  it('says in the overview that only the held positions are counted', () => {
    const html = renderToStaticMarkup(<PortfolioStats transactions={[buy]} />);
    expect(html).toContain('Total investi (positions détenues)');
  });
});
