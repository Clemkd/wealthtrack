import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import TransactionForm from './TransactionForm';

const noop = () => {};

const swap: Transaction = {
  id: 's',
  transaction_type: 'swap',
  currency_from: 'SOL',
  currency_to: 'USDC',
  amount: 0.022,
  amount_to: 5.2,
  price_per_unit: 236.1234,
  total_value: 5.19,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-03-01T10:00:00.000Z',
  notes: 'ma note',
  created_at: '',
  updated_at: '',
};

const inputTag = (html: string, id: string) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '';

describe('TransactionForm', () => {
  const html = renderToStaticMarkup(<TransactionForm onSuccess={noop} onCancel={noop} />);

  it('accepts prices and quantities with any number of decimals', () => {
    expect(inputTag(html, 'pricePerUnit')).toContain('step="any"');
    expect(inputTag(html, 'amount')).toContain('step="any"');
  });

  it('is announced as a modal dialog with a named close button', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-label="Fermer"/);
  });

  it('shows the creation title and no received quantity for a buy', () => {
    expect(html).toContain('Nouvelle transaction');
    expect(html).not.toContain('id="amountTo"');
  });

  describe('editing a swap', () => {
    const edit = renderToStaticMarkup(<TransactionForm transaction={swap} onSuccess={noop} onCancel={noop} />);

    it('is prefilled, including the received quantity and the notes', () => {
      expect(edit).toContain('Modifier la transaction');
      expect(inputTag(edit, 'amount')).toContain('value="0.022"');
      expect(inputTag(edit, 'amountTo')).toContain('value="5.2"');
      expect(inputTag(edit, 'currencyFrom')).toContain('value="SOL"');
      expect(edit).toContain('ma note');
    });

    it('can edit a price that has more than two decimals', () => {
      expect(inputTag(edit, 'pricePerUnit')).toContain('value="236.1234"');
      expect(inputTag(edit, 'pricePerUnit')).toContain('step="any"');
    });

    it('opens even when the stored date is empty or invalid', () => {
      for (const transaction_date of ['', 'garbage']) {
        expect(() =>
          renderToStaticMarkup(
            <TransactionForm transaction={{ ...swap, transaction_date }} onSuccess={noop} onCancel={noop} />
          )
        ).not.toThrow();
      }
    });
  });
});
