import { useState, useMemo } from 'react';
import { Transaction } from '../types/database';
import { Download, Calendar } from 'lucide-react';

interface TaxReportProps {
  transactions: Transaction[];
}

interface TaxData {
  year: number;
  totalBuys: number;
  totalSells: number;
  capitalGains: number;
  capitalLosses: number;
  netGain: number;
  transactions: Transaction[];
}

export default function TaxReport({ transactions }: TaxReportProps) {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const availableYears = useMemo(() => {
    const years = new Set(
      transactions.map((tx) => new Date(tx.transaction_date).getFullYear())
    );
    return Array.from(years).sort((a, b) => b - a);
  }, [transactions]);

  const taxData = useMemo((): TaxData => {
    const yearTransactions = transactions.filter(
      (tx) => new Date(tx.transaction_date).getFullYear() === selectedYear
    );

    const allTransactions = [...transactions].sort(
      (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
    );

    const holdings = new Map<string, Array<{ amount: number; costPerUnit: number }>>();
    const costBasisByTx = new Map<string, number>();

    allTransactions.forEach((tx) => {
      const currency = tx.currency_to;

      if (tx.transaction_type === 'buy') {
        if (!holdings.has(currency)) {
          holdings.set(currency, []);
        }
        holdings.get(currency)!.push({
          amount: tx.amount,
          costPerUnit: tx.price_per_unit,
        });
      } else if (tx.transaction_type === 'sell') {
        if (!holdings.has(currency)) {
          holdings.set(currency, []);
        }

        let remainingToSell = tx.amount;
        let totalCostBasis = 0;
        const lots = holdings.get(currency)!;

        while (remainingToSell > 0 && lots.length > 0) {
          const lot = lots[0];
          const amountFromLot = Math.min(lot.amount, remainingToSell);
          totalCostBasis += amountFromLot * lot.costPerUnit;

          lot.amount -= amountFromLot;
          remainingToSell -= amountFromLot;

          if (lot.amount === 0) {
            lots.shift();
          }
        }

        costBasisByTx.set(tx.id, totalCostBasis);
      } else if (tx.transaction_type === 'swap') {
        if (tx.currency_from) {
          const fromCurrency = tx.currency_from;
          if (!holdings.has(fromCurrency)) {
            holdings.set(fromCurrency, []);
          }

          let remainingToSwap = tx.amount;
          const lots = holdings.get(fromCurrency)!;

          while (remainingToSwap > 0 && lots.length > 0) {
            const lot = lots[0];
            const amountFromLot = Math.min(lot.amount, remainingToSwap);
            lot.amount -= amountFromLot;
            remainingToSwap -= amountFromLot;

            if (lot.amount === 0) {
              lots.shift();
            }
          }
        }

        if (!holdings.has(currency)) {
          holdings.set(currency, []);
        }
        holdings.get(currency)!.push({
          amount: tx.amount,
          costPerUnit: tx.price_per_unit,
        });
      }
    });

    let totalBuys = 0;
    let totalSells = 0;
    let capitalGains = 0;
    let capitalLosses = 0;

    yearTransactions.forEach((tx) => {
      if (tx.transaction_type === 'buy') {
        totalBuys += tx.total_value;
      } else if (tx.transaction_type === 'sell') {
        totalSells += tx.total_value;

        const costBasis = costBasisByTx.get(tx.id) || 0;
        const gain = tx.total_value - costBasis;

        if (gain > 0) {
          capitalGains += gain;
        } else {
          capitalLosses += Math.abs(gain);
        }
      }
    });

    return {
      year: selectedYear,
      totalBuys,
      totalSells,
      capitalGains,
      capitalLosses,
      netGain: capitalGains - capitalLosses,
      transactions: yearTransactions,
    };
  }, [transactions, selectedYear]);

  const handleDownload = () => {
    const csvContent = [
      ['Rapport Fiscal', selectedYear],
      [],
      ['Résumé'],
      ['Total achats', `${taxData.totalBuys.toFixed(2)} €`],
      ['Total ventes', `${taxData.totalSells.toFixed(2)} €`],
      ['Plus-values', `${taxData.capitalGains.toFixed(2)} €`],
      ['Moins-values', `${taxData.capitalLosses.toFixed(2)} €`],
      ['Plus-value nette', `${taxData.netGain.toFixed(2)} €`],
      [],
      ['Détail des transactions'],
      [
        'Date',
        'Type',
        'Monnaie',
        'Quantité',
        'Prix unitaire',
        'Valeur totale',
        'Notes',
      ],
      ...taxData.transactions.map((tx) => [
        new Date(tx.transaction_date).toLocaleDateString('fr-FR'),
        tx.transaction_type,
        tx.transaction_type === 'swap'
          ? `${tx.currency_from} → ${tx.currency_to}`
          : tx.currency_to,
        tx.amount.toString(),
        tx.price_per_unit.toString(),
        tx.total_value.toString(),
        tx.notes,
      ]),
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rapport_fiscal_${selectedYear}.csv`;
    link.click();
  };

  const flatTaxRate = 0.3;
  const estimatedTax = Math.max(0, taxData.netGain * flatTaxRate);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-blue-600" />
            <h3 className="text-lg font-bold text-gray-900">Sélectionner l'année fiscale</h3>
          </div>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700 font-medium mb-1">Total achats</p>
            <p className="text-2xl font-bold text-green-900">
              {taxData.totalBuys.toLocaleString('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              €
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700 font-medium mb-1">Total ventes</p>
            <p className="text-2xl font-bold text-blue-900">
              {taxData.totalSells.toLocaleString('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              €
            </p>
          </div>

          <div
            className={`${
              taxData.netGain >= 0
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-red-50 border-red-200'
            } border rounded-lg p-4`}
          >
            <p
              className={`text-sm font-medium mb-1 ${
                taxData.netGain >= 0 ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              Plus-value nette
            </p>
            <p
              className={`text-2xl font-bold ${
                taxData.netGain >= 0 ? 'text-emerald-900' : 'text-red-900'
              }`}
            >
              {taxData.netGain.toLocaleString('fr-FR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              €
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <h4 className="font-semibold text-gray-900 mb-3">Détail des plus/moins-values</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="flex justify-between">
              <span className="text-gray-600">Plus-values:</span>
              <span className="font-semibold text-green-600">
                +{' '}
                {taxData.capitalGains.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                €
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Moins-values:</span>
              <span className="font-semibold text-red-600">
                -{' '}
                {taxData.capitalLosses.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                €
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4">
          <h4 className="font-semibold text-slate-900 mb-2">
            Estimation de l'impôt (Flat Tax 30%)
          </h4>
          <p className="text-sm text-slate-600 mb-2">
            Cette estimation est basée sur le régime du prélèvement forfaitaire unique (PFU) de
            30% appliqué aux plus-values nettes.
          </p>
          <p className="text-2xl font-bold text-slate-900">
            {estimatedTax.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            €
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Cette estimation est fournie à titre indicatif. Consultez un expert-comptable pour une
            analyse précise.
          </p>
        </div>

        <button
          onClick={handleDownload}
          className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          <Download className="w-5 h-5" />
          Télécharger le rapport CSV
        </button>
      </div>

      {taxData.transactions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h4 className="font-semibold text-gray-900 mb-4">
            Transactions de l'année {selectedYear} ({taxData.transactions.length})
          </h4>
          <div className="space-y-2">
            {taxData.transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-4 p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                  <span className="text-xs sm:text-sm text-gray-600 font-mono">
                    {new Date(tx.transaction_date).toLocaleDateString('fr-FR', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}{' '}
                    <span className="text-gray-400">
                      {String(new Date(tx.transaction_date).getMilliseconds()).padStart(3, '0')}
                    </span>
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tx.transaction_type === 'buy'
                        ? 'bg-green-100 text-green-800'
                        : tx.transaction_type === 'sell'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {tx.transaction_type === 'buy'
                      ? 'Achat'
                      : tx.transaction_type === 'sell'
                      ? 'Vente'
                      : 'Swap'}
                  </span>
                  <span className="font-medium text-gray-900">{tx.currency_to}</span>
                </div>
                <span className="font-semibold text-gray-900">
                  {tx.total_value.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  €
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
