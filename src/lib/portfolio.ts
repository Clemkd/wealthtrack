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

// What is held, as the ordering sees it: with the same dust tolerance as the
// portfolio (a quantity that is only floating point residue is not a holding).
export interface HeldState {
  quantities: Map<string, number>;
  largest: Map<string, number>;
}

export function createHeldState(): HeldState {
  return { quantities: new Map(), largest: new Map() };
}

function sourceOf(tx: Transaction): string | null {
  if (tx.transaction_type === 'buy') return null;
  const source = tx.transaction_type === 'sell' ? tx.currency_to : tx.currency_from;
  return source && !isFiat(source) ? source : null;
}

// Whether a transaction can run given what is held: a purchase always can, a sale or
// a swap needs its source in sufficient quantity (a fiat source is new money).
export function canRun(tx: Transaction, state: HeldState): boolean {
  const source = sourceOf(tx);
  if (source === null) return true;
  const have = state.quantities.get(source) ?? 0;
  return have + Math.max(QUANTITY_EPSILON, have * RELATIVE_EPSILON) >= tx.amount;
}

// Applies a transaction to what is held and returns the currencies whose quantity grew
// (only those can unblock a transaction that was waiting).
export function applyToHeld(tx: Transaction, state: HeldState): string[] {
  const grew: string[] = [];
  const add = (currency: string, delta: number) => {
    const before = state.quantities.get(currency) ?? 0;
    let next = Math.max(0, before + delta);
    let peak = Math.max(state.largest.get(currency) ?? 0, delta > 0 ? next : 0);
    if (isNegligible(next, peak)) {
      next = 0;
      peak = 0;
    }
    state.quantities.set(currency, next);
    state.largest.set(currency, peak);
    if (next > before) grew.push(currency);
  };
  if (tx.transaction_type === 'buy') add(tx.currency_to, tx.amount);
  else if (tx.transaction_type === 'sell') add(tx.currency_to, -tx.amount);
  else {
    if (tx.currency_from) add(tx.currency_from, -tx.amount);
    add(tx.currency_to, getReceivedAmount(tx));
  }
  return grew;
}

// Binary min-heap of entry positions
class MinHeap {
  private items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent] <= items[i]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as number;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left] < items[smallest]) smallest = left;
        if (right < items.length && items[right] < items[smallest]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

// Orders transactions that share an instant: they keep their entry order, except that
// one which cannot run yet (what it sells or swaps is not held in sufficient quantity)
// waits until something brings that currency in. When nothing can run, the first one
// in entry order goes. Same result as scanning for the first runnable one at every
// step, in O(n log n): runnable ones sit in a heap, the others wait on their source.
function orderInstant(group: Transaction[], state: HeldState): Transaction[] {
  const alive = group.map(() => true);
  const ready = new MinHeap();
  const waiting = new Map<string, number[]>();

  const place = (index: number) => {
    const tx = group[index];
    if (canRun(tx, state)) {
      ready.push(index);
      return;
    }
    const source = sourceOf(tx) as string;
    const list = waiting.get(source);
    if (list) list.push(index);
    else waiting.set(source, [index]);
  };
  group.forEach((_, index) => place(index));

  const ordered: Transaction[] = [];
  let firstAlive = 0;
  while (ordered.length < group.length) {
    let next = -1;
    while (ready.size > 0) {
      const candidate = ready.pop();
      if (!alive[candidate]) continue;
      if (canRun(group[candidate], state)) {
        next = candidate;
        break;
      }
      place(candidate); // it lost its source in the meantime
    }
    if (next === -1) {
      while (!alive[firstAlive]) firstAlive++;
      next = firstAlive;
    }

    alive[next] = false;
    ordered.push(group[next]);
    for (const currency of applyToHeld(group[next], state)) {
      const list = waiting.get(currency);
      if (!list) continue;
      waiting.delete(currency);
      for (const index of list) if (alive[index]) place(index);
    }
  }
  return ordered;
}

// Oldest first. Transactions at the same instant keep the order they were entered
// in (a sale then a rebuy on the same day stays that way), except that one which
// cannot run yet waits for the others (swaps chained on the same day, or a sale
// listed before its purchase).
export function sortChronologically(transactions: Transaction[]): Transaction[] {
  const byTime = [...transactions].sort(
    (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
  );
  const state = createHeldState();
  const ordered: Transaction[] = [];

  let start = 0;
  while (start < byTime.length) {
    const instant = new Date(byTime[start].transaction_date).getTime();
    let end = start + 1;
    while (end < byTime.length && new Date(byTime[end].transaction_date).getTime() === instant) end++;
    for (const tx of orderInstant(byTime.slice(start, end), state)) ordered.push(tx);
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
