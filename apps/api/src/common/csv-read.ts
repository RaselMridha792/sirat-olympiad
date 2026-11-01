/**
 * CSV reading for admin imports (RFC 4180), the counterpart of csv.ts. Fields are separated by commas and records by
 * CRLF or LF; a field in double quotes may hold commas, line breaks and doubled quotes. A quote inside an unquoted
 * field, or text right after a closing quote, is refused rather than guessed. Line breaks inside a quoted field come
 * back as LF. Pure; the caller decodes the bytes and owns every limit.
 */

export type CsvReadProblem = 'bad_quote' | 'unterminated_quote';

export type CsvRead =
  | { ok: true; records: string[][] }
  /** `record`: 1-based number of the record where reading stopped (the header is record 1). */
  | { ok: false; problem: CsvReadProblem; record: number };

export function parseCsv(text: string): CsvRead {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false; // inside a quoted field
  let closed = false; // the current field was quoted and its closing quote was read
  const endField = () => {
    record.push(field);
    field = '';
    closed = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  const refuse = (problem: CsvReadProblem): CsvRead => ({
    ok: false,
    problem,
    record: records.length + 1,
  });

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (c === '\r') {
        field += '\n';
        if (text[i + 1] === '\n') i += 1;
      } else field += c;
      continue;
    }
    if (c === ',') endField();
    else if (c === '\r' || c === '\n') {
      endRecord();
      if (c === '\r' && text[i + 1] === '\n') i += 1;
    } else if (closed || (c === '"' && field !== '')) return refuse('bad_quote');
    else if (c === '"') quoted = true;
    else field += c;
  }
  if (quoted) return refuse('unterminated_quote');
  // A file usually ends with a line break, which already closed its last record.
  if (field !== '' || closed || record.length > 0) endRecord();
  return { ok: true, records };
}
