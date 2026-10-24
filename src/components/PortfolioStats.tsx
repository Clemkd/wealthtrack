import { Transaction, getReceivedAmount } from '../types/database';
import { Wallet, TrendingUp, Coins, PieChart } from 'lucide-react';

interface PortfolioStatsProps {
  transactions: Transaction[];
}

interface HoldingData {
  currency: string;
  quantity: number;
  totalInvested: number;
  totalSold: number;
  averagePrice: number;
}

export default function PortfolioStats({ transactions }: PortfolioStatsProps) {
  const calculateStats = () => {
    const holdings = new Map<string, HoldingData>();

    const getHolding = (currency: string): HoldingData => {
      let holding = holdings.get(currency);
      if (!holding) {
        holding = { currency, quantity: 0, totalInvested: 0, totalSold: 0, averagePrice: 0 };
        holdings.set(currency, holding);
      }
      return holding;
    };

    // Remove `amount` from a holding and return the share of its invested cost
    // that leaves with it (average cost method). totalInvested is the cost of
    // what is still held, so the average price stays unchanged after a sale.
    const removeQuantity = (holding: HoldingData, amount: number): number => {
      if (holding.quantity <= 0) {
        holding.quantity -= amount;
        return 0;
      }
      const fraction = Math.min(1, amount / holding.quantity);
      const removedCost = holding.totalInvested * fraction;
      holding.quantity -= amount;
      holding.totalInvested -= removedCost;
      if (holding.quantity <= 1e-12) {
        holding.quantity = 0;
        holding.totalInvested = 0;
      }
      return removedCost;
    };

    // Costs depend on what was held at the time, so replay oldest first.
    const chronological = [...transactions].sort(
      (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
    );

    chronological.forEach((tx) => {
      const holding = getHolding(tx.currency_to);

      if (tx.transaction_type === 'buy') {
        holding.quantity += tx.amount;
        holding.totalInvested += tx.total_value;
      } else if (tx.transaction_type === 'sell') {
        removeQuantity(holding, tx.amount);
        holding.totalSold += tx.total_value;
      } else if (tx.transaction_type === 'swap') {
        // The cost basis moves with the swapped coins. When the source is not
        // a tracked holding (e.g. EUR), the swap brings in new money instead.
        let transferredCost = tx.total_value;
        if (tx.currency_from) {
          const fromHolding = getHolding(tx.currency_from);
          if (fromHolding.quantity > 0) {
            transferredCost = removeQuantity(fromHolding, tx.amount);
          } else {
            removeQuantity(fromHolding, tx.amount);
          }
        }
        holding.quantity += getReceivedAmount(tx);
        holding.totalInvested += transferredCost;
      }
    });

    holdings.forEach((holding) => {
      holding.averagePrice = holding.quantity > 0 ? holding.totalInvested / holding.quantity : 0;
    });

    return Array.from(holdings.values()).filter((h) => h.quantity > 0);
  };

  const holdings = calculateStats();
  const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvested, 0);
  const uniqueCurrencies = holdings.length;
  const totalTransactions = transactions.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total investi</h3>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-gray-900">
            {totalInvested.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            €
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Coins className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Cryptos détenues</h3>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-gray-900">{uniqueCurrencies}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Transactions</h3>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-gray-900">{totalTransactions}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="p-2 bg-slate-100 rounded-lg">
              <PieChart className="w-5 h-5 text-slate-600" />
            </div>
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Positions</h3>
          </div>
          <p className="text-lg sm:text-2xl font-bold text-gray-900">{holdings.length}</p>
        </div>
      </div>

      {holdings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Prix moyens d'achat</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {holdings.map((holding) => (
              <div
                key={holding.currency}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-gray-900 text-lg">{holding.currency}</h4>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    {holding.quantity.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 8,
                    })}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Prix moyen:</span>
                    <span className="font-semibold text-gray-900">
                      {holding.averagePrice.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      €
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Investi:</span>
                    <span className="font-semibold text-gray-900">
                      {holding.totalInvested.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      €
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
