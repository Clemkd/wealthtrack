import JSZip from 'jszip';
import { Transaction } from '../types/database';
import { getTransactions } from './storage';
import { detectDelimiter, escapeCsvField, parseCsv, unescapeCsvField } from './csv';
import { downloadBlob } from './download';
import { dedupeIds, normalizeTransaction } from './transactions';

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

const NUMBER_COLUMNS = [
  'amount',
  'amount_to',
  'price_per_unit',
  'total_value',
  'price_per_unit_usd',
  'total_value_usd',
];

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
  // A semicolon separated file comes from a spreadsheet in a locale with decimal
  // commas; in a comma separated one, "1,000" cannot be told from a thousand
  const decimalComma = detectDelimiter(csv) === ';';
  const parsed: Transaction[] = [];
  let skipped = 0;

  for (const fields of dataRows) {
    const raw: Record<string, string> = {};
    headers.forEach((name, i) => {
      const value = fields[i] ?? '';
      // Notes are kept as typed; every other column is trimmed
      const text = unescapeCsvField(name === 'notes' ? value : value.trim());
      raw[name] =
        decimalComma && NUMBER_COLUMNS.includes(name) && /^[+-]?\d+,\d+$/.test(text)
          ? text.replace(',', '.')
          : text;
    });

    const tx = normalizeTransaction(raw);
    if (!tx) {
      skipped++;
      continue;
    }
    parsed.push(tx);
  }

  return { transactions: dedupeIds(parsed).transactions, skipped };
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

  // A leading byte order mark is removed with the header trimming
  const csvContent = await csvFile.async('string');

  const result = csvToTransactions(csvContent);
  if (result.transactions.length === 0) {
    throw new Error(
      "Aucune transaction valide dans ce fichier : l'import est annulé, vos données actuelles sont conservées."
    );
  }
  return result;
}
