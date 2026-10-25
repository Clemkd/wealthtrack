import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoogleDriveBackup from './GoogleDriveBackup';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const render = () => renderToStaticMarkup(<GoogleDriveBackup transactions={[]} onRestore={() => {}} initiallyOpen />);

describe('GoogleDriveBackup when the automatic backup is on but nobody is connected', () => {
  it('says in the panel that nothing is saved until the user connects', () => {
    store.set('wealthtrack_gdrive_settings', JSON.stringify({ autoBackup: true, lastBackupDate: null, clientId: 'x' }));
    const html = render();
    expect(html).toContain('activée mais inactive');
  });

  it('stays quiet when the automatic backup was never turned on', () => {
    expect(render()).not.toContain('activée mais inactive');
  });
});
