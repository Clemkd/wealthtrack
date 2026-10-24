import { useMemo } from 'react';
import { Transaction } from '../types/database';
import { computePortfolio } from '../lib/portfolio';
import { formatPrice } from '../lib/format';
import { Wallet, TrendingUp, Coins, PieChart } from 'lucide-react';

interface PortfolioStatsProps {
  transactions: Transaction[];
}

export default function PortfolioStats({ transactions }: PortfolioStatsProps) {
  const { holdings, totalInvested } = useMemo(() => computePortfolio(transactions), [transactions]);
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
            <h3 className="text-xs sm:text-sm font-medium text-gray-600">Total investi (positions détenues)</h3>
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
                      {formatPrice(holding.averagePrice)}{' '}
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
