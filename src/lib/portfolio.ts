import { Transaction, getReceivedAmount } from '../types/database';
import { prepareForCalculation } from './transactions';

export interface Holding {
  currency: string;
  quantity: number;
  // Cost of the quantity still held (not of everything ever bought).
  totalInvested: number;
  totalSold: number;
  averagePrice: number;
}

export interface PortfolioPoint {
  transaction: Transaction;
  // Total invested across all holdings once this transaction is applied.
  totalInvested: number;
}

export interface Portfolio {
  holdings: Holding[];
  totalInvested: number;
  timeline: PortfolioPoint[];
}

// Quantities below this are floating point residue, not a holding. The residue grows
// with the size of the position (millions of DOGE leave ~1e-9), hence a relative part.
export const QUANTITY_EPSILON = 1e-12;
const RELATIVE_EPSILON = 1e-9;

export function isNegligible(quantity: number, largestQuantityHeld: number): boolean {
  return quantity <= Math.max(QUANTITY_EPSILON, largestQuantityHeld * RELATIVE_EPSILON);
}

// At the same instant a purchase comes before a swap, which comes before a sale
// (the other order would sell what is not held yet). Remaining ties keep the entry order.
const TYPE_RANK = { buy: 0, swap: 1, sell: 2 } as const;

export function sortChronologically(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) =>
      new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime() ||
      TYPE_RANK[a.transaction_type] - TYPE_RANK[b.transaction_type]
  );
}

// Average cost method. A sale removes the proportional share of the cost of the
// holding, a swap moves that cost to the received currency, so only buys (and
// swaps from a currency that is not tracked, like EUR) bring money in.
export function computePortfolio(transactions: Transaction[]): Portfolio {
  const holdings = new Map<string, Holding>();
  const largest = new Map<string, number>();

  const getHolding = (currency: string): Holding => {
    let holding = holdings.get(currency);
    if (!holding) {
      holding = { currency, quantity: 0, totalInvested: 0, totalSold: 0, averagePrice: 0 };
      holdings.set(currency, holding);
    }
    return holding;
  };

  // Removes `amount` from a holding and returns the cost leaving with it. A holding
  // that is not held (quantity 0) is left alone: it never goes negative.
  const removeQuantity = (holding: Holding, amount: number): number => {
    if (holding.quantity <= 0) return 0;
    const fraction = Math.min(1, amount / holding.quantity);
    const removedCost = holding.totalInvested * fraction;
    holding.quantity -= amount;
    holding.totalInvested -= removedCost;
    if (isNegligible(holding.quantity, largest.get(holding.currency) ?? 0)) {
      holding.quantity = 0;
      holding.totalInvested = 0;
      largest.set(holding.currency, 0);
    }
    return removedCost;
  };

  const addQuantity = (holding: Holding, amount: number, cost: number) => {
    holding.quantity += amount;
    holding.totalInvested += cost;
    largest.set(holding.currency, Math.max(largest.get(holding.currency) ?? 0, holding.quantity));
  };

  const sumInvested = () => {
    let total = 0;
    holdings.forEach((h) => (total += h.totalInvested));
    return total;
  };

  const timeline: PortfolioPoint[] = [];

  sortChronologically(prepareForCalculation(transactions)).forEach((tx) => {
    const holding = getHolding(tx.currency_to);

    if (tx.transaction_type === 'buy') {
      addQuantity(holding, tx.amount, tx.total_value);
    } else if (tx.transaction_type === 'sell') {
      removeQuantity(holding, tx.amount);
      holding.totalSold += tx.total_value;
    } else if (tx.transaction_type === 'swap') {
      let transferredCost = tx.total_value;
      if (tx.currency_from) {
        const fromHolding = getHolding(tx.currency_from);
        if (fromHolding.quantity > 0) {
          transferredCost = removeQuantity(fromHolding, tx.amount);
        }
      }
      addQuantity(holding, getReceivedAmount(tx), transferredCost);
    }

    timeline.push({ transaction: tx, totalInvested: sumInvested() });
  });

  holdings.forEach((h) => {
    h.averagePrice = h.quantity > 0 ? h.totalInvested / h.quantity : 0;
  });

  return {
    holdings: Array.from(holdings.values()).filter((h) => h.quantity > 0),
    totalInvested: sumInvested(),
    timeline,
  };
}
