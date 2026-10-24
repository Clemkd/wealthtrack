import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { Transaction } from '../types/database';
import { csvToTransactions, readImportZip, transactionsToCsv } from './importExport';
import { parseCsv } from './csv';

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'a',
  transaction_type: 'buy',
  currency_from: null,
  currency_to: 'BTC',
  amount: 1,
  amount_to: null,
  price_per_unit: 100,
  total_value: 100,
  price_per_unit_usd: null,
  total_value_usd: null,
  transaction_date: '2026-01-01T10:00:00.000Z',
  notes: '',
  created_at: 'c',
  updated_at: 'u',
  ...overrides,
});

const HEADER =
  'id,transaction_type,currency_from,currency_to,amount,amount_to,price_per_unit,total_value,price_per_unit_usd,total_value_usd,transaction_date,notes,created_at,updated_at';

async function zipOf(csv: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('transactions.csv', csv);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('CSV round trip', () => {
  it('keeps multi-line notes, quotes and commas in one transaction', () => {
    const original = tx({ notes: 'ligne1\n\nligne "2", fin' });
    const { transactions, skipped } = csvToTransactions(transactionsToCsv([original]));
    expect(skipped).toBe(0);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual(original);
  });

  it('keeps swap received quantities', () => {
    const swap = tx({ transaction_type: 'swap', currency_from: 'SOL', currency_to: 'USDC', amount: 0.022, amount_to: 5.2 });
    expect(csvToTransactions(transactionsToCsv([swap])).transactions[0]).toEqual(swap);
  });

  it('protects formulas on export and restores them on import', () => {
    const risky = tx({ notes: '=HYPERLINK("http://x","y")', currency_from: '=cmd', transaction_type: 'swap', amount_to: 2 });
    const csv = transactionsToCsv([risky]);

    const [header, row] = parseCsv(csv);
    const cell = (name: string) => row[header.indexOf(name)];
    expect(cell('notes')).toBe(`'${risky.notes}`);
    expect(cell('currency_from')).toBe("'=cmd");

    const [back] = csvToTransactions(csv).transactions;
    expect(back.notes).toBe(risky.notes);
    expect(back.currency_from).toBe('=CMD');
  });

  it('survives notes that look like protected formulas and ids starting with a dash', () => {
    const odd = tx({ id: '-x', notes: "'=abc" });
    const [back] = csvToTransactions(transactionsToCsv([odd])).transactions;
    expect(back.id).toBe('-x');
    expect(back.notes).toBe("'=abc");
  });

  it('writes negative numbers untouched', () => {
    expect(transactionsToCsv([tx({ price_per_unit_usd: -1 })])).toContain(',-1,');
  });
});

describe('csvToTransactions', () => {
  it('reads CRLF files', () => {
    const row = 'a,buy,,BTC,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    expect(csvToTransactions(`${HEADER}\r\n${row}\r\n`).transactions).toHaveLength(1);
  });

  it('reads semicolon separated files', () => {
    const csv = `${HEADER.replace(/,/g, ';')}\na;buy;;BTC;1;;100;100;;;2026-01-01T10:00:00.000Z;;c;u`;
    expect(csvToTransactions(csv).transactions[0].currency_to).toBe('BTC');
  });

  it('skips and counts invalid rows instead of coercing them', () => {
    const rows = [
      'ok,buy,,BTC,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u',
      'badtype,vente,,BTC,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u',
      'nodate,buy,,BTC,1,,100,100,,,,,c,u',
      'comma,buy,,BTC,"0,5",,100,100,,,2026-01-01T10:00:00.000Z,,c,u',
      'nocur,buy,,,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u',
    ];
    const { transactions, skipped } = csvToTransactions([HEADER, ...rows].join('\n'));
    expect(transactions.map((t) => t.id)).toEqual(['ok']);
    expect(skipped).toBe(4);
  });

  it('normalises currencies to upper case', () => {
    const row = 'a,SELL,,btc,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    const [t] = csvToTransactions(`${HEADER}\n${row}`).transactions;
    expect(t.currency_to).toBe('BTC');
    expect(t.transaction_type).toBe('sell');
  });

  it('gives duplicated ids a new identity', () => {
    const row = 'same,buy,,BTC,1,,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    const { transactions } = csvToTransactions(`${HEADER}\n${row}\n${row}`);
    expect(new Set(transactions.map((t) => t.id)).size).toBe(2);
  });

  it('skips a swap that has no source currency', () => {
    const row = 'a,swap,,USDC,1,5,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    const result = csvToTransactions(`${HEADER}\n${row}`);
    expect(result.transactions).toEqual([]);
    expect(result.skipped).toBe(1);
  });

  it('skips negative quantities instead of importing them', () => {
    const row = 'a,sell,,BTC,-0.5,,15000,-7500,,,2026-01-01T10:00:00.000Z,,c,u';
    expect(csvToTransactions(`${HEADER}\n${row}`).skipped).toBe(1);
  });

  it('turns an unreadable amount_to into null', () => {
    const row = 'a,swap,SOL,USDC,1,abc,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    expect(csvToTransactions(`${HEADER}\n${row}`).transactions[0].amount_to).toBeNull();
  });

  it('reads files exported before amount_to existed', () => {
    const oldHeader = HEADER.replace('amount_to,', '');
    const row = 'a,buy,,BTC,1,100,100,,,2026-01-01T10:00:00.000Z,,c,u';
    expect(csvToTransactions(`${oldHeader}\n${row}`).transactions[0].amount_to).toBeNull();
  });
});

describe('readImportZip', () => {
  it('returns the transactions without writing anything', async () => {
    const zip = await zipOf(transactionsToCsv([tx()]));
    const result = await readImportZip(zip);
    expect(result.transactions).toHaveLength(1);
  });

  it('refuses an archive without transactions.csv', async () => {
    const zip = new JSZip();
    zip.file('other.txt', 'x');
    await expect(readImportZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /transactions\.csv/
    );
  });

  it('refuses a file holding no valid transaction instead of wiping the data', async () => {
    await expect(readImportZip(await zipOf(HEADER))).rejects.toThrow(/aucune transaction/i);
    await expect(readImportZip(await zipOf(''))).rejects.toThrow(/aucune transaction/i);
  });

  it('strips a UTF-8 BOM', async () => {
    const zip = await zipOf('﻿' + transactionsToCsv([tx()]));
    expect((await readImportZip(zip)).transactions).toHaveLength(1);
  });
});
