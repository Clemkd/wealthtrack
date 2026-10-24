import { useEffect, useRef, useState } from 'react';
import { addTransaction, updateTransaction } from '../lib/storage';
import { Transaction, TransactionType, getReceivedAmount } from '../types/database';
import { getEurToUsdRate } from '../lib/exchangeRate';
import { buildTransactionData } from '../lib/transactionForm';
import Dialog from './Dialog';
import Notice from './Notice';
import { X, Plus, Save } from 'lucide-react';

type PriceCurrency = 'EUR' | 'USD';

interface TransactionFormProps {
  transaction?: Transaction;
  onSuccess: () => void;
  onCancel: () => void;
}

// Value for a datetime-local input (local time, millisecond precision).
function toDateTimeLocal(date: Date): string {
  // Imported transactions may carry an empty or invalid date
  if (Number.isNaN(date.getTime())) date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 23);
}

// Currency symbols are short alphanumeric tickers (BTC, USDT...). Anything else,
// e.g. text pasted from the page, would be stored as a bogus currency.
const CURRENCY_MAX_LENGTH = 12;
const CURRENCY_PATTERN = `[A-Z0-9]{1,${CURRENCY_MAX_LENGTH}}`;

function sanitizeCurrency(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CURRENCY_MAX_LENGTH);
}

export default function TransactionForm({ transaction, onSuccess, onCancel }: TransactionFormProps) {
  const isEditing = !!transaction;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [transactionType, setTransactionType] = useState<TransactionType>(
    transaction?.transaction_type ?? 'buy'
  );
  const [currencyFrom, setCurrencyFrom] = useState(transaction?.currency_from ?? '');
  const [currencyTo, setCurrencyTo] = useState(transaction?.currency_to ?? '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [amountTo, setAmountTo] = useState(
    transaction?.transaction_type === 'swap' ? String(getReceivedAmount(transaction)) : ''
  );
  const [pricePerUnit, setPricePerUnit] = useState(
    transaction ? String(transaction.price_per_unit) : ''
  );
  const [priceCurrency, setPriceCurrency] = useState<PriceCurrency>('EUR');
  const [initialDate] = useState(() =>
    toDateTimeLocal(transaction ? new Date(transaction.transaction_date) : new Date())
  );
  const [transactionDate, setTransactionDate] = useState(initialDate);
  const [notes, setNotes] = useState(transaction?.notes ?? '');

  // A rate request can outlive the form: nothing must be saved once it is closed
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await buildTransactionData(
        {
          type: transactionType,
          currencyFrom,
          currencyTo,
          amount,
          amountTo,
          pricePerUnit,
          priceCurrency,
          transactionDate,
          initialTransactionDate: initialDate,
          notes,
        },
        getEurToUsdRate,
        transaction
      );
      if (!mounted.current) return;

      if (transaction) {
        updateTransaction(transaction.id, data);
      } else {
        addTransaction(data);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'enregistrement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog titleId="transaction-form-title" className="bg-white rounded-2xl shadow-2xl max-w-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center rounded-t-2xl">
          <h2 id="transaction-form-title" className="text-2xl font-bold text-gray-900">
            {isEditing ? 'Modifier la transaction' : 'Nouvelle transaction'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <span id="transaction-type-label" className="block text-sm font-medium text-gray-700 mb-2">
              Type de transaction
            </span>
            <div role="group" aria-labelledby="transaction-type-label" className="grid grid-cols-3 gap-3">
              {(['buy', 'sell', 'swap'] as TransactionType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={transactionType === type}
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
                onChange={(e) => setCurrencyFrom(sanitizeCurrency(e.target.value))}
                maxLength={CURRENCY_MAX_LENGTH}
                pattern={CURRENCY_PATTERN}
                title="Symbole de la monnaie (lettres et chiffres uniquement)"
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
              onChange={(e) => setCurrencyTo(sanitizeCurrency(e.target.value))}
              maxLength={CURRENCY_MAX_LENGTH}
              pattern={CURRENCY_PATTERN}
              title="Symbole de la monnaie (lettres et chiffres uniquement)"
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="BTC, ETH, USDT..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-2">
                {transactionType === 'swap' ? 'Quantité envoyée' : 'Quantité'}
              </label>
              <input
                id="amount"
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>

            <div>
              <label htmlFor="pricePerUnit" className="block text-sm font-medium text-gray-700 mb-2">
                {transactionType === 'swap' ? 'Prix unitaire monnaie source' : 'Prix unitaire'} (
                {priceCurrency === 'EUR' ? 'EUR' : 'USD'})
              </label>
              <div className="flex gap-2">
                <input
                  id="pricePerUnit"
                  type="number"
                  step="any"
                  min="0"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                  required
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0.00"
                />
                <select
                  aria-label="Devise du prix"
                  value={priceCurrency}
                  onChange={(e) => setPriceCurrency(e.target.value as PriceCurrency)}
                  className="px-3 py-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium text-gray-700"
                >
                  <option value="EUR">€ EUR</option>
                  <option value="USD">$ USD</option>
                </select>
              </div>
            </div>
          </div>

          {transactionType === 'swap' && (
            <div>
              <label htmlFor="amountTo" className="block text-sm font-medium text-gray-700 mb-2">
                Quantité reçue{currencyTo ? ` (${currencyTo})` : ''}
              </label>
              <input
                id="amountTo"
                type="number"
                step="any"
                min="0"
                value={amountTo}
                onChange={(e) => setAmountTo(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>
          )}

          {amount && pricePerUnit && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Valeur totale:</span>{' '}
                {(parseFloat(amount) * parseFloat(pricePerUnit)).toFixed(2)} {priceCurrency === 'EUR' ? 'EUR' : 'USD'}
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
            <Notice tone="error">{error}</Notice>
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
              {isEditing ? <Save aria-hidden="true" className="w-5 h-5" /> : <Plus aria-hidden="true" className="w-5 h-5" />}
              {loading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
    </Dialog>
  );
}
