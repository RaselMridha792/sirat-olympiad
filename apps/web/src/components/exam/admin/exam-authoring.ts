import {
  CONTROL_CHARACTERS,
  EXAM_ADMIN_REFUSALS,
  EXAM_LIMITS,
  EXAM_MAX_DURATION_MINUTES,
  QUESTION_IMPORT_CODES,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_LIMITS,
  KEY_CORRECTION_LIMITS,
  type AdminExamInput,
  type AdminExamPatch,
  type AdminExamView,
  type AdminQuestion,
  type AdminQuestionInput,
  type AnswerKeyCorrectionInput,
  type AnswerKeyCorrectionView,
  type Category,
  type ExamAdminRefusal,
  type ExamStatus,
  type QuestionImportCode,
  type QuestionImportError,
  type QuestionImportField,
  type QuestionImportPreview,
} from '@sirat/shared';
import { ApiRequestError, SessionExpiredError } from '../../../lib/api.ts';

/*
 * Exam authoring (E5b) without React: form values, the checks the admin sees before sending, the request bodies and
 * what each state allows. The server decides (06-API "Exam admin"); these only keep the screen honest. Pure, for
 * node --test.
 */

// ───────────── Exam settings ─────────────

/** The settings the forms and buttons need, picked by the page (no questions, so no answer keys). */
export type ExamSettings = Pick<
  AdminExamView,
  | 'id'
  | 'status'
  | 'title'
  | 'category'
  | 'windowStart'
  | 'windowEnd'
  | 'durationMinutes'
  | 'questionsPerAttempt'
  | 'graceSeconds'
  | 'randomDraw'
  | 'resultsPublishedAt'
  | 'updatedAt'
>;

export const pickSettings = (e: ExamSettings): ExamSettings => ({
  id: e.id,
  status: e.status,
  title: e.title,
  category: e.category,
  windowStart: e.windowStart,
  windowEnd: e.windowEnd,
  durationMinutes: e.durationMinutes,
  questionsPerAttempt: e.questionsPerAttempt,
  graceSeconds: e.graceSeconds,
  randomDraw: e.randomDraw,
  resultsPublishedAt: e.resultsPublishedAt,
  updatedAt: e.updatedAt,
});

/** What the inputs hold. Times are Bangladesh wall-clock time, as a datetime-local input gives them. */
export interface ExamFormValues {
  title: string;
  /** '' = every category. */
  category: '' | Category;
  windowStart: string;
  windowEnd: string;
  durationMinutes: string;
  questionsPerAttempt: string;
  graceSeconds: string;
  randomDraw: boolean;
  /** Required when a published exam's window is extended (audited). */
  reason: string;
}

export const EXAM_FIELDS = [
  'title',
  'category',
  'windowStart',
  'windowEnd',
  'durationMinutes',
  'questionsPerAttempt',
  'graceSeconds',
  'randomDraw',
] as const;
export type ExamField = (typeof EXAM_FIELDS)[number];

