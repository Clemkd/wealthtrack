import { Transaction, getReceivedAmount } from '../types/database';
import { isFiat, prepareForCalculation } from './transactions';

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

// Whether a transaction can run given what is held: a purchase always can, a sale or
// a swap needs its source (a fiat source is new money).
function canRun(tx: Transaction, held: Map<string, number>): boolean {
  if (tx.transaction_type === 'buy') return true;
  const source = tx.transaction_type === 'sell' ? tx.currency_to : tx.currency_from;
  if (!source || isFiat(source)) return true;
  return (held.get(source) ?? 0) > QUANTITY_EPSILON;
}

function applyToHeld(tx: Transaction, held: Map<string, number>): void {
  const add = (currency: string, quantity: number) =>
    held.set(currency, Math.max(0, (held.get(currency) ?? 0) + quantity));
  if (tx.transaction_type === 'buy') add(tx.currency_to, tx.amount);
  else if (tx.transaction_type === 'sell') add(tx.currency_to, -tx.amount);
  else {
    if (tx.currency_from) add(tx.currency_from, -tx.amount);
    add(tx.currency_to, getReceivedAmount(tx));
  }
}

// Oldest first. Transactions at the same instant keep the order they were entered
// in (a sale then a rebuy on the same day stays that way), except that one which
// cannot run yet, because what it sells or swaps is not held, waits for the others
// (swaps chained on the same day, or a sale listed before its purchase).
export function sortChronologically(transactions: Transaction[]): Transaction[] {
  const byTime = [...transactions].sort(
    (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
  );
  const held = new Map<string, number>();
  const ordered: Transaction[] = [];

  let start = 0;
  while (start < byTime.length) {
    const instant = new Date(byTime[start].transaction_date).getTime();
    let end = start + 1;
    while (end < byTime.length && new Date(byTime[end].transaction_date).getTime() === instant) end++;

    const pending = byTime.slice(start, end);
    while (pending.length > 0) {
      const index = pending.findIndex((tx) => canRun(tx, held));
      const [next] = pending.splice(index === -1 ? 0 : index, 1);
      applyToHeld(next, held);
      ordered.push(next);
    }
    start = end;
  }
  return ordered;
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
