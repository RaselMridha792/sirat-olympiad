/**
 * The CSV question import over HTTP (E7a; 06-API "Exam admin"): admins only, draft exams only, all rows or none, the
 * dry run writes nothing, the 1,000,000-byte file cap (multer, 413) without touching the global 100 KB JSON limit,
 * and one audit row with the count and the file's hash, never its content. Boots the real AppModule against the
 * *_test database; sessions are started through SessionService.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  QUESTION_IMPORT_LIMITS,
  type AdminExamView,
  type ApiError,
  type QuestionImportPreview,
  type QuestionImportResult,
} from '@sirat/shared';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import { OPTIONS } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;
/** A fresh admin per test: the import tier allows 20 a minute per user. */
let admin: { id: string; cookie: string };

const HOUR_MS = 60 * 60 * 1000;
const client = { ip: '203.0.113.9', userAgent: 'jest' };
const HEADER = 'text,A,B,C,D,E,F,correct,explanation,keep_order';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n') + '\r\n';

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  prisma = testPrisma();
  sessions = app.get(SessionService);
}, 60_000);

beforeEach(async () => {
  admin = await login('admin');
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

async function login(role: 'admin' | 'manager' | 'student') {
  const user = await makeUser(prisma, { role });
  const issued = await sessions.start({ id: user.id, role: user.role }, client);
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

async function call<T = unknown>(method: string, path: string, body?: unknown, raw?: string) {
  const headers: Record<string, string> = {
    cookie: admin.cookie,
    'x-requested-with': 'XMLHttpRequest',
  };
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

/** The upload as the admin screen sends it: multipart, one field `file`. */
async function upload<T = QuestionImportPreview>(
  examId: string,
  file: string | Uint8Array | null,
  dryRun: boolean | null,
  cookie = admin.cookie,
) {
  const form = new FormData();
  if (file !== null) form.append('file', new Blob([file], { type: 'text/csv' }), 'questions.csv');
  const query = dryRun === null ? '' : `?dryRun=${dryRun}`;
  const res = await fetch(`${base}/api/admin/exams/${examId}/questions/import${query}`, {
    method: 'POST',
    headers: { cookie, 'x-requested-with': 'XMLHttpRequest' },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

async function draft(questions: string[] = [], overrides: Record<string, unknown> = {}) {
  const start = Date.now() + 24 * HOUR_MS;
  const created = await call<AdminExamView>('POST', '/admin/exams', {
    title: `Import exam ${Math.random().toString(36).slice(2, 8)}`,
    category: null,
    roundId: null,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 8 * HOUR_MS).toISOString(),
    durationMinutes: 30,
    questionsPerAttempt: 2,
    graceSeconds: 30,
    randomDraw: false,
    ...overrides,
  });
  expect(created.status).toBe(201);
  for (const text of questions) {
    const q = await call('POST', `/admin/exams/${created.json.id}/questions`, {
      text,
      options: OPTIONS,
      correctKey: 'B',
      explanation: null,
      keepOptionOrder: false,
    });
    expect(q.status).toBe(201);
  }
  return (await call<AdminExamView>('GET', `/admin/exams/${created.json.id}`)).json;
}

const questionsOf = (examId: string) =>
  prisma.question.findMany({ where: { examId }, orderBy: { position: 'asc' } });
const importAudits = (examId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: 'exam', entityId: examId, action: 'question.imported' },
  });

const GOOD = csv(
  '"বাংলাদেশের রাজধানী, কোনটি?",ঢাকা,চট্টগ্রাম,খুলনা,,,,A,"ঢাকা ""রাজধানী""",TRUE',
  'ক্ষমা ও ঋদ্ধি — কোনটি যুক্তবর্ণ?,ক্ষ,ম,,,,,a,,',
);

describe('who may import', () => {
  it('refuses students and managers (403) and an anonymous 1 MB upload with 401, never a 5xx', async () => {
    const exam = await draft();
    for (const role of ['student', 'manager'] as const) {
      const { cookie } = await login(role);
      expect((await upload(exam.id, GOOD, true, cookie)).status).toBe(403);
    }
    const big = 'x'.repeat(QUESTION_IMPORT_LIMITS.maxBytes);
    expect((await upload(exam.id, big, false, '')).status).toBe(401);
    expect(await questionsOf(exam.id)).toHaveLength(0);
  });

  it('re-reads the role on the write: a demoted admin with a valid token gets 403', async () => {
    const exam = await draft();
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'student' } });
    expect((await upload(exam.id, GOOD, false)).status).toBe(403);
    expect(await questionsOf(exam.id)).toHaveLength(0);
  });
});

describe('dry run and import', () => {
  it('the dry run reports and writes nothing; the import adds every row after the existing ones, audited', async () => {
    const exam = await draft(['Already here']);
    const dry = await upload(exam.id, GOOD, true);
    expect(dry).toEqual({ status: 200, json: { rows: 2, errors: [], truncated: false } });
    expect(await questionsOf(exam.id)).toHaveLength(1);
    expect(await importAudits(exam.id)).toHaveLength(0);

    const done = await upload<QuestionImportResult>(exam.id, GOOD, false);
    expect(done).toEqual({ status: 201, json: { created: 2 } });
    const rows = await questionsOf(exam.id);
    expect(rows.map((q) => [q.position, q.text, q.correctKey, q.version, q.isActive])).toEqual([
      [1, 'Already here', 'B', 1, true],
      [2, 'বাংলাদেশের রাজধানী, কোনটি?', 'A', 1, true],
      [3, 'ক্ষমা ও ঋদ্ধি — কোনটি যুক্তবর্ণ?', 'A', 1, true],
    ]);
    expect(rows[1]).toMatchObject({
      options: [
        { key: 'A', text: 'ঢাকা' },
        { key: 'B', text: 'চট্টগ্রাম' },
        { key: 'C', text: 'খুলনা' },
      ],
      explanation: 'ঢাকা "রাজধানী"',
      keepOptionOrder: true,
    });
    expect(rows[2]).toMatchObject({ explanation: null, keepOptionOrder: false });
    expect(new Set(rows.map((q) => q.lineageId)).size).toBe(3);

    const audits = await importAudits(exam.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: admin.id, ip: expect.any(String) });
    expect(audits[0]!.meta).toEqual({
      count: 2,
      sha256: createHash('sha256').update(GOOD, 'utf8').digest('hex'),
    });
    expect(JSON.stringify(audits[0]!.meta)).not.toMatch(/রাজধানী|ঢাকা/);

    // The new questions show on the exam at once (the cached config was dropped).
    const view = (await call<AdminExamView>('GET', `/admin/exams/${exam.id}`)).json;
    expect(view.questions).toHaveLength(3);
  });

  it('all or nothing: one bad row anywhere and no row is written, with every problem named', async () => {
    const exam = await draft();
    const file = csv(
      'Good one,a,b,,,,,A,,',
      'Bad one,a,,,,,,A,,',
      'Good two,a,b,,,,,B,,',
      'Bad two,a,b,,,,,C,,maybe',
    );
    const dry = await upload(exam.id, file, true);
    expect(dry.status).toBe(200);
    expect(dry.json.rows).toBe(4);
    expect(dry.json.errors).toEqual([
      { row: 3, field: 'B', code: 'required' },
      { row: 5, field: 'correct', code: 'correct_key_missing' },
      { row: 5, field: 'keep_order', code: 'invalid_boolean' },
    ]);

    const res = await upload<ApiError>(exam.id, file, false);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: 'QUESTION_IMPORT_INVALID', details: dry.json.errors });
    expect(await questionsOf(exam.id)).toHaveLength(0);
    expect(await importAudits(exam.id)).toHaveLength(0);
  });

  it('refuses duplicates within the file and against the exam, by the publish rule', async () => {
    const exam = await draft(['Capital  of Bangladesh?']);
    const file = csv(
      'capital of bangladesh?,a,b,,,,,A,,',
      'New question,a,b,,,,,A,,',
      ' NEW   question ,a,b,,,,,A,,',
    );
    const dry = await upload(exam.id, file, true);
    expect(dry.json.errors).toEqual([
      { row: 2, field: 'text', code: 'duplicate_in_exam' },
      { row: 4, field: 'text', code: 'duplicate_in_file' },
    ]);
    expect((await upload(exam.id, file, false)).status).toBe(400);
    expect(await questionsOf(exam.id)).toHaveLength(1);
  });

  it('a NUL in a question or a control character in an option is a row error (400), never a 500', async () => {
    const exam = await draft();
    const file = csv(
      `Null ${String.fromCharCode(0)} inside,a,b,,,,,A,,`,
      `Bell in an option,a,b${String.fromCharCode(7)},,,,,A,,`,
      'Fine one,a,b,,,,,A,,',
    );
    const res = await upload<ApiError>(exam.id, file, false);
    expect(res).toMatchObject({
      status: 400,
      json: {
        code: 'QUESTION_IMPORT_INVALID',
        details: [
          { row: 2, field: 'text', code: 'control_character' },
          { row: 3, field: 'B', code: 'control_character' },
        ],
      },
    });
    expect(await questionsOf(exam.id)).toHaveLength(0);
    expect(await importAudits(exam.id)).toHaveLength(0);
  });

  it('refuses a file that is not UTF-8 and a file without the header', async () => {
    const exam = await draft();
    const latin1 = Buffer.concat([
      Buffer.from(`${HEADER}\r\nCaf`),
      Buffer.from([0xe9]),
      Buffer.from(',a,b,,,,,A,,\r\n'),
    ]);
    expect((await upload(exam.id, latin1, true)).json.errors).toEqual([
      { row: 0, field: 'file', code: 'not_utf8' },
    ]);
    expect((await upload(exam.id, 'Q,a,b,,,,,A,,\r\n', true)).json.errors).toEqual([
      { row: 1, field: 'row', code: 'header' },
    ]);
  });
});