/** Bangladesh has no daylight saving time, so Asia/Dhaka is always UTC+6. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** An ISO time as Bangladesh wall-clock time for a datetime-local input ("2026-11-10T10:00"). */
export function isoToDhaka(iso: string): string {
  return new Date(Date.parse(iso) + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

/** Bangladesh wall-clock time as ISO (UTC), or null when it is not a real time (Feb 30, 25:00). */
export function dhakaToIso(local: string): string | null {
  const m = LOCAL_TIME.exec(local);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const at = Date.UTC(year, month - 1, day, hour, minute) - DHAKA_OFFSET_MS;
  const iso = new Date(at).toISOString();
  return isoToDhaka(iso) === local ? iso : null;
}

export function toExamValues(exam?: ExamSettings): ExamFormValues {
  if (!exam)
    return {
      title: '',
      category: '',
      windowStart: '',
      windowEnd: '',
      durationMinutes: '20',
      questionsPerAttempt: '',
      graceSeconds: '30',
      randomDraw: false,
      reason: '',
    };
  return {
    title: exam.title,
    category: exam.category ?? '',
    windowStart: isoToDhaka(exam.windowStart),
    windowEnd: isoToDhaka(exam.windowEnd),
    durationMinutes: String(exam.durationMinutes),
    questionsPerAttempt: String(exam.questionsPerAttempt),
    graceSeconds: String(exam.graceSeconds),
    randomDraw: exam.randomDraw,
    reason: '',
  };
}

/** Which settings the form may change: a draft all, a published exam its title and a later close, an archive none. */
export function editableFields(status: ExamStatus | 'new'): ReadonlySet<ExamField> {
  if (status === 'new' || status === 'draft') return new Set(EXAM_FIELDS);
  if (status === 'published') return new Set<ExamField>(['title', 'windowEnd']);
  return new Set<ExamField>();
}

export type ExamFormProblem =
  'required' | 'tooLong' | 'range' | 'time' | 'windowTooShort' | 'endNotLater' | 'reasonLength';
export type ExamFormProblems = Partial<Record<ExamField | 'reason', ExamFormProblem>>;

const whole = (value: string, min: number, max: number): number | null => {
  if (!/^\d{1,6}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= min && n <= max ? n : null;
};

/** What the admin must fix before sending. `exam` absent: a new exam. */
export function examFormProblems(values: ExamFormValues, exam?: ExamSettings): ExamFormProblems {
  const editable = editableFields(exam?.status ?? 'new');
  const problems: ExamFormProblems = {};
  const title = values.title.trim();
  if (editable.has('title')) {
    if (!title) problems.title = 'required';
    else if (title.length > EXAM_LIMITS.titleMax) problems.title = 'tooLong';
  }
  const start = dhakaToIso(values.windowStart);
  const end = dhakaToIso(values.windowEnd);
  if (editable.has('windowStart') && !start)
    problems.windowStart = values.windowStart ? 'time' : 'required';
  if (editable.has('windowEnd') && !end)
    problems.windowEnd = values.windowEnd ? 'time' : 'required';
  const duration = whole(values.durationMinutes, 1, EXAM_MAX_DURATION_MINUTES);
  if (editable.has('durationMinutes') && duration === null) problems.durationMinutes = 'range';
  if (
    editable.has('questionsPerAttempt') &&
    whole(values.questionsPerAttempt, 1, EXAM_LIMITS.questionsPerAttemptMax) === null
  )
    problems.questionsPerAttempt = 'range';
  if (
    editable.has('graceSeconds') &&
    whole(values.graceSeconds, 0, EXAM_LIMITS.graceSecondsMax) === null
  )
    problems.graceSeconds = 'range';
  // The window must hold one whole attempt (the server's window_too_short).
  if (start && end && duration !== null && !problems.windowEnd) {
    if (Date.parse(end) - Date.parse(start) < duration * 60_000)
      problems.windowEnd = 'windowTooShort';
  }
  if (exam?.status === 'published' && end && values.windowEnd !== isoToDhaka(exam.windowEnd)) {
    if (Date.parse(end) <= Date.parse(exam.windowEnd)) problems.windowEnd = 'endNotLater';
    const reason = values.reason.trim().length;
    if (reason < EXAM_LIMITS.reasonMin || reason > EXAM_LIMITS.reasonMax)
      problems.reason = 'reasonLength';
  }
  return problems;
}

/** POST /admin/exams. Call only when examFormProblems found nothing. Rounds have no API yet: always none. */
export function createExamBody(values: ExamFormValues): AdminExamInput {
  return {
    title: values.title.trim(),
    category: values.category || null,
    roundId: null,
    windowStart: dhakaToIso(values.windowStart) ?? '',
    windowEnd: dhakaToIso(values.windowEnd) ?? '',
    durationMinutes: Number(values.durationMinutes.trim()),
    questionsPerAttempt: Number(values.questionsPerAttempt.trim()),
    graceSeconds: Number(values.graceSeconds.trim()),
    randomDraw: values.randomDraw,
  };
}

/**
 * PATCH /admin/exams/:id: only the fields the admin changed and may change, with the version the form opened (a
 * change made elsewhere since is refused as `stale`). null when nothing changed.
 */
export function patchExamBody(exam: ExamSettings, values: ExamFormValues): AdminExamPatch | null {
  const before = toExamValues(exam);
  const editable = editableFields(exam.status);
  const all = createExamBody(values);
  const patch: Partial<AdminExamInput> = {};
  const changed = (field: ExamField) =>
    editable.has(field) &&
    (typeof values[field] === 'string'
      ? (values[field] as string).trim() !== (before[field] as string).trim()
      : values[field] !== before[field]);
  for (const field of EXAM_FIELDS) {
    if (changed(field)) (patch as Record<string, unknown>)[field] = all[field];
  }
  if (Object.keys(patch).length === 0) return null;
  const reason =
    exam.status === 'published' && 'windowEnd' in patch ? { reason: values.reason.trim() } : {};
  return { expectedUpdatedAt: exam.updatedAt, ...patch, ...reason };
}

/** The state changes the buttons offer; the server checks the rest and says why it refuses. */
export function stateActions(
  exam: Pick<ExamSettings, 'status' | 'resultsPublishedAt'>,
): Array<'publish' | 'unpublish' | 'archive'> {
  if (exam.status === 'draft') return ['publish', 'archive'];
  if (exam.status === 'published')
    return exam.resultsPublishedAt ? ['unpublish', 'archive'] : ['unpublish'];
  return [];
}

// ───────────── Questions ─────────────

/** A question as the editor needs it, picked by the page. Admin pages only: it carries the correct key. */
export type EditableQuestion = Pick<
  AdminQuestion,
  | 'id'
  | 'text'
  | 'options'
  | 'correctKey'
  | 'explanation'
  | 'keepOptionOrder'
  | 'version'
  | 'updatedAt'
>;

export const pickQuestion = (q: EditableQuestion): EditableQuestion => ({
  id: q.id,
  text: q.text,
  options: q.options.map((o) => ({ key: o.key, text: o.text })),
  correctKey: q.correctKey,
  explanation: q.explanation,
  keepOptionOrder: q.keepOptionOrder,
  version: q.version,
  updatedAt: q.updatedAt,
});

/** Options take their keys from their place (A, B, C...), so removing one never leaves a gap. */
export const optionKey = (index: number): string => String.fromCharCode(65 + index);

export interface QuestionFormValues {
  text: string;
  options: string[];
  /** Index of the correct option; -1 until the admin picks one. */
  correct: number;
  explanation: string;
  keepOptionOrder: boolean;
}

export function toQuestionValues(q?: EditableQuestion): QuestionFormValues {
  if (!q)
    return {
      text: '',
      options: ['', '', '', ''],
      correct: -1,
      explanation: '',
      keepOptionOrder: false,
    };
  return {
    text: q.text,
    options: q.options.map((o) => o.text),
    correct: q.options.findIndex((o) => o.key === q.correctKey),
    explanation: q.explanation ?? '',
    keepOptionOrder: q.keepOptionOrder,
  };
}

export type QuestionProblem = 'required' | 'tooLong' | 'duplicate' | 'pickCorrect';
export interface QuestionProblems {
  text?: QuestionProblem;
  options: Array<QuestionProblem | undefined>;
  correct?: QuestionProblem;
  explanation?: QuestionProblem;
}

export const hasQuestionProblems = (p: QuestionProblems): boolean =>
  Boolean(p.text || p.correct || p.explanation || p.options.some(Boolean));

export function questionProblems(values: QuestionFormValues): QuestionProblems {
  const seen = new Set<string>();
  const options = values.options.map((raw): QuestionProblem | undefined => {
    const option = raw.trim();
    if (!option) return 'required';
    if (option.length > EXAM_LIMITS.optionTextMax) return 'tooLong';
    // Two options that read the same are always a mistake, though the server would take them.
    const same = option.toLocaleLowerCase();
    if (seen.has(same)) return 'duplicate';
    seen.add(same);
    return undefined;
  });
  const problems: QuestionProblems = { options: options.some(Boolean) ? options : [] };
  const text = values.text.trim();
  if (!text) problems.text = 'required';
  else if (text.length > EXAM_LIMITS.questionTextMax) problems.text = 'tooLong';
  if (values.correct < 0 || values.correct >= values.options.length)
    problems.correct = 'pickCorrect';
  if (values.explanation.trim().length > EXAM_LIMITS.explanationMax)
    problems.explanation = 'tooLong';
  return problems;
}

/** POST and PUT bodies (PUT adds the question's `expectedUpdatedAt`). Call only without problems. */
export function questionBody(values: QuestionFormValues): AdminQuestionInput {
  const explanation = values.explanation.trim();
  return {
    text: values.text.trim(),
    options: values.options.map((text, i) => ({ key: optionKey(i), text: text.trim() })),
    correctKey: optionKey(values.correct),
    explanation: explanation || null,
    keepOptionOrder: values.keepOptionOrder,
  };
}

/** The option list after adding one at the end or removing one, with the correct choice following its option. */
export function addOption(values: QuestionFormValues): QuestionFormValues {
  if (values.options.length >= EXAM_LIMITS.optionsMax) return values;
  return { ...values, options: [...values.options, ''] };
}

export function removeOption(values: QuestionFormValues, index: number): QuestionFormValues {
  if (values.options.length <= EXAM_LIMITS.optionsMin) return values;
  const correct =
    values.correct === index ? -1 : values.correct > index ? values.correct - 1 : values.correct;
  return { ...values, options: values.options.filter((_, i) => i !== index), correct };
}

/**
 * What the question buttons offer. A draft: add, edit in place, delete. A published exam: an edit makes version
 * n+1 (attempts keep theirs); adding and retiring only with a random draw, and retiring only while more than the
 * questions per attempt stay active. An archive: nothing.
 */
export interface QuestionRules {
  canAdd: boolean;
  canEdit: boolean;
  editMakesVersion: boolean;
  removal: 'delete' | 'retire' | null;
  canRemoveNow: boolean;
}

export function questionRules(
  exam: Pick<ExamSettings, 'status' | 'randomDraw' | 'questionsPerAttempt'>,
  activeCount: number,
): QuestionRules {
  if (exam.status === 'draft')
    return {
      canAdd: true,
      canEdit: true,
      editMakesVersion: false,
      removal: 'delete',
      canRemoveNow: true,
    };
  if (exam.status === 'published')
    return {
      canAdd: exam.randomDraw,
      canEdit: true,
      editMakesVersion: true,
      removal: exam.randomDraw ? 'retire' : null,
      canRemoveNow: exam.randomDraw && activeCount > exam.questionsPerAttempt,
    };
  return {
    canAdd: false,
    canEdit: false,
    editMakesVersion: false,
    removal: null,
    canRemoveNow: false,
  };
}

// ───────────── Answer-key corrections (E7b) ─────────────

export type ReasonProblem = 'reasonShort' | 'reasonControl';

/** Why the server would refuse this reason (it is trimmed first), or null. */
export function reasonProblem(reason: string): ReasonProblem | null {
  const text = reason.trim();
  if (text.length < KEY_CORRECTION_LIMITS.reasonMin) return 'reasonShort';
  if (CONTROL_CHARACTERS.test(text)) return 'reasonControl';
  return null;
}

/** POST …/questions/:questionId/key-corrections, with the exam's `updatedAt` from the page. */
export const keyCorrectionBody = (
  toKey: string,
  reason: string,
  expectedUpdatedAt: string,
): AnswerKeyCorrectionInput => ({ toKey, reason: reason.trim(), expectedUpdatedAt });

/** The key in effect per corrected question: the newest correction's (the API lists them newest first). */
export function correctedKeys(
  corrections: ReadonlyArray<Pick<AnswerKeyCorrectionView, 'questionId' | 'toKey'>>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const c of corrections) if (!keys.has(c.questionId)) keys.set(c.questionId, c.toKey);
  return keys;
}

/** A question's number in the page's list (active questions), else its stored position (retired or replaced). */
export function questionNumber(
  exam: { questions: ReadonlyArray<{ id: string }> },
  questionId: string,
  position: number,
): number {
  const index = exam.questions.findIndex((q) => q.id === questionId);
  return index >= 0 ? index + 1 : position;
}

// ───────────── Refusals ─────────────

export type AuthoringProblem = ExamAdminRefusal | 'invalid' | 'notFound' | 'expired' | 'failed';

/**
 * Every reason the server gave for refusing a write (publish can fail several checks at once), known codes only;
 * otherwise one general problem.
 */
export function authoringProblems(error: unknown): AuthoringProblem[] {
  if (error instanceof SessionExpiredError) return ['expired'];
  if (!(error instanceof ApiRequestError)) return ['failed'];
  const details: unknown[] = Array.isArray(error.body?.details) ? error.body.details : [];
  const known = details.filter((d): d is ExamAdminRefusal =>
    (EXAM_ADMIN_REFUSALS as readonly unknown[]).includes(d),
  );
  if (known.length) return [...new Set(known)];
  if (error.status === 400) return ['invalid'];
  if (error.status === 404) return ['notFound'];
  return ['failed'];
}

// ───────────── CSV import (E7a) ─────────────

export type ImportFileProblem = 'notCsv' | 'emptyFile' | 'tooBig';

/** Spares an obviously wrong upload before anything is sent; the server reads the bytes and decides. */
export function importFileProblem(file: { name: string; size: number }): ImportFileProblem | null {
  if (!/\.csv$/i.test(file.name)) return 'notCsv';
  if (file.size === 0) return 'emptyFile';
  if (file.size > QUESTION_IMPORT_LIMITS.maxBytes) return 'tooBig';
  return null;
}

/** POST …/questions/import as a dry run (the check) or the import; the file goes as the multipart field `file`. */
export function importRequest(
  examId: string,
  file: Blob,
  dryRun: boolean,
): [string, { method: 'POST'; body: FormData }] {
  const body = new FormData();
  body.append('file', file);
  const path = `/admin/exams/${encodeURIComponent(examId)}/questions/import?dryRun=${dryRun}`;
  return [path, { method: 'POST', body }];
}

const IMPORT_FIELDS: readonly unknown[] = [...QUESTION_IMPORT_COLUMNS, 'row', 'file'];

export function isImportError(value: unknown): value is QuestionImportError {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    Number.isInteger(e.row) &&
    (e.row as number) >= 0 &&
    IMPORT_FIELDS.includes(e.field) &&
    (QUESTION_IMPORT_CODES as readonly unknown[]).includes(e.code)
  );
}

export function isImportPreview(value: unknown): value is QuestionImportPreview {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    Number.isInteger(p.rows) &&
    typeof p.truncated === 'boolean' &&
    Array.isArray(p.errors) &&
    p.errors.every(isImportError)
  );
}

