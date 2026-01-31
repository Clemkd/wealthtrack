import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Transaction } from '../types/database';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';
import PortfolioStats from './PortfolioStats';
import PerformanceChart from './PerformanceChart';
import TaxReport from './TaxReport';
import { Plus, LogOut, BarChart3, History, FileText } from 'lucide-react';

type TabType = 'overview' | 'history' | 'charts' | 'tax';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('transaction_date', { ascending: false });

    if (!error && data) {
      setTransactions(data);
    }
    setLoading(false);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    loadTransactions();
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
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Portfolio Crypto</h1>
              <p className="text-sm text-gray-600">{user?.email}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Nouvelle transaction
              </button>
              <button
                onClick={signOut}
                className="flex items-center gap-2 px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Déconnexion
              </button>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
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
        )}
      </main>

      {showForm && <TransactionForm onSuccess={handleFormSuccess} onCancel={() => setShowForm(false)} />}
    </div>
  );
}
