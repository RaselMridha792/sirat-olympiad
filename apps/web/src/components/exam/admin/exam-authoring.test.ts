import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError, SessionExpiredError } from '../../../lib/api.ts';
import {
  addOption,
  authoringProblems,
  createExamBody,
  dhakaToIso,
  editableFields,
  examFormProblems,
  hasQuestionProblems,
  isoToDhaka,
  patchExamBody,
  pickQuestion,
  pickSettings,
  questionBody,
  questionProblems,
  questionRules,
  removeOption,
  stateActions,
  toExamValues,
  toQuestionValues,
  type EditableQuestion,
  type ExamFormValues,
  type ExamSettings,
} from './exam-authoring.ts';

const exam = (over: Partial<ExamSettings> = {}): ExamSettings => ({
  id: '0b6f7d2e-8f1c-4c1e-9a55-1f2d3c4b5a69',
  status: 'draft',
  title: 'Round 1',
  category: null,
  windowStart: '2026-11-20T04:00:00.000Z', // 10:00 in Dhaka
  windowEnd: '2026-11-20T06:00:00.000Z', // 12:00
  durationMinutes: 20,
  questionsPerAttempt: 10,
  graceSeconds: 30,
  randomDraw: false,
  resultsPublishedAt: null,
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...over,
});

const valid = (over: Partial<ExamFormValues> = {}): ExamFormValues => ({
  title: 'Round 1',
  category: '',
  windowStart: '2026-11-20T10:00',
  windowEnd: '2026-11-20T12:00',
  durationMinutes: '20',
  questionsPerAttempt: '10',
  graceSeconds: '30',
  randomDraw: false,
  reason: '',
  ...over,
});

const refused = (status: number, details?: unknown) =>
  new ApiRequestError(status, { statusCode: status, code: 'X', message: 'x', details });

test('times are Bangladesh time whatever the browser clock, and impossible ones are refused', () => {
  assert.equal(dhakaToIso('2026-11-20T10:00'), '2026-11-20T04:00:00.000Z');
  assert.equal(dhakaToIso('2026-11-21T05:30'), '2026-11-20T23:30:00.000Z'); // before 06:00 is the previous UTC day
  assert.equal(isoToDhaka('2026-11-20T23:30:00.000Z'), '2026-11-21T05:30');
  assert.equal(isoToDhaka('2026-11-20T04:00:00+00:00'), '2026-11-20T10:00');
  for (const bad of [
    '',
    '2026-02-30T10:00',
    '2026-11-20T24:00',
    '2026-11-20 10:00',
    '2026-11-20T10:00Z',
  ])
    assert.equal(dhakaToIso(bad), null, bad);
});

test('a new exam starts with the defaults, and an exam fills the form in Bangladesh time', () => {
  assert.deepEqual(toExamValues(), {
    title: '',
    category: '',
    windowStart: '',
    windowEnd: '',
    durationMinutes: '20',
    questionsPerAttempt: '',
    graceSeconds: '30',
    randomDraw: false,
    reason: '',
  });
  assert.deepEqual(toExamValues(exam({ category: 'achiever', randomDraw: true })), {
    ...valid({ category: 'achiever', randomDraw: true }),
  });
});

test('the picks keep only the named fields', () => {
  const extra = {
    ...exam(),
    questions: [{ correctKey: 'A' }],
    publishedAt: null,
  } as unknown as ExamSettings;
  assert.deepEqual(Object.keys(pickSettings(extra)).sort(), Object.keys(exam()).sort());
  const q = {
    id: 'q1',
    text: 'T',
    options: [{ key: 'A', text: 'a', extra: 1 }],
    correctKey: 'A',
    explanation: null,
    keepOptionOrder: false,
    version: 1,
    updatedAt: 'u',
    lineageId: 'l',
    isActive: true,
  } as unknown as EditableQuestion;
  assert.deepEqual(pickQuestion(q), {
    id: 'q1',
    text: 'T',
    options: [{ key: 'A', text: 'a' }],
    correctKey: 'A',
    explanation: null,
    keepOptionOrder: false,
    version: 1,
    updatedAt: 'u',
  });
});

