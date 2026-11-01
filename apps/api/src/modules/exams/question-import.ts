import { createHash } from 'node:crypto';
import {
  CONTROL_CHARACTERS,
  EXAM_LIMITS,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_LIMITS,
  type AdminQuestionInput,
  type QuestionImportCode,
  type QuestionImportError,
  type QuestionImportField,
  type QuestionOption,
} from '@sirat/shared';
import { parseCsv } from '../../common/csv-read';
import { normaliseText, questionProblems } from './exam-rules';

/*
 * The CSV question import as pure functions (E7a; 06-API "Exam admin"): bytes in, questions and problems out, no
 * database. The service adds the duplicate check against the exam and writes all rows or none.
 */

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export interface ImportRow {
  /** As a spreadsheet numbers it: the header is row 1. */
  row: number;
  question: AdminQuestionInput;
}

export interface QuestionFile {
  /** The rows without a problem, in file order. */
  rows: ImportRow[];
  /** Data rows read (blank rows not counted); 0 when the file itself was refused. */
  rowCount: number;
  errors: QuestionImportError[];
  /** Of the exact bytes, for the audit row (never the content). */
  sha256: string;
}

const blank = (cells: string[]) => cells.every((c) => c.trim() === '');

export function readQuestionFile(bytes: Uint8Array): QuestionFile {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const refuse = (code: QuestionImportCode, row = 0, field: QuestionImportField = 'file') => ({
    rows: [],
    rowCount: 0,
    errors: [{ row, field, code }],
    sha256,
  });

  let text: string;
  try {
    // fatal: bytes that are not UTF-8 are refused, never turned into U+FFFD; a BOM is dropped.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return refuse('not_utf8');
  }
  const parsed = parseCsv(text);
  if (!parsed.ok) return refuse(parsed.problem, parsed.record, 'row');

  const [header, ...body] = parsed.records;
  if (!header || blank(header)) return refuse('empty');
  const names = header.map((h) => h.trim().toLowerCase());
  if (
    names.length !== QUESTION_IMPORT_COLUMNS.length ||
    QUESTION_IMPORT_COLUMNS.some((c, i) => names[i] !== c.toLowerCase())
  )
    return refuse('header', 1, 'row');

  const data = body.map((cells, i) => ({ row: i + 2, cells })).filter((r) => !blank(r.cells));
  if (data.length === 0) return refuse('empty');
  if (data.length > QUESTION_IMPORT_LIMITS.maxRows) return refuse('too_many_rows');

  const rows: ImportRow[] = [];
  const errors: QuestionImportError[] = [];
  const seen = new Set<string>();
  for (const { row, cells } of data) {
    const read = readRow(row, cells);
    if (read.question) {
      const key = normaliseText(read.question.text);
      if (seen.has(key)) read.errors.push({ row, field: 'text', code: 'duplicate_in_file' });
      seen.add(key);
    }
    errors.push(...read.errors);
    if (read.question && read.errors.length === 0) rows.push({ row, question: read.question });
  }
  return { rows, rowCount: data.length, errors, sha256 };
}

/** One data row: every problem in it, and the question when its cells could be read at all. */
function readRow(
  row: number,
  cells: string[],
): { question: AdminQuestionInput | null; errors: QuestionImportError[] } {
  const errors: QuestionImportError[] = [];
  const problem = (field: QuestionImportField, code: QuestionImportCode) =>
    errors.push({ row, field, code });
  if (cells.length !== QUESTION_IMPORT_COLUMNS.length) {
    problem('row', 'column_count');
    return { question: null, errors };
  }
  const trimmed = cells.map((c) => c.trim());
  QUESTION_IMPORT_COLUMNS.forEach((column, i) => {
    if (CONTROL_CHARACTERS.test(trimmed[i] ?? '')) problem(column, 'control_character');
  });
  const [text = '', ...rest] = trimmed;
  const optionCells = rest.slice(0, OPTION_KEYS.length);
  const [correct = '', explanation = '', keepOrder = ''] = rest.slice(OPTION_KEYS.length);

  if (!text) problem('text', 'required');
  else if (text.length > EXAM_LIMITS.questionTextMax) problem('text', 'too_long');

  // A and B are required; C–F are optional but without gaps (E filled needs C and D).
  const lastFilled = optionCells.reduce((last, t, i) => (t ? i : last), -1);
  const options: QuestionOption[] = [];
  OPTION_KEYS.forEach((key, i) => {
    const option = optionCells[i] ?? '';
    if (!option) {
      if (i < EXAM_LIMITS.optionsMin) problem(key, 'required');
      else if (i < lastFilled) problem(key, 'gap');
      return;
    }
    if (option.length > EXAM_LIMITS.optionTextMax) problem(key, 'too_long');
    options.push({ key, text: option });
  });

  const correctKey = correct.toUpperCase();
  if (!correct) problem('correct', 'required');
  else if (questionProblems({ options, correctKey }).includes('correct_key_missing'))
    problem('correct', 'correct_key_missing');

  if (explanation.length > EXAM_LIMITS.explanationMax) problem('explanation', 'too_long');

  let keepOptionOrder = false;
  const keep = keepOrder.toLowerCase();
  if (keep === 'true') keepOptionOrder = true;
  else if (keep !== '' && keep !== 'false') problem('keep_order', 'invalid_boolean');

  return {
    question: text
      ? { text, options, correctKey, explanation: explanation || null, keepOptionOrder }
      : null,
    errors,
  };
}

/** Rows whose text an active question of the exam already has (the same rule as the publish check). */
export function examDuplicates(rows: ImportRow[], activeTexts: string[]): QuestionImportError[] {
  const existing = new Set(activeTexts.map(normaliseText));
  return rows
    .filter((r) => existing.has(normaliseText(r.question.text)))
    .map((r) => ({ row: r.row, field: 'text', code: 'duplicate_in_exam' }));
}
