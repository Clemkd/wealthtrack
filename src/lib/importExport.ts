import JSZip from 'jszip';
import { Transaction, TransactionType } from '../types/database';
import { getTransactions, saveTransactions } from './storage';

const CSV_FILENAME = 'transactions.csv';

const CSV_HEADERS = [
  'id',
  'transaction_type',
  'currency_from',
  'currency_to',
  'amount',
  'price_per_unit',
  'total_value',
  'transaction_date',
  'notes',
  'created_at',
  'updated_at',
];

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function transactionsToCsv(transactions: Transaction[]): string {
  const rows = transactions.map((tx) =>
    [
      tx.id,
      tx.transaction_type,
      tx.currency_from ?? '',
      tx.currency_to,
      tx.amount.toString(),
      tx.price_per_unit.toString(),
      tx.total_value.toString(),
      tx.transaction_date,
      tx.notes ?? '',
      tx.created_at,
      tx.updated_at,
    ]
      .map(escapeCsvField)
      .join(',')
  );
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

function csvToTransactions(csv: string): Transaction[] {
  const lines = csv.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const idxMap = new Map<string, number>();
  headers.forEach((h, i) => idxMap.set(h.trim(), i));

  const validTypes: TransactionType[] = ['buy', 'sell', 'swap'];

  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const get = (name: string) => {
      const idx = idxMap.get(name);
      return idx !== undefined ? fields[idx]?.trim() ?? '' : '';
    };

    const txType = get('transaction_type') as TransactionType;

    return {
      id: get('id') || crypto.randomUUID(),
      transaction_type: validTypes.includes(txType) ? txType : 'buy',
      currency_from: get('currency_from') || null,
      currency_to: get('currency_to'),
      amount: parseFloat(get('amount')) || 0,
      price_per_unit: parseFloat(get('price_per_unit')) || 0,
      total_value: parseFloat(get('total_value')) || 0,
      transaction_date: get('transaction_date'),
      notes: get('notes'),
      created_at: get('created_at') || new Date().toISOString(),
      updated_at: get('updated_at') || new Date().toISOString(),
    };
  });
}

export async function exportToZip(): Promise<void> {
  const transactions = getTransactions();
  const csv = transactionsToCsv(transactions);

  const zip = new JSZip();
  zip.file(CSV_FILENAME, '\ufeff' + csv);

  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `wealthtrack_export_${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export async function importFromZip(file: File): Promise<Transaction[]> {
  const zip = await JSZip.loadAsync(file);
  const csvFile = zip.file(CSV_FILENAME);

  if (!csvFile) {
    throw new Error(`Le fichier ${CSV_FILENAME} est introuvable dans l'archive.`);
  }

  let csvContent = await csvFile.async('string');
  if (csvContent.charCodeAt(0) === 0xfeff) {
    csvContent = csvContent.slice(1);
  }

  const transactions = csvToTransactions(csvContent);
  saveTransactions(transactions);
  return transactions;
}
