// Unit price: two decimals, more when the price is below one (cheap coins would
// otherwise show as 0,00).
export function formatPrice(value: number, locale: 'fr-FR' | 'en-US' = 'fr-FR'): string {
  return value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 8 : 2,
  });
}
