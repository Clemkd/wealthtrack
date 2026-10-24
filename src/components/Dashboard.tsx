import { useState, useRef } from 'react';
import {
  acknowledgeUnreadableData,
  getTransactions,
  hasUnreadableData,
  saveTransactions,
} from '../lib/storage';
import { exportToZip, readImportZip } from '../lib/importExport';
import { Transaction } from '../types/database';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';
import PortfolioStats from './PortfolioStats';
import PerformanceChart from './PerformanceChart';
import TaxReport from './TaxReport';
import GoogleDriveBackup from './GoogleDriveBackup';
import { Plus, BarChart3, History, FileText, Download, Upload } from 'lucide-react';

type TabType = 'overview' | 'history' | 'charts' | 'tax';

// Most recent first
function loadSortedTransactions(): Transaction[] {
  const data = getTransactions();
  data.sort(
    (a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()
  );
  return data;
}

export default function Dashboard() {
  // Read before the first render, so that everything below (the Drive auto-backup
  // included) starts from the real data and not from an empty list
  const [transactions, setTransactions] = useState<Transaction[]>(loadSortedTransactions);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [importError, setImportError] = useState('');
  const [unreadable, setUnreadable] = useState(() => hasUnreadableData());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTransactions = () => {
    setTransactions(loadSortedTransactions());
    setUnreadable(hasUnreadableData());
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    loadTransactions();
  };

  const handleExport = async () => {
    await exportToZip();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError('');
    try {
      const { transactions: imported, skipped } = await readImportZip(file);
      const skippedNote = skipped > 0 ? ` (${skipped} ligne(s) invalide(s) ignorée(s))` : '';
      const confirmed = confirm(
        `Remplacer vos ${transactions.length} transaction(s) actuelle(s) par les ${imported.length} ` +
          `transaction(s) du fichier${skippedNote} ? Cette action est irréversible.`
      );
      if (confirmed) {
        saveTransactions(imported);
        loadTransactions();
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erreur lors de l\'import');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const tabs = [
    { id: 'overview', label: 'Vue d\'ensemble', icon: BarChart3 },
    { id: 'history', label: 'Historique', icon: History },
    { id: 'charts', label: 'Graphiques', icon: BarChart3 },
    { id: 'tax', label: 'Rapport fiscal', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">Portfolio Crypto</h1>
            </div>
            <div className="flex gap-2 sm:gap-3 shrink-0">
              <GoogleDriveBackup transactions={transactions} onRestore={loadTransactions} />
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                title="Exporter les données"
                aria-label="Exporter les données"
              >
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">Exporter</span>
              </button>
              <button
                onClick={handleImportClick}
                className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                title="Importer des données"
                aria-label="Importer des données"
              >
                <Upload className="w-5 h-5" />
                <span className="hidden sm:inline">Importer</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleImportFile}
                className="hidden"
              />
              <button
                onClick={() => setShowForm(true)}
                aria-label="Nouvelle transaction"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 sm:px-6 py-2.5 sm:py-3 rounded-lg transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Nouvelle transaction</span>
              </button>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  aria-label={tab.label}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-6 py-3 font-medium transition-colors border-b-2 whitespace-nowrap text-sm sm:text-base ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {unreadable && (
          <div
            role="status"
            className="mb-4 flex items-start justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm"
          >
            <p>
              Des données illisibles ont été mises de côté sans être supprimées : leur copie brute est
              conservée dans le navigateur (clé wealthtrack_transactions_corrupt). Vérifiez vos
              transactions et exportez-les.
            </p>
            <button
              onClick={() => {
                acknowledgeUnreadableData();
                setUnreadable(false);
                loadTransactions();
              }}
              className="shrink-0 font-semibold underline"
            >
              Compris
            </button>
          </div>
        )}
        {importError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {importError}
          </div>
        )}
          <>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <PortfolioStats transactions={transactions} />
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-4">
                    Dernières transactions
                  </h2>
                  <TransactionList
                    transactions={transactions.slice(0, 10)}
                    onUpdate={loadTransactions}
                  />
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  Historique complet des transactions
                </h2>
                <TransactionList transactions={transactions} onUpdate={loadTransactions} />
              </div>
            )}

            {activeTab === 'charts' && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  Évolution du portefeuille
                </h2>
                <PerformanceChart transactions={transactions} />
              </div>
            )}

            {activeTab === 'tax' && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">Rapport fiscal</h2>
                <TaxReport transactions={transactions} />
              </div>
            )}
          </>
      </main>

      {showForm && <TransactionForm onSuccess={handleFormSuccess} onCancel={() => setShowForm(false)} />}
    </div>
  );
}
