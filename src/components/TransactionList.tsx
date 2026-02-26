import { Transaction } from '../types/database';
import { ArrowUpRight, ArrowDownRight, ArrowLeftRight, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TransactionListProps {
  transactions: Transaction[];
  onUpdate: () => void;
}

export default function TransactionList({ transactions, onUpdate }: TransactionListProps) {
  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette transaction?')) {
      return;
    }

    const { error } = await supabase.from('transactions').delete().eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'buy':
        return <ArrowDownRight className="w-5 h-5 text-green-600" />;
      case 'sell':
        return <ArrowUpRight className="w-5 h-5 text-red-600" />;
      case 'swap':
        return <ArrowLeftRight className="w-5 h-5 text-blue-600" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'buy':
        return 'Achat';
      case 'sell':
        return 'Vente';
      case 'swap':
        return 'Swap';
      default:
        return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'buy':
        return 'bg-green-100 text-green-800';
      case 'sell':
        return 'bg-red-100 text-red-800';
      case 'swap':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Mobile card layout */}
      <div className="block md:hidden">
        {transactions.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-500">
            Aucune transaction enregistrée
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {transactions.map((transaction) => (
              <div key={transaction.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(transaction.transaction_type)}
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${getTypeColor(
                        transaction.transaction_type
                      )}`}
                    >
                      {getTypeLabel(transaction.transaction_type)}
                    </span>
                    {transaction.transaction_type === 'swap' ? (
                      <span className="font-medium text-gray-900">
                        {transaction.currency_from} → {transaction.currency_to}
                      </span>
                    ) : (
                      <span className="font-medium text-gray-900">{transaction.currency_to}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(transaction.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Quantité</span>
                  <span className="font-medium text-gray-900">
                    {transaction.amount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 8,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Prix unitaire</span>
                  <span className="text-gray-700">
                    {transaction.price_per_unit.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Valeur totale</span>
                  <span className="font-semibold text-gray-900">
                    {transaction.total_value.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {new Date(transaction.transaction_date).toLocaleDateString('fr-FR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}{' '}
                  {String(new Date(transaction.transaction_date).getMilliseconds()).padStart(3, '0')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop table layout */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Monnaie
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Quantité
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Prix unitaire
              </th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Valeur totale
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Date
              </th>
              <th className="px-6 py-4 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                  Aucune transaction enregistrée
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(transaction.transaction_type)}
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${getTypeColor(
                          transaction.transaction_type
                        )}`}
                      >
                        {getTypeLabel(transaction.transaction_type)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {transaction.transaction_type === 'swap' ? (
                      <span className="font-medium text-gray-900">
                        {transaction.currency_from} → {transaction.currency_to}
                      </span>
                    ) : (
                      <span className="font-medium text-gray-900">{transaction.currency_to}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-medium text-gray-900">
                    {transaction.amount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 8,
                    })}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-700">
                    {transaction.price_per_unit.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    €
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-gray-900">
                    {transaction.total_value.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    €
                  </td>
                  <td className="px-6 py-4 text-gray-700 font-mono text-sm">
                    {new Date(transaction.transaction_date).toLocaleDateString('fr-FR', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}{' '}
                    <span className="text-gray-500">
                      {String(new Date(transaction.transaction_date).getMilliseconds()).padStart(3, '0')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleDelete(transaction.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
