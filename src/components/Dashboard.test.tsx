import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import ErrorModal from './ErrorModal';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('Dashboard navigation', () => {
  let html = '';
  beforeEach(() => {
    html = renderToStaticMarkup(<Dashboard />);
  });

  it('names every tab, even when the label is hidden on small screens', () => {
    for (const label of ["Vue d'ensemble", 'Historique', 'Graphiques', 'Rapport fiscal']) {
      expect(html).toContain(`aria-label="${label.replace(/'/g, '&#x27;')}"`);
    }
  });

  it('names the icon-only action buttons', () => {
    expect(html).toContain('aria-label="Nouvelle transaction"');
    expect(html).toContain('aria-label="Exporter les données"');
    expect(html).toContain('aria-label="Importer des données"');
  });
});

describe('Dashboard data', () => {
  it('shows the stored transactions on the very first render', () => {
    store.set(
      'wealthtrack_transactions',
      JSON.stringify([
        {
          id: 'a',
          transaction_type: 'buy',
          currency_from: null,
          currency_to: 'DOGE',
          amount: 10,
          price_per_unit: 1,
          total_value: 10,
          price_per_unit_usd: null,
          total_value_usd: null,
          transaction_date: '2026-01-01T10:00:00.000Z',
          notes: '',
          created_at: '',
          updated_at: '',
        },
      ])
    );
    expect(renderToStaticMarkup(<Dashboard />)).toContain('DOGE');
  });
});

describe('Dashboard unreadable data notice', () => {
  it('stays quiet when everything could be read', () => {
    expect(renderToStaticMarkup(<Dashboard />)).not.toContain('illisibles');
  });

  it('tells the user when entries were set aside', () => {
    store.set('wealthtrack_transactions_corrupt', '[null]');
    const html = renderToStaticMarkup(<Dashboard />);
    expect(html).toContain('illisibles');
    expect(html).toContain('Télécharger la copie');
    expect(html).toMatch(/supprim/i);
  });
});

describe('ErrorModal', () => {
  it('is a labelled dialog with a named close button', () => {
    const html = renderToStaticMarkup(<ErrorModal error="boom" onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Fermer"');
  });
});
