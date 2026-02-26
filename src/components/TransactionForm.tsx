import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { TransactionType } from '../types/database';
import { getEurToUsdRate } from '../lib/exchangeRate';
import { X, Plus } from 'lucide-react';

interface TransactionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function TransactionForm({ onSuccess, onCancel }: TransactionFormProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [transactionType, setTransactionType] = useState<TransactionType>('buy');
  const [currencyFrom, setCurrencyFrom] = useState('');
  const [currencyTo, setCurrencyTo] = useState('');
  const [amount, setAmount] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().slice(0, 23)
  );
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!user) {
      setError('Utilisateur non connecté');
      setLoading(false);
      return;
    }

    const amountNum = parseFloat(amount);
    const priceNum = parseFloat(pricePerUnit);
    const totalValue = amountNum * priceNum;

    const eurToUsd = await getEurToUsdRate();
    const pricePerUnitUsd = eurToUsd ? priceNum * eurToUsd : null;
    const totalValueUsd = eurToUsd ? totalValue * eurToUsd : null;

    const { error: insertError } = await supabase.from('transactions').insert({
      user_id: user.id,
      transaction_type: transactionType,
      currency_from: transactionType === 'swap' ? currencyFrom : null,
      currency_to: currencyTo,
      amount: amountNum,
      price_per_unit: priceNum,
      total_value: totalValue,
      price_per_unit_usd: pricePerUnitUsd,
      total_value_usd: totalValueUsd,
      transaction_date: new Date(transactionDate).toISOString(),
      notes: notes,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
          <h2 className="text-2xl font-bold text-gray-900">Nouvelle transaction</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type de transaction
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['buy', 'sell', 'swap'] as TransactionType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTransactionType(type)}
                  className={`py-3 px-4 rounded-lg font-medium transition-all ${
                    transactionType === type
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type === 'buy' ? 'Achat' : type === 'sell' ? 'Vente' : 'Swap'}
                </button>
              ))}
            </div>
          </div>

          {transactionType === 'swap' && (
            <div>
              <label htmlFor="currencyFrom" className="block text-sm font-medium text-gray-700 mb-2">
                Monnaie source
              </label>
              <input
                id="currencyFrom"
                type="text"
                value={currencyFrom}
                onChange={(e) => setCurrencyFrom(e.target.value.toUpperCase())}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="EUR, BTC, ETH..."
              />
            </div>
          )}

          <div>
            <label htmlFor="currencyTo" className="block text-sm font-medium text-gray-700 mb-2">
              {transactionType === 'swap' ? 'Monnaie destination' : 'Monnaie/Crypto'}
            </label>
            <input
              id="currencyTo"
              type="text"
              value={currencyTo}
              onChange={(e) => setCurrencyTo(e.target.value.toUpperCase())}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="BTC, ETH, USDT..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-2">
                Quantité
              </label>
              <input
                id="amount"
                type="number"
                step="0.00000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>

            <div>
              <label htmlFor="pricePerUnit" className="block text-sm font-medium text-gray-700 mb-2">
                Prix unitaire (EUR)
              </label>
              <input
                id="pricePerUnit"
                type="number"
                step="0.01"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>
          </div>

          {amount && pricePerUnit && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Valeur totale:</span>{' '}
                {(parseFloat(amount) * parseFloat(pricePerUnit)).toFixed(2)} EUR
              </p>
            </div>
          )}

          <div>
            <label htmlFor="transactionDate" className="block text-sm font-medium text-gray-700 mb-2">
              Date, heure et secondes
            </label>
            <input
              id="transactionDate"
              type="datetime-local"
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              step="0.001"
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
              Notes (optionnel)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Ajoutez des notes sur cette transaction..."
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              {loading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