test('what each state lets the settings form change', () => {
  assert.equal(editableFields('new').size, 8);
  assert.equal(editableFields('draft').size, 8);
  assert.deepEqual([...editableFields('published')].sort(), ['title', 'windowEnd']);
  assert.equal(editableFields('archived').size, 0);
});

test('the form checks each field against the shared limits', () => {
  assert.deepEqual(examFormProblems(valid()), {});
  assert.deepEqual(examFormProblems(valid({ title: '   ' })), { title: 'required' });
  assert.deepEqual(examFormProblems(valid({ title: 'x'.repeat(201) })), { title: 'tooLong' });
  assert.deepEqual(examFormProblems(valid({ windowStart: '' })), { windowStart: 'required' });
  assert.deepEqual(examFormProblems(valid({ windowEnd: '2026-02-30T10:00' })), {
    windowEnd: 'time',
  });
  for (const durationMinutes of ['0', '31', '2.5', '', 'ten'])
    assert.deepEqual(
      examFormProblems(valid({ durationMinutes })).durationMinutes,
      'range',
      durationMinutes,
    );
  assert.deepEqual(examFormProblems(valid({ durationMinutes: '30' })), {});
  for (const questionsPerAttempt of ['0', '201', ''])
    assert.equal(examFormProblems(valid({ questionsPerAttempt })).questionsPerAttempt, 'range');
  for (const graceSeconds of ['-1', '301', ''])
    assert.equal(examFormProblems(valid({ graceSeconds })).graceSeconds, 'range');
  assert.deepEqual(examFormProblems(valid({ graceSeconds: '0' })), {});
});

test('the window must hold one whole attempt', () => {
  assert.deepEqual(examFormProblems(valid({ windowEnd: '2026-11-20T10:19' })), {
    windowEnd: 'windowTooShort',
  });
  assert.deepEqual(examFormProblems(valid({ windowEnd: '2026-11-20T10:20' })), {});
  assert.deepEqual(examFormProblems(valid({ windowEnd: '2026-11-20T09:00' })), {
    windowEnd: 'windowTooShort',
  });
});

test('a published exam: only the title and a later close, the latter with a reason', () => {
  const published = exam({ status: 'published' });
  const values = toExamValues(published);
  // Frozen fields are not checked (the form shows them read-only).
  assert.deepEqual(examFormProblems({ ...values, durationMinutes: 'x' }, published), {});
  assert.deepEqual(examFormProblems({ ...values, windowEnd: '2026-11-20T11:00' }, published), {
    windowEnd: 'endNotLater',
    reason: 'reasonLength',
  });
  assert.deepEqual(
    examFormProblems({ ...values, windowEnd: '2026-11-20T13:00', reason: 'ok' }, published),
    { reason: 'reasonLength' },
  );
  assert.deepEqual(
    examFormProblems(
      { ...values, windowEnd: '2026-11-20T13:00', reason: 'Power cut in Sylhet' },
      published,
    ),
    {},
  );
  assert.deepEqual(examFormProblems({ ...values, title: 'Round 1 (final)' }, published), {});
});

test('the create body sends UTC times, null for every category and no round', () => {
  assert.deepEqual(
    createExamBody(valid({ title: '  Round 1 ', category: 'activist', randomDraw: true })),
    {
      title: 'Round 1',
      category: 'activist',
      roundId: null,
      windowStart: '2026-11-20T04:00:00.000Z',
      windowEnd: '2026-11-20T06:00:00.000Z',
      durationMinutes: 20,
      questionsPerAttempt: 10,
      graceSeconds: 30,
      randomDraw: true,
    },
  );
  assert.equal(createExamBody(valid()).category, null);
});

