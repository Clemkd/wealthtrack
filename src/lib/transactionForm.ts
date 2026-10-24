import { Transaction, TransactionType } from '../types/database';
import { computePricing, PricingInput } from './pricing';
import { validateTransactionInput } from './transactions';

// What the form holds: text as typed.
export interface FormValues {
  type: TransactionType;
  currencyFrom: string;
  currencyTo: string;
  amount: string;
  amountTo: string;
  pricePerUnit: string;
  priceCurrency: 'EUR' | 'USD';
  transactionDate: string;
  notes: string;
}

export type TransactionData = Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;

// Validates the form and builds the transaction to store. Throws a message meant
// for the user when something is wrong.
export async function buildTransactionData(
  values: FormValues,
  getEurToUsdRate: (date: Date) => Promise<number | null>,
  existing?: PricingInput['existing']
): Promise<TransactionData> {
  const amount = parseFloat(values.amount);
  const price = parseFloat(values.pricePerUnit);
  const amountTo = parseFloat(values.amountTo);
  const date = new Date(values.transactionDate);

  const problem = validateTransactionInput({
    type: values.type,
    currencyFrom: values.currencyFrom,
    currencyTo: values.currencyTo,
    amount,
    amountTo,
    price,
  });
  if (problem) throw new Error(problem);
  if (Number.isNaN(date.getTime())) throw new Error('La date de la transaction est invalide.');

  const pricing = await computePricing(
    { amount, price, priceCurrency: values.priceCurrency, date, existing },
    getEurToUsdRate
  );

  const isSwap = values.type === 'swap';
  return {
    transaction_type: values.type,
    currency_from: isSwap ? values.currencyFrom : null,
    currency_to: values.currencyTo,
    amount,
    amount_to: isSwap ? amountTo : null,
    ...pricing,
    transaction_date: date.toISOString(),
    notes: values.notes,
  };
}
