import { Transaction, getReceivedAmount } from '../types/database';
import { escapeCsvField, quoteCsvField } from './csv';
import { QUANTITY_EPSILON, sortChronologically } from './portfolio';
import { treatFiatSwapAsSale } from './transactions';

export const EXEMPTION_THRESHOLD = 305;
export const FLAT_TAX_RATE = 0.3;

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
  const transactions = rawTransactions.map(treatFiatSwapAsSale);
  const held = (currency: string | null) => {
    const quantity = currency ? holdings.get(currency) || 0 : 0;
    return quantity > QUANTITY_EPSILON ? quantity : 0;
  };
  let prixTotalAcquisition = 0;
  const holdings = new Map<string, number>();
  const lastKnownPrices = new Map<string, number>();
  const gainByTx = new Map<string, number>();
  // Swaps from a currency that is not held bring new money, like a buy
  const acquisitionSwaps = new Set<string>();

  sortChronologically(transactions).forEach((tx) => {
    if (tx.transaction_type === 'buy') {
      prixTotalAcquisition += tx.total_value;
      holdings.set(tx.currency_to, (holdings.get(tx.currency_to) || 0) + tx.amount);
      lastKnownPrices.set(tx.currency_to, tx.price_per_unit);
    } else if (tx.transaction_type === 'sell') {
      const prixDeCession = tx.total_value;
      lastKnownPrices.set(tx.currency_to, tx.price_per_unit);

      let valeurGlobalePortefeuille = 0;
      holdings.forEach((qty, currency) => {
        if (qty > QUANTITY_EPSILON) {
          valeurGlobalePortefeuille += qty * (lastKnownPrices.get(currency) || 0);
        }
      });

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
          lastKnownPrices.set(tx.currency_from, tx.price_per_unit);
        }
      }

      const receivedAmount = getReceivedAmount(tx);
      holdings.set(tx.currency_to, (holdings.get(tx.currency_to) || 0) + receivedAmount);
      if (receivedAmount > 0) {
        lastKnownPrices.set(tx.currency_to, tx.total_value / receivedAmount);
      }
    }
  });

  const yearTransactions = transactions.filter((tx) => yearOf(tx) === year);
  let totalBuys = 0;
  let totalSells = 0;
  let capitalGains = 0;
  let capitalLosses = 0;

  yearTransactions.forEach((tx) => {
    if (tx.transaction_type === 'buy' || acquisitionSwaps.has(tx.id)) {
      totalBuys += tx.total_value;
    } else if (tx.transaction_type === 'sell') {
      totalSells += tx.total_value;
      const gain = gainByTx.get(tx.id) || 0;
      if (gain > 0) capitalGains += gain;
      else capitalLosses += Math.abs(gain);
    }
  });

  return {
    year,
    totalBuys,
    totalSells,
    capitalGains,
    capitalLosses,
    netGain: capitalGains - capitalLosses,
    transactions: yearTransactions,
  };
}

export function estimateTax(data: TaxData): { isExempt: boolean; estimatedTax: number } {
  const isExempt = data.totalSells <= EXEMPTION_THRESHOLD;
  return { isExempt, estimatedTax: isExempt ? 0 : Math.max(0, data.netGain * FLAT_TAX_RATE) };
}

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
      q(tx.transaction_type),
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
