import JSZip from 'jszip';
import { Transaction } from '../types/database';
import { getTransactions } from './storage';
import { escapeCsvField, parseCsv, unescapeCsvField } from './csv';
import { downloadBlob } from './download';
import { normalizeTransaction } from './transactions';

const CSV_FILENAME = 'transactions.csv';

const CSV_HEADERS = [
  'id',
  'transaction_type',
  'currency_from',
  'currency_to',
  'amount',
  'amount_to',
  'price_per_unit',
  'total_value',
  'price_per_unit_usd',
  'total_value_usd',
  'transaction_date',
  'notes',
  'created_at',
  'updated_at',
];

// Free text columns, protected against spreadsheet formulas on export.
const TEXT_COLUMNS = ['currency_from', 'currency_to', 'notes'];

export interface ImportResult {
  transactions: Transaction[];
  skipped: number;
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const rows = transactions.map((tx) =>
    [
      tx.id,
      tx.transaction_type,
      tx.currency_from ?? '',
      tx.currency_to,
      tx.amount,
      tx.amount_to ?? '',
      tx.price_per_unit,
      tx.total_value,
      tx.price_per_unit_usd ?? '',
      tx.total_value_usd ?? '',
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

// Invalid rows are skipped and counted rather than turned into bogus transactions.
export function csvToTransactions(csv: string): ImportResult {
  const [headerRow, ...dataRows] = parseCsv(csv);
  if (!headerRow) return { transactions: [], skipped: 0 };

  const headers = headerRow.map((h) => h.trim());
  const transactions: Transaction[] = [];
  const seenIds = new Set<string>();
  let skipped = 0;

  for (const fields of dataRows) {
    const raw: Record<string, string> = {};
    headers.forEach((name, i) => {
      const value = fields[i] ?? '';
      raw[name] = TEXT_COLUMNS.includes(name) ? unescapeCsvField(value) : value.trim();
    });

    const tx = normalizeTransaction(raw);
    if (!tx) {
      skipped++;
      continue;
    }
    if (seenIds.has(tx.id)) tx.id = crypto.randomUUID();
    seenIds.add(tx.id);
    transactions.push(tx);
  }

  return { transactions, skipped };
}

export async function exportToZip(): Promise<void> {
  const csv = transactionsToCsv(getTransactions());

  const zip = new JSZip();
  zip.file(CSV_FILENAME, '﻿' + csv);

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `wealthtrack_export_${new Date().toISOString().slice(0, 10)}.zip`);
}

// Reads an export archive without touching the stored data: the caller decides
// whether to replace it.
export async function readImportZip(file: Blob | ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const csvFile = zip.file(CSV_FILENAME);

  if (!csvFile) {
    throw new Error(`Le fichier ${CSV_FILENAME} est introuvable dans l'archive.`);
  }

  let csvContent = await csvFile.async('string');
  if (csvContent.charCodeAt(0) === 0xfeff) {
    csvContent = csvContent.slice(1);
  }

  const result = csvToTransactions(csvContent);
  if (result.transactions.length === 0) {
    throw new Error(
      "Aucune transaction valide dans ce fichier : l'import est annulé, vos données actuelles sont conservées."
    );
  }
  return result;
}
