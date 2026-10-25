import { describe, expect, it } from 'vitest';
import { formatPrice, restoreWarning, restoredMessage, timePositions } from './format';

describe('formatPrice', () => {
  it('keeps two decimals for ordinary prices', () => {
    expect(formatPrice(236.1234)).toBe('236,12');
    expect(formatPrice(1)).toBe('1,00');
    expect(formatPrice(50000)).toMatch(/^50\s?000,00$/);
  });

  it('shows enough decimals for prices below one', () => {
    expect(formatPrice(0.5)).toBe('0,50');
    expect(formatPrice(0.00001)).toBe('0,00001');
    expect(formatPrice(0.12345678912)).toBe('0,12345679');
  });

  it('formats a USD price with the US convention', () => {
    expect(formatPrice(0.00001, 'en-US')).toBe('0.00001');
    expect(formatPrice(1234.5, 'en-US')).toBe('1,234.50');
  });
});

describe('restoredMessage', () => {
  it('agrees the plural', () => {
    expect(restoredMessage(1, 0)).toBe('1 transaction restaurée');
    expect(restoredMessage(2, 0)).toBe('2 transactions restaurées');
    expect(restoredMessage(0, 0)).toBe('Aucune transaction restaurée (la sauvegarde est vide)');
    expect(restoredMessage(3, 2)).toBe('3 transactions restaurées (2 entrées invalides ignorées)');
    expect(restoredMessage(3, 1)).toBe('3 transactions restaurées (1 entrée invalide ignorée)');
  });
});

describe('timePositions', () => {
  it('places points in proportion to their time', () => {
    expect(timePositions([0, 1, 10])).toEqual([0, 0.1, 1]);
  });
  it('spreads points evenly when they all share one instant', () => {
    expect(timePositions([5, 5, 5])).toEqual([0, 0.5, 1]);
  });
  it('puts a single point at the start', () => {
    expect(timePositions([5])).toEqual([0]);
  });
});

describe('restoreWarning', () => {
  it('stays silent when the restore does not remove the whole list', () => {
    expect(restoreWarning(3, 5)).toBeNull();
    expect(restoreWarning(0, 0)).toBeNull();
    expect(restoreWarning(0, 4)).toBeNull();
  });
  it('warns, with the numbers, when an empty backup would erase the local list', () => {
    const message = restoreWarning(3, 0) as string;
    expect(message).toContain('3 transactions');
    expect(message).toMatch(/vide/);
  });
  it('speaks of one transaction in the singular', () => {
    expect(restoreWarning(1, 0)).toContain('1 transaction ');
  });
});
