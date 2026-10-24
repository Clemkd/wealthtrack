// Unit price: two decimals, more when the price is below one (cheap coins would
// otherwise show as 0,00).
export function formatPrice(value: number, locale: 'fr-FR' | 'en-US' = 'fr-FR'): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 8 : 2,
  });
}

// What the user is told once a backup is restored
export function restoredMessage(count: number, skipped: number): string {
  if (count === 0) return 'Aucune transaction restaurée (la sauvegarde est vide)';
  const base = `${count} transaction${count > 1 ? 's' : ''} restaurée${count > 1 ? 's' : ''}`;
  if (skipped <= 0) return base;
  return `${base} (${skipped} entrée${skipped > 1 ? 's' : ''} invalide${skipped > 1 ? 's' : ''} ignorée${skipped > 1 ? 's' : ''})`;
}

// Horizontal places (0 to 1) of points on a time axis: proportional to their time,
// evenly spread when they all share the same instant.
export function timePositions(times: number[]): number[] {
  if (times.length <= 1) return times.map(() => 0);
  const first = Math.min(...times);
  const span = Math.max(...times) - first;
  if (span === 0) return times.map((_, i) => i / (times.length - 1));
  return times.map((t) => (t - first) / span);
}