test('the patch sends only what changed, with the version the form opened', () => {
  const draft = exam();
  assert.equal(patchExamBody(draft, toExamValues(draft)), null);
  assert.equal(patchExamBody(draft, { ...toExamValues(draft), title: ' Round 1 ' }), null);
  assert.deepEqual(
    patchExamBody(draft, { ...toExamValues(draft), durationMinutes: '25', category: 'achiever' }),
    { expectedUpdatedAt: draft.updatedAt, category: 'achiever', durationMinutes: 25 },
  );
  assert.deepEqual(patchExamBody(draft, { ...toExamValues(draft), randomDraw: true }), {
    expectedUpdatedAt: draft.updatedAt,
    randomDraw: true,
  });
  assert.deepEqual(
    patchExamBody(draft, { ...toExamValues(draft), windowEnd: '2026-11-20T13:00' }),
    {
      expectedUpdatedAt: draft.updatedAt,
      windowEnd: '2026-11-20T07:00:00.000Z',
    },
  );
});

test('a published patch never carries a frozen field, and sends the reason only with a new close', () => {
  const published = exam({ status: 'published' });
  const values = toExamValues(published);
  assert.equal(
    patchExamBody(published, { ...values, durationMinutes: '5', randomDraw: true }),
    null,
  );
  assert.deepEqual(patchExamBody(published, { ...values, title: 'New', reason: 'ignored' }), {
    expectedUpdatedAt: published.updatedAt,
    title: 'New',
  });
  assert.deepEqual(
    patchExamBody(published, { ...values, windowEnd: '2026-11-20T13:00', reason: ' Power cut ' }),
    {
      expectedUpdatedAt: published.updatedAt,
      windowEnd: '2026-11-20T07:00:00.000Z',
      reason: 'Power cut',
    },
  );
  assert.equal(patchExamBody(exam({ status: 'archived' }), { ...values, title: 'New' }), null);
});

test('the state buttons follow the exam state', () => {
  assert.deepEqual(stateActions({ status: 'draft', resultsPublishedAt: null }), [
    'publish',
    'archive',
  ]);
  assert.deepEqual(stateActions({ status: 'published', resultsPublishedAt: null }), ['unpublish']);
  assert.deepEqual(
    stateActions({ status: 'published', resultsPublishedAt: '2026-11-21T00:00:00Z' }),
    ['unpublish', 'archive'],
  );
  assert.deepEqual(stateActions({ status: 'archived', resultsPublishedAt: null }), []);
});

test('a question fills the editor, and the options are lettered by their place', () => {
  assert.deepEqual(toQuestionValues(), {
    text: '',
    options: ['', '', '', ''],
    correct: -1,
    explanation: '',
    keepOptionOrder: false,
  });
  const q: EditableQuestion = {
    id: 'q1',
    text: 'Capital?',
    options: [
      { key: 'A', text: 'Dhaka' },
      { key: 'B', text: 'Khulna' },
    ],
    correctKey: 'B',
    explanation: null,
    keepOptionOrder: true,
    version: 2,
    updatedAt: 'u',
  };
  const values = toQuestionValues(q);
  assert.deepEqual(values, {
    text: 'Capital?',
    options: ['Dhaka', 'Khulna'],
    correct: 1,
    explanation: '',
    keepOptionOrder: true,
  });
  assert.deepEqual(
    questionBody({
      ...values,
      text: ' Capital? ',
      options: [' Dhaka', 'Khulna ', 'Sylhet'],
      explanation: '  ',
    }),
    {
      text: 'Capital?',
      options: [
        { key: 'A', text: 'Dhaka' },
        { key: 'B', text: 'Khulna' },
        { key: 'C', text: 'Sylhet' },
      ],
      correctKey: 'B',
      explanation: null,
      keepOptionOrder: true,
    },
  );
  assert.equal(questionBody({ ...values, explanation: ' Because. ' }).explanation, 'Because.');
});

