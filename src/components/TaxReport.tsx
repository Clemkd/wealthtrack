import { useState, useMemo } from 'react';
import { Transaction } from '../types/database';
import { Download, Calendar, Info } from 'lucide-react';

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

const EXEMPTION_THRESHOLD = 305;

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

    // Sort ALL transactions chronologically for running totals
    const allTransactions = [...transactions].sort(
      (a, b) => new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime()
    );

    // French tax method (Article 150 VH bis CGI):
    // PV = Prix de cession - (Prix total d'acquisition × Prix de cession / Valeur globale du portefeuille)
    let prixTotalAcquisition = 0;
    const holdings = new Map<string, number>();
    const lastKnownPrices = new Map<string, number>();
    const gainByTx = new Map<string, number>();

    allTransactions.forEach((tx) => {
      if (tx.transaction_type === 'buy') {
        // Acquisition: increase total cost and holdings
        prixTotalAcquisition += tx.total_value;
        holdings.set(tx.currency_to, (holdings.get(tx.currency_to) || 0) + tx.amount);
        lastKnownPrices.set(tx.currency_to, tx.price_per_unit);
      } else if (tx.transaction_type === 'sell') {
        // Taxable cession: apply French formula
        const prixDeCession = tx.total_value;

        // Update last known price for the sold currency
        lastKnownPrices.set(tx.currency_to, tx.price_per_unit);

        // Calculate total portfolio market value at time of sale
        let valeurGlobalePortefeuille = 0;
        holdings.forEach((qty, currency) => {
          if (qty > 0) {
            const price = lastKnownPrices.get(currency) || 0;
            valeurGlobalePortefeuille += qty * price;
          }
        });

        // French formula: PV = PC - (PTA × PC / VGP)
        let plusValue = 0;
        if (valeurGlobalePortefeuille > 0) {
          const fractionAcquisition = prixTotalAcquisition * (prixDeCession / valeurGlobalePortefeuille);
          plusValue = prixDeCession - fractionAcquisition;
          // Reduce PTA by the fraction attributed to this sale
          prixTotalAcquisition = Math.max(0, prixTotalAcquisition - fractionAcquisition);
        }

        // Update holdings
        const currentQty = holdings.get(tx.currency_to) || 0;
        holdings.set(tx.currency_to, Math.max(0, currentQty - tx.amount));

        gainByTx.set(tx.id, plusValue);
      } else if (tx.transaction_type === 'swap') {
        // Swap crypto→crypto: NOT a taxable event under French law
        // Only update portfolio composition, PTA stays the same
        if (tx.currency_from) {
          const fromPrice = lastKnownPrices.get(tx.currency_from) || 0;
          const sourceAmount = fromPrice > 0 ? tx.total_value / fromPrice : 0;
          const currentQty = holdings.get(tx.currency_from) || 0;
          holdings.set(tx.currency_from, Math.max(0, currentQty - sourceAmount));
        }

        // Add target currency to holdings
        holdings.set(tx.currency_to, (holdings.get(tx.currency_to) || 0) + tx.amount);
        lastKnownPrices.set(tx.currency_to, tx.price_per_unit);
      }
    });

    // Calculate yearly totals
    let totalBuys = 0;
    let totalSells = 0;
    let capitalGains = 0;
    let capitalLosses = 0;

    yearTransactions.forEach((tx) => {
      if (tx.transaction_type === 'buy') {
        totalBuys += tx.total_value;
      } else if (tx.transaction_type === 'sell') {
        totalSells += tx.total_value;

        const gain = gainByTx.get(tx.id) || 0;

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
      ['Méthode de calcul', 'Article 150 VH bis CGI - Prix moyen pondéré global du portefeuille'],
      [],
      ['Résumé'],
      ['Total achats', `${taxData.totalBuys.toFixed(2)} €`],
      ['Total cessions (ventes)', `${taxData.totalSells.toFixed(2)} €`],
      ['Plus-values', `${taxData.capitalGains.toFixed(2)} €`],
      ['Moins-values', `${taxData.capitalLosses.toFixed(2)} €`],
      ['Plus-value nette', `${taxData.netGain.toFixed(2)} €`],
      ['Seuil d\'exonération (305 €)', isExempt ? 'Applicable - Pas d\'imposition' : 'Non applicable'],
      ['Impôt estimé (PFU 30%)', `${estimatedTax.toFixed(2)} €`],
      [],
      ['Détail des transactions'],
      [
        'Date',
        'Type',
        'Monnaie',
        'Quantité',
        'Prix unitaire (EUR)',
        'Valeur totale (EUR)',
        'Prix unitaire (USD)',
        'Valeur totale (USD)',
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
        tx.price_per_unit_usd?.toString() ?? '',
        tx.total_value_usd?.toString() ?? '',
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
  const isExempt = taxData.totalSells <= EXEMPTION_THRESHOLD;
  const estimatedTax = isExempt ? 0 : Math.max(0, taxData.netGain * flatTaxRate);

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
