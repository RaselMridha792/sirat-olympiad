import { csvRow } from './csv';
import { parseCsv } from './csv-read';

const read = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(`refused: ${r.problem} at ${r.record}`);
  return r.records;
};

describe('parseCsv (RFC 4180)', () => {
  it('reads CRLF and LF records, with or without a final line break', () => {
    expect(read('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(read('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps empty fields, including trailing ones and blank lines', () => {
    expect(read('a,,c,\r\n\r\n,\r\n')).toEqual([['a', '', 'c', ''], [''], ['', '']]);
  });

  it('reads quoted fields with commas, doubled quotes and line breaks (CRLF inside becomes LF)', () => {
    expect(read('"a, b","say ""hi""","one\r\ntwo",""\r\n')).toEqual([
      ['a, b', 'say "hi"', 'one\ntwo', ''],
    ]);
  });

  it('reads Bangla untouched', () => {
    expect(read('প্রশ্ন,"ক্ষমা, ঋদ্ধি",জ্যোতির্ময়\n')).toEqual([
      ['প্রশ্ন', 'ক্ষমা, ঋদ্ধি', 'জ্যোতির্ময়'],
    ]);
  });

  it('reads back what csv.ts writes, formula guard and all', () => {
    const cells = ['=SUM(A1)', 'a,b', 'he said "x"', 'line\nbreak', '', 'বাংলা'];
    expect(read(csvRow(cells) + csvRow(['x']))).toEqual([
      ["'=SUM(A1)", 'a,b', 'he said "x"', 'line\nbreak', '', 'বাংলা'],
      ['x'],
    ]);
  });

  it('refuses a quote inside an unquoted field, naming the record', () => {
    expect(parseCsv('a,b\nc,d"e\n')).toEqual({ ok: false, problem: 'bad_quote', record: 2 });
  });

  it('refuses text after a closing quote', () => {
    expect(parseCsv('"a"b,c\n')).toEqual({ ok: false, problem: 'bad_quote', record: 1 });
  });

  it('refuses a quoted field that never closes', () => {
    expect(parseCsv('a\n"b,c\n')).toEqual({ ok: false, problem: 'unterminated_quote', record: 2 });
  });

  it('reads an empty text as no records', () => {
    expect(read('')).toEqual([]);
  });
});
