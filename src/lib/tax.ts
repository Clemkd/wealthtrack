import { Transaction, getReceivedAmount } from '../types/database';
import { escapeCsvField, quoteCsvField } from './csv';
import { isNegligible, sortChronologically } from './portfolio';
import { prepareForCalculation } from './transactions';

export const EXEMPTION_THRESHOLD = 305;
// In thousandths, so that rounding half cents is done on exact integers
export const INCOME_TAX_PER_MILLE = 128;
export const SOCIAL_CONTRIBUTIONS_PER_MILLE = 172;

export interface TaxData {
  year: number;
  totalBuys: number;
  totalSells: number;
  capitalGains: number;
  capitalLosses: number;
  netGain: number;
  transactions: Transaction[];
}

function yearOf(tx: Transaction): number {
  return new Date(tx.transaction_date).getFullYear();
}

// Years that have at least one transaction, most recent first.
export function availableTaxYears(transactions: Transaction[]): number[] {
  const years = new Set(transactions.map(yearOf).filter((y) => !Number.isNaN(y)));
  return Array.from(years).sort((a, b) => b - a);
}

// The year to display: the selected one if it can be chosen in the list, otherwise
// the most recent year with transactions, otherwise the current year.
export function resolveTaxYear(
  selected: number | null,
  availableYears: number[],
  currentYear: number
): number {
  if (selected !== null && availableYears.includes(selected)) return selected;
  return availableYears[0] ?? currentYear;
}

// French method (article 150 VH bis CGI):
// PV = prix de cession - (prix total d'acquisition × prix de cession / valeur globale du portefeuille)
export function computeTax(rawTransactions: Transaction[], year: number): TaxData {
  const transactions = prepareForCalculation(rawTransactions);
  const holdings = new Map<string, number>();
  const largest = new Map<string, number>();

  const held = (currency: string | null) => {
    if (!currency) return 0;
    const quantity = holdings.get(currency) || 0;
    if (isNegligible(quantity, largest.get(currency) || 0)) {
      holdings.set(currency, 0);
      largest.set(currency, 0);
      return 0;
    }
    return quantity;
  };
  const addHolding = (currency: string, quantity: number) => {
    const next = held(currency) + quantity;
    holdings.set(currency, next);
    largest.set(currency, Math.max(largest.get(currency) || 0, next));
  };
  // Same price as the portfolio uses: the value of the transaction over its quantity
  const unitPrice = (tx: Transaction) => (tx.amount > 0 ? tx.total_value / tx.amount : tx.price_per_unit);
  // A free transaction (airdrop, gift, reward) says nothing about the price: the last
  // known one is kept, otherwise the whole position would be valued at zero
  const lastKnownPrices = new Map<string, number>();
  const rememberPrice = (currency: string | null, price: number) => {
    if (currency && price > 0) lastKnownPrices.set(currency, price);
  };

  let prixTotalAcquisition = 0;
  const gainByTx = new Map<string, number>();
  // Swaps from a currency that is not held bring new money, like a buy
  const acquisitionSwaps = new Set<string>();

  sortChronologically(transactions).forEach((tx) => {
    if (tx.transaction_type === 'buy') {
      prixTotalAcquisition += tx.total_value;
      addHolding(tx.currency_to, tx.amount);
      rememberPrice(tx.currency_to, unitPrice(tx));
    } else if (tx.transaction_type === 'sell') {
      const prixDeCession = tx.total_value;
      rememberPrice(tx.currency_to, unitPrice(tx));

      let valeurGlobalePortefeuille = 0;
      holdings.forEach((qty, currency) => {
        if (!isNegligible(qty, largest.get(currency) || 0)) {
          valeurGlobalePortefeuille += qty * (lastKnownPrices.get(currency) || 0);
        }
      });
      // What is sold was part of the portfolio at that moment, even when the records
      // do not hold all of it (received elsewhere, history incomplete): without it the
      // sold part would be missing from the total and the gain understated
      valeurGlobalePortefeuille += Math.max(0, tx.amount - held(tx.currency_to)) * unitPrice(tx);

      let plusValue = 0;
      if (valeurGlobalePortefeuille > 0) {
        const fractionAcquisition = prixTotalAcquisition * (prixDeCession / valeurGlobalePortefeuille);
        plusValue = prixDeCession - fractionAcquisition;
        prixTotalAcquisition = Math.max(0, prixTotalAcquisition - fractionAcquisition);
      }

      holdings.set(tx.currency_to, Math.max(0, held(tx.currency_to) - tx.amount));
      gainByTx.set(tx.id, plusValue);
    } else if (tx.transaction_type === 'swap') {
      // Crypto to crypto: not a taxable event, only the composition changes
      const sourceQty = held(tx.currency_from);
      if (sourceQty <= 0) {
        prixTotalAcquisition += tx.total_value;
        acquisitionSwaps.add(tx.id);
      }
      if (tx.currency_from) {
        holdings.set(tx.currency_from, Math.max(0, sourceQty - tx.amount));
        // Swaps recorded before amount_to existed have an ambiguous price side
        if (tx.amount_to != null) {
          rememberPrice(tx.currency_from, unitPrice(tx));
        }
      }

      const receivedAmount = getReceivedAmount(tx);
      addHolding(tx.currency_to, receivedAmount);
      if (receivedAmount > 0) {
        rememberPrice(tx.currency_to, tx.total_value / receivedAmount);
      }
    }
  });

  const yearTransactions = transactions.filter((tx) => yearOf(tx) === year);
  // Everything is added up in whole cents: floating point sums of euros drift
  // (305.00000000000006) and would change the threshold and the sign of a zero.
  const toCents = (euros: number) => Math.round(euros * 100);
  let buysCents = 0;
  let sellsCents = 0;
  let gainsCents = 0;
  let lossesCents = 0;

  yearTransactions.forEach((tx) => {
    if (tx.transaction_type === 'buy' || acquisitionSwaps.has(tx.id)) {
      buysCents += toCents(tx.total_value);
    } else if (tx.transaction_type === 'sell') {
      sellsCents += toCents(tx.total_value);
      const gainCents = toCents(gainByTx.get(tx.id) || 0);
      if (gainCents > 0) gainsCents += gainCents;
      else lossesCents += -gainCents;
    }
  });

  return {
    year,
    totalBuys: buysCents / 100,
    totalSells: sellsCents / 100,
    capitalGains: gainsCents / 100,
    capitalLosses: lossesCents / 100,
    netGain: (gainsCents - lossesCents) / 100,
    transactions: yearTransactions,
  };
}

