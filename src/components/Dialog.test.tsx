import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Transaction } from '../types/database';
import Dashboard from './Dashboard';
import Dialog from './Dialog';
import ErrorModal from './ErrorModal';
import GoogleDriveBackup from './GoogleDriveBackup';
import Notice from './Notice';
import PerformanceChart from './PerformanceChart';
import PortfolioStats from './PortfolioStats';
import TaxReport from './TaxReport';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

const sale: Transaction = {
  id: 's',
  transaction_type: 'sell',
  currency_from: null,
  currency_to: 'BTC',
  amount: 1,
  amount_to: null,
  price_per_unit: 100,
  total_value: 100,
  price_per_unit_usd: 110,
  total_value_usd: 110,
  transaction_date: '2026-03-01T10:00:00.000Z',
  notes: 'note',
  created_at: '',
  updated_at: '',
};
const buy: Transaction = { ...sale, id: 'b', transaction_type: 'buy', transaction_date: '2026-01-01T10:00:00.000Z', total_value: 50, price_per_unit: 50 };

describe('Dialog', () => {
  it('is a labelled modal that scrolls when the window is short', () => {
    const html = renderToStaticMarkup(
      <Dialog titleId="t" className="max-w-md">
        <h2 id="t">Title</h2>
      </Dialog>
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain('max-h-[90vh]');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('max-w-md');
  });

  it('can receive the focus, so that it can take it when it opens', () => {
    const html = renderToStaticMarkup(
      <Dialog titleId="t">
        <h2 id="t">Title</h2>
      </Dialog>
    );
    expect(html).toContain('tabindex="-1"');
  });
});

describe('Notice', () => {
  it('announces an error as an alert and a success as a status', () => {
    expect(renderToStaticMarkup(<Notice tone="error">oops</Notice>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Notice tone="success">ok</Notice>)).toContain('role="status"');
  });
});

describe('dialogs of the app share the scrolling dialog', () => {
  it('error modal', () => {
    const html = renderToStaticMarkup(<ErrorModal error="boom" stackTrace="trace" onClose={() => {}} />);
    expect(html).toContain('overflow-y-auto');
    expect(html).toMatch(/<button[^>]*aria-label="Fermer"[^>]*class="[^"]*\bp-2\b/);
  });

  it('transaction form', () => {
    const html = renderToStaticMarkup(<TransactionForm onSuccess={() => {}} onCancel={() => {}} />);
    expect(html).toContain('overflow-y-auto');
  });

  it('Drive panel, with a named client id field and a close button big enough to touch', () => {
    const html = renderToStaticMarkup(<GoogleDriveBackup transactions={[]} onRestore={() => {}} initiallyOpen />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('overflow-y-auto');
    const label = html.match(/<label[^>]*for="([^"]+)"[^>]*>[^<]*Client ID/);
    expect(label).not.toBeNull();
    expect(html).toContain(`id="${label?.[1]}"`);
    expect(html).toMatch(/<button[^>]*aria-label="Fermer"[^>]*class="[^"]*\bp-2\b/);
  });
});

describe('transaction type buttons', () => {
  it('expose which type is chosen and are grouped under their label', () => {
    const html = renderToStaticMarkup(<TransactionForm onSuccess={() => {}} onCancel={() => {}} />);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Achat/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Vente/);
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="transaction-type-label"/);
    expect(html).toContain('id="transaction-type-label"');
  });
});

describe('edit and delete buttons say which transaction they concern', () => {
  it('includes the type, the currency and the date', () => {
    const html = renderToStaticMarkup(<TransactionList transactions={[buy, sale]} onUpdate={() => {}} />);
    expect(html).toMatch(/aria-label="Modifier : Achat de [^"]*BTC le [^"]+ à [^"]+"/);
    expect(html).toMatch(/aria-label="Supprimer : Vente de [^"]*BTC le [^"]+ à [^"]+"/);
  });
});

describe('decorative icons', () => {
  const noUnhiddenSvg = (html: string) => expect(html).not.toMatch(/<svg(?![^>]*aria-hidden="true")/);

  it('are hidden from assistive technologies everywhere', () => {
    store.set('wealthtrack_transactions', JSON.stringify([buy, sale]));
    noUnhiddenSvg(renderToStaticMarkup(<Dashboard />));
    noUnhiddenSvg(renderToStaticMarkup(<TransactionList transactions={[buy, sale]} onUpdate={() => {}} />));
    noUnhiddenSvg(renderToStaticMarkup(<PortfolioStats transactions={[buy, sale]} />));
    noUnhiddenSvg(renderToStaticMarkup(<TaxReport transactions={[buy, sale]} />));
    noUnhiddenSvg(renderToStaticMarkup(<ErrorModal error="x" stackTrace="y" onClose={() => {}} />));
    noUnhiddenSvg(renderToStaticMarkup(<TransactionForm onSuccess={() => {}} onCancel={() => {}} />));
    noUnhiddenSvg(renderToStaticMarkup(<GoogleDriveBackup transactions={[]} onRestore={() => {}} initiallyOpen />));
  });
});

describe('text colours keep a readable contrast on white', () => {
  const tooPale = /text-gray-400|text-green-600|text-orange-600/;

  it('in every screen that shows figures', () => {
    store.set('wealthtrack_transactions', JSON.stringify([buy, sale]));
    for (const html of [
      renderToStaticMarkup(<Dashboard />),
      renderToStaticMarkup(<TransactionList transactions={[buy, sale]} onUpdate={() => {}} />),
      renderToStaticMarkup(<PortfolioStats transactions={[buy, sale]} />),
      renderToStaticMarkup(<PerformanceChart transactions={[buy, sale]} />),
      renderToStaticMarkup(<TaxReport transactions={[buy, sale]} />),
      renderToStaticMarkup(<ErrorModal error="x" onClose={() => {}} />),
      renderToStaticMarkup(<GoogleDriveBackup transactions={[]} onRestore={() => {}} initiallyOpen />),
    ]) {
      expect(html).not.toMatch(tooPale);
    }
  });
});

describe('header on a narrow or short window', () => {
  it('wraps instead of overflowing, shows the labels only when there is room, and sticks only on tall windows', () => {
    const html = renderToStaticMarkup(<Dashboard />);
    expect(html).toMatch(/<h1[^>]*>Portfolio Crypto<\/h1>/);
    expect(html).toMatch(/<div class="[^"]*\bflex-wrap\b[^"]*">\s*<div class="min-w-0/);
    for (const label of ['Exporter', 'Importer', 'Nouvelle transaction']) {
      expect(html).toContain(`<span class="hidden lg:inline">${label}</span>`);
    }
    expect(html).toContain('[@media(min-height:600px)]:sticky');
    expect(html).not.toMatch(/ sticky top-0/);
  });
});

describe('storage that does not work', () => {
  it('lets the app start and says that nothing will be kept', () => {
    const refuse = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    vi.stubGlobal('sessionStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
    const html = renderToStaticMarkup(<Dashboard />);
    expect(html).toContain('Portfolio Crypto');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/stockage .*indisponible/i);
  });
});