/** What a refused check or import means for the dialog. */
export type ImportFailure =
  /** 400 QUESTION_IMPORT_INVALID: the file's own problems; nothing was written. */
  | { kind: 'rows'; errors: QuestionImportError[] }
  /** 413: over 1,000,000 bytes. */
  | { kind: 'tooBig' }
  /** Anything else: a published or archived exam, an ended session, the network. */
  | { kind: 'refused'; problems: AuthoringProblem[] };

export function importFailure(error: unknown): ImportFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 413) return { kind: 'tooBig' };
    if (error.status === 400 && error.body?.code === 'QUESTION_IMPORT_INVALID') {
      const details: unknown[] = Array.isArray(error.body.details) ? error.body.details : [];
      const errors = details.filter(isImportError);
      if (errors.length) return { kind: 'rows', errors };
    }
  }
  return { kind: 'refused', problems: authoringProblems(error) };
}

/** The texts one problem line needs (messages.import). */
export interface ImportErrorTexts {
  where: {
    file: string;
    row: (row: string) => string;
    cell: (row: string, column: string) => string;
  };
  columns: Record<QuestionImportField, string>;
  codes: Record<QuestionImportCode, string>;
}

/** "Row 7, option C: Empty while a later option is filled." Rows as the spreadsheet numbers them (header = 1). */
export function importErrorText(
  e: QuestionImportError,
  t: ImportErrorTexts,
  formatRow: (n: number) => string = String,
): string {
  const where =
    e.row === 0
      ? t.where.file
      : e.field === 'row' || e.field === 'file'
        ? t.where.row(formatRow(e.row))
        : t.where.cell(formatRow(e.row), t.columns[e.field]);
  return `${where}: ${t.codes[e.code]}`;
}
