import { describe, expect, it, vi } from 'vitest';
import { closeTopDialog, handleEscapeKey, registerDialog } from './dialogStack';

describe('dialog stack', () => {
  it('closes only the dialog on top', () => {
    const below = vi.fn();
    const above = vi.fn();
    const offBelow = registerDialog(below);
    const offAbove = registerDialog(above);
    expect(closeTopDialog()).toBe(true);
    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
    offAbove();
    expect(closeTopDialog()).toBe(true);
    expect(below).toHaveBeenCalledTimes(1);
    offBelow();
  });

  it('does nothing when no dialog is open', () => {
    expect(closeTopDialog()).toBe(false);
  });

  it('forgets a dialog that closed by itself', () => {
    const closed = vi.fn();
    const off = registerDialog(closed);
    off();
    expect(closeTopDialog()).toBe(false);
    expect(closed).not.toHaveBeenCalled();
    off(); // harmless twice
  });

  it('reacts to Escape only', () => {
    const close = vi.fn();
    const off = registerDialog(close);
    const preventDefault = vi.fn();
    handleEscapeKey({ key: 'Enter', preventDefault });
    expect(close).not.toHaveBeenCalled();
    handleEscapeKey({ key: 'Escape', preventDefault });
    expect(close).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
    off();
  });
});