describe('only a draft takes an import', () => {
  it('a published exam answers 409 pool_fixed, with or without a random draw; an archived one exam_archived', async () => {
    for (const randomDraw of [false, true]) {
      const exam = await draft(['One', 'Two'], { randomDraw });
      const pub = await call('POST', `/admin/exams/${exam.id}/publish`, {
        expectedUpdatedAt: exam.updatedAt,
      });
      expect(pub.status).toBe(200);
      for (const dryRun of [true, false])
        expect(await upload(exam.id, GOOD, dryRun)).toMatchObject({
          status: 409,
          json: { details: ['pool_fixed'] },
        });
      expect(await questionsOf(exam.id)).toHaveLength(2);
    }

    const old = await draft();
    const archived = await call('POST', `/admin/exams/${old.id}/archive`, {
      expectedUpdatedAt: old.updatedAt,
    });
    expect(archived.status).toBe(200);
    expect(await upload(old.id, GOOD, false)).toMatchObject({
      status: 409,
      json: { details: ['exam_archived'] },
    });
    expect(await questionsOf(old.id)).toHaveLength(0);
  });
});

describe('limits and bad requests', () => {
  /** A valid file of exactly `bytes` bytes: rows with a 3,900-character explanation, the last one sized to fit. */
  function fileOf(bytes: number): string {
    const row = (i: number, n: number) => `Question ${i},a,b,,,,,A,${'x'.repeat(n)},\r\n`;
    let text = `${HEADER}\r\n`;
    let i = 0;
    while (bytes - Buffer.byteLength(text) > row(i, 3_900).length + 100) text += row(i++, 3_900);
    // What is left is at most a full row plus 100: the last explanation stays within 4,000 characters.
    return text + row(i, bytes - Buffer.byteLength(text) - row(i, 0).length);
  }

  it('takes a file of exactly 1,000,000 bytes and refuses 1,000,001 with 413', async () => {
    const exam = await draft();
    const max = fileOf(QUESTION_IMPORT_LIMITS.maxBytes);
    expect(Buffer.byteLength(max)).toBe(QUESTION_IMPORT_LIMITS.maxBytes);
    const ok = await upload(exam.id, max, true);
    expect(ok.status).toBe(200);
    expect(ok.json.errors).toEqual([]);
    expect(ok.json.rows).toBeLessThanOrEqual(QUESTION_IMPORT_LIMITS.maxRows);

    const over = await upload<ApiError>(exam.id, `${max}x`, true);
    expect(over).toMatchObject({ status: 413, json: { statusCode: 413 } });
  });

  it(`refuses more than ${QUESTION_IMPORT_LIMITS.maxRows} data rows`, async () => {
    const exam = await draft();
    const rows = Array.from(
      { length: QUESTION_IMPORT_LIMITS.maxRows + 1 },
      (_, i) => `Question ${i},a,b,,,,,A,,`,
    );
    expect((await upload(exam.id, csv(...rows), true)).json.errors).toEqual([
      { row: 0, field: 'file', code: 'too_many_rows' },
    ]);
  });

  it('answers 400 without the dryRun flag or the file, and 404 for an unknown exam', async () => {
    const exam = await draft();
    expect((await upload(exam.id, GOOD, null)).status).toBe(400);
    expect((await upload(exam.id, null, true)).status).toBe(400);
    expect((await upload('00000000-0000-4000-8000-000000000000', GOOD, true)).status).toBe(404);
    expect(await questionsOf(exam.id)).toHaveLength(0);
  });

  it('leaves the 100 KB JSON limit of every other route as it was: 101 KB is 413', async () => {
    const padded = (size: number) => {
      const shell = JSON.stringify({ title: '' });
      return JSON.stringify({ title: 'x'.repeat(size - shell.length) });
    };
    const over = await call('POST', '/admin/exams', undefined, padded(101 * 1024));
    expect(over.status).toBe(413);
    const under = await call('POST', '/admin/exams', undefined, padded(99 * 1024));
    expect(under.status).toBe(400); // read, then refused by validation (title too long, fields missing)
  });
});
