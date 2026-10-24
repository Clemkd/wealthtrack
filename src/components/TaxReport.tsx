import { useState, useMemo } from 'react';
import { Transaction } from '../types/database';
import { downloadBlob } from '../lib/download';
import {
  EXEMPTION_THRESHOLD,
  availableTaxYears,
  computeTax,
  estimateTax,
  resolveTaxYear,
  taxReportToCsv,
} from '../lib/tax';
import { Download, Calendar, Info } from 'lucide-react';

interface TaxReportProps {
  transactions: Transaction[];
}

export default function TaxReport({ transactions }: TaxReportProps) {
  const [chosenYear, setChosenYear] = useState<number | null>(null);

  const availableYears = useMemo(() => availableTaxYears(transactions), [transactions]);
  const selectedYear = resolveTaxYear(chosenYear, availableYears, new Date().getFullYear());
  const yearOptions = availableYears.length > 0 ? availableYears : [selectedYear];

  const taxData = useMemo(() => computeTax(transactions, selectedYear), [transactions, selectedYear]);

  const handleDownload = () => {
    const blob = new Blob(['\ufeff' + taxReportToCsv(taxData)], {
      type: 'text/csv;charset=utf-8;',
    });
    downloadBlob(blob, `rapport_fiscal_${selectedYear}.csv`);
  };

  const { isExempt, estimatedTax } = estimateTax(taxData);

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
            onChange={(e) => setChosenYear(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {yearOptions.map((year) => (
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
            <p className="text-sm text-blue-700 font-medium mb-1">Total cessions (ventes)</p>
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

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-semibold text-amber-900 mb-1">Méthode de calcul</h4>
              <p className="text-sm text-amber-800">
                Calcul selon l'article 150 VH bis du CGI : prix moyen pondéré global du portefeuille.
                Les échanges crypto→crypto (swaps) ne sont pas des cessions imposables.
              </p>
            </div>
          </div>
        </div>

        {isExempt && taxData.totalSells > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-green-900 mb-1">Exonération applicable</h4>
                <p className="text-sm text-green-800">
                  Le total annuel de vos cessions ({taxData.totalSells.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} €) est inférieur ou égal à {EXEMPTION_THRESHOLD} €.
                  Vos plus-values sont exonérées d'impôt.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-4">
          <h4 className="font-semibold text-slate-900 mb-2">
            Estimation de l'impôt (PFU 30%)
          </h4>
          <p className="text-sm text-slate-600 mb-2">
            Prélèvement forfaitaire unique (PFU) : 12,8% d'impôt sur le revenu + 17,2% de
            prélèvements sociaux = 30% sur les plus-values nettes.
            {isExempt && taxData.totalSells > 0
              ? ' Exonération applicable (cessions ≤ 305 €).'
              : ''}
          </p>
          {!isExempt && taxData.netGain > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-sm">
              <div className="flex justify-between sm:flex-col">
                <span className="text-slate-600">Impôt sur le revenu (12,8%)</span>
                <span className="font-semibold text-slate-900">
                  {(taxData.netGain * 0.128).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  €
                </span>
              </div>
              <div className="flex justify-between sm:flex-col">
                <span className="text-slate-600">Prélèvements sociaux (17,2%)</span>
                <span className="font-semibold text-slate-900">
                  {(taxData.netGain * 0.172).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  €
                </span>
              </div>
              <div className="flex justify-between sm:flex-col">
                <span className="text-slate-600">Total PFU (30%)</span>
                <span className="font-semibold text-slate-900">
                  {estimatedTax.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  €
                </span>
              </div>
            </div>
          )}
          <p className="text-2xl font-bold text-slate-900">
            {estimatedTax.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            €
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Cette estimation est fournie à titre indicatif. La valeur globale du portefeuille est
            estimée à partir des derniers prix connus. Consultez un expert-comptable pour une
            analyse précise de votre situation (formulaire 2086).
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