test('the editor checks the text, every option, duplicates and the correct choice', () => {
  const ok = {
    text: 'Q',
    options: ['a', 'b'],
    correct: 0,
    explanation: '',
    keepOptionOrder: false,
  };
  assert.equal(hasQuestionProblems(questionProblems(ok)), false);
  assert.deepEqual(questionProblems({ ...ok, text: ' ' }), { text: 'required', options: [] });
  assert.equal(questionProblems({ ...ok, text: 'x'.repeat(2001) }).text, 'tooLong');
  assert.deepEqual(questionProblems({ ...ok, options: ['a', ' '] }).options, [
    undefined,
    'required',
  ]);
  assert.deepEqual(questionProblems({ ...ok, options: ['a', 'x'.repeat(501)] }).options, [
    undefined,
    'tooLong',
  ]);
  assert.deepEqual(questionProblems({ ...ok, options: ['Dhaka', ' dhaka '] }).options, [
    undefined,
    'duplicate',
  ]);
  assert.equal(questionProblems({ ...ok, correct: -1 }).correct, 'pickCorrect');
  assert.equal(questionProblems({ ...ok, correct: 2 }).correct, 'pickCorrect');
  assert.equal(questionProblems({ ...ok, explanation: 'x'.repeat(4001) }).explanation, 'tooLong');
  assert.equal(hasQuestionProblems(questionProblems({ ...ok, options: ['a', ''] })), true);
});

test('adding and removing options keeps 2 to 6, and the correct choice follows its option', () => {
  const base = {
    text: 'Q',
    options: ['a', 'b', 'c'],
    correct: 2,
    explanation: '',
    keepOptionOrder: false,
  };
  assert.deepEqual(removeOption(base, 0), { ...base, options: ['b', 'c'], correct: 1 });
  assert.deepEqual(removeOption(base, 2), { ...base, options: ['a', 'b'], correct: -1 });
  assert.deepEqual(removeOption(base, 1), { ...base, options: ['a', 'c'], correct: 1 });
  const two = { ...base, options: ['a', 'b'], correct: 0 };
  assert.equal(removeOption(two, 0), two);
  let six = base;
  for (let i = 0; i < 5; i++) six = addOption(six);
  assert.equal(six.options.length, 6);
  assert.equal(six.correct, 2);
});

test('what the question buttons offer in each state', () => {
  const draft = { status: 'draft' as const, randomDraw: false, questionsPerAttempt: 10 };
  assert.deepEqual(questionRules(draft, 0), {
    canAdd: true,
    canEdit: true,
    editMakesVersion: false,
    removal: 'delete',
    canRemoveNow: true,
  });
  const fixed = { ...draft, status: 'published' as const };
  assert.deepEqual(questionRules(fixed, 10), {
    canAdd: false,
    canEdit: true,
    editMakesVersion: true,
    removal: null,
    canRemoveNow: false,
  });
  const pool = { ...fixed, randomDraw: true };
  assert.deepEqual(questionRules(pool, 10), {
    canAdd: true,
    canEdit: true,
    editMakesVersion: true,
    removal: 'retire',
    canRemoveNow: false,
  });
  assert.equal(questionRules(pool, 11).canRemoveNow, true);
  const archived = { ...pool, status: 'archived' as const };
  assert.deepEqual(questionRules(archived, 20), {
    canAdd: false,
    canEdit: false,
    editMakesVersion: false,
    removal: null,
    canRemoveNow: false,
  });
});

test('every reason a write was refused comes back, known codes only', () => {
  assert.deepEqual(
    authoringProblems(refused(409, ['question_count', 'window_over', 'question_count'])),
    ['question_count', 'window_over'],
  );
  assert.deepEqual(authoringProblems(refused(409, ['stale'])), ['stale']);
  assert.deepEqual(authoringProblems(refused(409, ['something_new'])), ['failed']);
  assert.deepEqual(authoringProblems(refused(400, ['title must be shorter'])), ['invalid']);
  assert.deepEqual(authoringProblems(refused(400, ['window_too_short'])), ['window_too_short']);
  assert.deepEqual(authoringProblems(refused(404)), ['notFound']);
  assert.deepEqual(authoringProblems(refused(403)), ['failed']);
  assert.deepEqual(authoringProblems(new SessionExpiredError()), ['expired']);
  assert.deepEqual(authoringProblems(new TypeError('Failed to fetch')), ['failed']);
});