export interface TaxEstimate {
  isExempt: boolean;
  incomeTax: number;
  socialContributions: number;
  estimatedTax: number;
}

// Each part is rounded to the cent and the total is their sum, so that what is
// displayed adds up.
export function estimateTax(data: TaxData): TaxEstimate {
  const isExempt = data.totalSells <= EXEMPTION_THRESHOLD;
  if (isExempt || data.netGain <= 0) {
    return { isExempt, incomeTax: 0, socialContributions: 0, estimatedTax: 0 };
  }
  const netCents = Math.round(data.netGain * 100);
  const incomeCents = Math.round((netCents * INCOME_TAX_PER_MILLE) / 1000);
  const socialCents = Math.round((netCents * SOCIAL_CONTRIBUTIONS_PER_MILLE) / 1000);
  return {
    isExempt,
    incomeTax: incomeCents / 100,
    socialContributions: socialCents / 100,
    estimatedTax: (incomeCents + socialCents) / 100,
  };
}

const TYPE_LABELS: Record<string, string> = { buy: 'Achat', sell: 'Vente', swap: 'Swap' };

export function taxReportToCsv(data: TaxData): string {
  const { isExempt, estimatedTax } = estimateTax(data);
  const eur = (value: number) => `${value.toFixed(2)} €`;
  const exemption =
    data.totalSells === 0
      ? 'Sans objet (aucune cession)'
      : isExempt
        ? "Applicable - Pas d'imposition"
        : 'Non applicable';

  // App generated cells are only quoted; user data (currencies, notes) is also
  // protected against spreadsheet formulas.
  const q = (value: string | number) => quoteCsvField(String(value));
  const u = escapeCsvField;

  const rows: string[][] = [
    [q('Rapport Fiscal'), q(data.year)],
    [],
    [q('Méthode de calcul'), q('Article 150 VH bis CGI - Prix moyen pondéré global du portefeuille')],
    [],
    [q('Résumé')],
    [q('Total achats'), q(eur(data.totalBuys))],
    [q('Total cessions (ventes)'), q(eur(data.totalSells))],
    [q('Plus-values'), q(eur(data.capitalGains))],
    [q('Moins-values'), q(eur(data.capitalLosses))],
    [q('Plus-value nette'), q(eur(data.netGain))],
    [q("Seuil d'exonération (305 €)"), q(exemption)],
    [q('Impôt estimé (PFU 30%)'), q(eur(estimatedTax))],
    [],
    [q('Détail des transactions')],
    [
      'Date',
      'Type',
      'Monnaie',
      'Quantité',
      'Quantité reçue (swap)',
      'Prix unitaire (EUR)',
      'Valeur totale (EUR)',
      'Prix unitaire (USD)',
      'Valeur totale (USD)',
      'Notes',
    ].map(q),
    ...data.transactions.map((tx) => [
      q(new Date(tx.transaction_date).toLocaleDateString('fr-FR')),
      q(TYPE_LABELS[tx.transaction_type] ?? tx.transaction_type),
      tx.transaction_type === 'swap'
        ? u(`${tx.currency_from} → ${tx.currency_to}`)
        : u(tx.currency_to),
      q(tx.amount),
      q(tx.transaction_type === 'swap' ? getReceivedAmount(tx) : ''),
      q(tx.price_per_unit),
      q(tx.total_value),
      q(tx.price_per_unit_usd ?? ''),
      q(tx.total_value_usd ?? ''),
      u(tx.notes),
    ]),
  ];

  return rows.map((row) => row.join(',')).join('\n');
}
