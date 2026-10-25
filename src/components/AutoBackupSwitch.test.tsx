import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AutoBackupSwitch from './AutoBackupSwitch';
import TaxReport from './TaxReport';
import TransactionForm from './TransactionForm';

describe('AutoBackupSwitch', () => {
  it('is a named switch that tells whether it is on', () => {
    const on = renderToStaticMarkup(<AutoBackupSwitch enabled onToggle={() => {}} />);
    const off = renderToStaticMarkup(<AutoBackupSwitch enabled={false} onToggle={() => {}} />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-label="Sauvegarde automatique"');
    expect(on).toContain('aria-checked="true"');
    expect(off).toContain('aria-checked="false"');
  });
});

describe('selects have a name', () => {
  it('names the currency of the price in the transaction form', () => {
    const html = renderToStaticMarkup(<TransactionForm onSuccess={() => {}} onCancel={() => {}} />);
    expect(html).toMatch(/<select[^>]*aria-label="Devise du prix"/);
  });

  it('names the fiscal year selector', () => {
    const html = renderToStaticMarkup(<TaxReport transactions={[]} />);
    expect(html).toMatch(/<select[^>]*aria-label="Année fiscale"/);
  });
});
