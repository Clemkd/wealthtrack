import { describe, expect, it } from 'vitest';
import { escapeCsvField, parseCsv, unescapeCsvField } from './csv';

describe('escapeCsvField', () => {
  it('leaves plain text and numbers untouched', () => {
    expect(escapeCsvField('BTC')).toBe('BTC');
    expect(escapeCsvField(-5.5)).toBe('-5.5');
  });

  it('quotes fields with commas, quotes and line breaks', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('l1\nl2')).toBe('"l1\nl2"');
    expect(escapeCsvField('l1\r\nl2')).toBe('"l1\r\nl2"');
  });

  it.each(['=1+1', '+1', '-1+2', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises spreadsheet formulas in text starting with %j',
    (text) => {
      expect(escapeCsvField(text).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  );

  it('round-trips through unescapeCsvField', () => {
    for (const text of ['=HYPERLINK("x","y")', '-note', '@a', 'plain', "'quoted"]) {
      const [[field]] = parseCsv(escapeCsvField(text));
      expect(unescapeCsvField(field)).toBe(text);
    }
  });
});

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps line breaks and blank lines inside quoted fields', () => {
    expect(parseCsv('id,notes\n1,"line1\n\nline2"\n2,x')).toEqual([
      ['id', 'notes'],
      ['1', 'line1\n\nline2'],
      ['2', 'x'],
    ]);
  });

  it('handles CRLF and escaped quotes', () => {
    expect(parseCsv('a,b\r\n"x ""y""",2\r\n')).toEqual([
      ['a', 'b'],
      ['x "y"', '2'],
    ]);
  });

  it('detects the semicolon delimiter from the header', () => {
    expect(parseCsv('a;b\n1;"2;3"')).toEqual([
      ['a', 'b'],
      ['1', '2;3'],
    ]);
  });

  it('skips empty lines outside quotes', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
