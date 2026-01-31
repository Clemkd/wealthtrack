import { Transaction } from '../types/database';
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

    transactions.forEach((tx) => {
      const currency = tx.currency_to;

      if (!holdings.has(currency)) {
        holdings.set(currency, {
          currency,
          quantity: 0,
          totalInvested: 0,
          totalSold: 0,
          averagePrice: 0,
        });
      }

      const holding = holdings.get(currency)!;

      if (tx.transaction_type === 'buy') {
        holding.quantity += tx.amount;
        holding.totalInvested += tx.total_value;
      } else if (tx.transaction_type === 'sell') {
        holding.quantity -= tx.amount;
        holding.totalSold += tx.total_value;
      } else if (tx.transaction_type === 'swap') {
        holding.quantity += tx.amount;
        holding.totalInvested += tx.total_value;

        if (tx.currency_from) {
          if (!holdings.has(tx.currency_from)) {
            holdings.set(tx.currency_from, {
              currency: tx.currency_from,
              quantity: 0,
              totalInvested: 0,
              totalSold: 0,
              averagePrice: 0,
            });
          }
          const fromHolding = holdings.get(tx.currency_from)!;
          fromHolding.quantity -= tx.amount;
        }
      }

      if (holding.quantity > 0) {
        holding.averagePrice = holding.totalInvested / holding.quantity;
      }
    });

    return Array.from(holdings.values()).filter((h) => h.quantity > 0);
  };

  const holdings = calculateStats();
  const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvested, 0);
  const uniqueCurrencies = holdings.length;
  const totalTransactions = transactions.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">Total investi</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {totalInvested.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            €
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Coins className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">Cryptos détenues</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{uniqueCurrencies}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">Transactions</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{totalTransactions}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-slate-100 rounded-lg">
              <PieChart className="w-5 h-5 text-slate-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">Positions</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{holdings.length}</p>
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
