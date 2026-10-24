import { Transaction } from '../types/database';

export interface PricingInput {
  amount: number;
  price: number;
  priceCurrency: 'EUR' | 'USD';
  date: Date;
  // The transaction being edited, if any
  existing?: Pick<Transaction, 'price_per_unit' | 'price_per_unit_usd' | 'transaction_date'>;
}

export interface Pricing {
  price_per_unit: number;
  total_value: number;
  price_per_unit_usd: number | null;
  total_value_usd: number | null;
}

// Prices are stored in EUR (what the tax needs) with the USD equivalent on the
// side, both converted at the rate of the transaction date.
export async function computePricing(
  input: PricingInput,
  getEurToUsdRate: (date: Date) => Promise<number | null>
): Promise<Pricing> {
  const { amount, price, priceCurrency, date, existing } = input;

  if (priceCurrency === 'USD') {
    const eurToUsd = await getEurToUsdRate(date);
    if (!eurToUsd) {
      throw new Error(
        'Impossible de récupérer le taux de change USD/EUR à la date de la transaction. Veuillez réessayer.'
      );
    }
    return {
      price_per_unit: price / eurToUsd,
      total_value: (price * amount) / eurToUsd,
      price_per_unit_usd: price,
      total_value_usd: price * amount,
    };
  }

  // Same price and date as when it was recorded: keep the USD value recorded then
  if (
    existing &&
    existing.price_per_unit_usd != null &&
    price === existing.price_per_unit &&
    date.getTime() === new Date(existing.transaction_date).getTime()
  ) {
    return {
      price_per_unit: price,
      total_value: price * amount,
      price_per_unit_usd: existing.price_per_unit_usd,
      total_value_usd: existing.price_per_unit_usd * amount,
    };
  }

  const eurToUsd = await getEurToUsdRate(date);
  return {
    price_per_unit: price,
    total_value: price * amount,
    price_per_unit_usd: eurToUsd ? price * eurToUsd : null,
    total_value_usd: eurToUsd ? price * amount * eurToUsd : null,
  };
}
