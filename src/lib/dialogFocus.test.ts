import { describe, expect, it, vi } from 'vitest';
import { enterDialog } from './dialogFocus';

const element = (connected = true) => ({ focus: vi.fn(), isConnected: connected });

describe('enterDialog', () => {
  it('moves the focus into the dialog and gives it back to the opener when it closes', () => {
    const opener = element();
    const dialog = element();
    const leave = enterDialog(dialog, { activeElement: opener });
    expect(dialog.focus).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
    leave();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('does not try to focus an opener that is gone', () => {
    const opener = element(false);
    const leave = enterDialog(element(), { activeElement: opener });
    leave();
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('copes with nothing being focused', () => {
    const leave = enterDialog(element(), { activeElement: null });
    expect(() => leave()).not.toThrow();
  });
});
