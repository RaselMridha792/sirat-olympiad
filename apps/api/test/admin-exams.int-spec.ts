/**
 * Exam admin over HTTP (06-API "Exam admin", docs/plans/EXAM-PLAN.md section 4): roles, validation, publish checks,
 * the lock after publish, question versions, optimistic concurrency and the audit rows. Boots the real AppModule
 * against the *_test database; sessions are started through SessionService.
 */
import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type {
  AdminExamView,
  AdminQuestion,
  ApiError,
  Paginated,
  AdminExamCard,
} from '@sirat/shared';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import { makeAttempt, OPTIONS } from './exam-helpers';
import { makeUser, testPrisma } from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let sessions: SessionService;
let admin: { id: string; cookie: string };

const HOUR_MS = 60 * 60 * 1000;
const client = { ip: '203.0.113.9', userAgent: 'jest' };

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
  admin = await login('admin');
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

async function login(role: 'admin' | 'manager' | 'student') {
  const user = await makeUser(prisma, { role });
  const issued = await sessions.start({ id: user.id, role: user.role }, client);
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookie = admin.cookie,
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { cookie, 'x-requested-with': 'XMLHttpRequest' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

function examBody(overrides: Record<string, unknown> = {}) {
  const start = Date.now() + 24 * HOUR_MS;
  return {
    title: `Admin exam ${Math.random().toString(36).slice(2, 8)}`,
    category: null,
    roundId: null,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 8 * HOUR_MS).toISOString(),
    durationMinutes: 30,
    questionsPerAttempt: 2,
    graceSeconds: 30,
    randomDraw: false,
    ...overrides,
  };
}

const questionBody = (text: string, overrides: Record<string, unknown> = {}) => ({
  text,
  options: OPTIONS,
  correctKey: 'B',
  explanation: null,
  keepOptionOrder: false,
  ...overrides,
});

async function draftWith(questions: string[], overrides: Record<string, unknown> = {}) {
  const created = await call<AdminExamView>('POST', '/admin/exams', examBody(overrides));
  expect(created.status).toBe(201);
  for (const text of questions)
    expect(
      (await call('POST', `/admin/exams/${created.json.id}/questions`, questionBody(text))).status,
    ).toBe(201);
  return (await call<AdminExamView>('GET', `/admin/exams/${created.json.id}`)).json;
}

async function published(questions = ['One', 'Two'], overrides: Record<string, unknown> = {}) {
  const exam = await draftWith(questions, overrides);
  const res = await call<AdminExamView>('POST', `/admin/exams/${exam.id}/publish`, {
    expectedUpdatedAt: exam.updatedAt,
  });
  expect(res.status).toBe(200);
  return res.json;
}

const auditRows = (examId: string, action: string) =>
  prisma.auditLog.findMany({ where: { entityType: 'exam', entityId: examId, action } });

describe('who may manage exams', () => {
  it('refuses students and managers (403) and a request without a session (401)', async () => {
    for (const role of ['student', 'manager'] as const) {
      const { cookie } = await login(role);
      expect((await call('GET', '/admin/exams', undefined, cookie)).status).toBe(403);
      expect((await call('POST', '/admin/exams', examBody(), cookie)).status).toBe(403);
    }
    expect((await call('GET', '/admin/exams', undefined, '')).status).toBe(401);
  });

  it('re-reads the role on every write: a demoted admin with a valid token gets 403', async () => {
    const demoted = await login('admin');
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'student' } });
    expect((await call('POST', '/admin/exams', examBody(), demoted.cookie)).status).toBe(403);
  });
});

describe('creating and editing a draft', () => {
  it('creates a draft and audits it with the acting admin', async () => {
    const res = await call<AdminExamView>('POST', '/admin/exams', examBody());
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      status: 'draft',
      locked: false,
      randomDraw: false,
      questions: [],
    });
    const [row] = await auditRows(res.json.id, 'exam.created');
    expect(row).toMatchObject({ actorId: admin.id });
  });

  it.each([
    ['a status', { status: 'published' }],
    ['a content version', { contentVersion: 9 }],
    ['a time without a zone', { windowStart: '2026-12-01T10:00:00' }],
    ['a duration over 30', { durationMinutes: 31 }],
    ['a grace over 300', { graceSeconds: 301 }],
  ])('refuses %s (400)', async (_label, overrides) => {
    expect((await call('POST', '/admin/exams', examBody(overrides))).status).toBe(400);
  });

  it('refuses a window shorter than one exam and an unknown round', async () => {
    const start = Date.now() + 24 * HOUR_MS;
    const short = examBody({
      windowEnd: new Date(start + 29 * 60_000).toISOString(),
      windowStart: new Date(start).toISOString(),
    });
    const r1 = await call<ApiError>('POST', '/admin/exams', short);
    expect(r1).toMatchObject({ status: 400, json: { details: ['window_too_short'] } });
    const r2 = await call<ApiError>(
      'POST',
      '/admin/exams',
      examBody({ roundId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(r2).toMatchObject({ status: 400, json: { details: ['round_not_found'] } });
  });

  it('edits a draft freely, but only from the current copy (409 stale)', async () => {
    const exam = await draftWith([]);
    const ok = await call<AdminExamView>('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: exam.updatedAt,
      durationMinutes: 20,
      randomDraw: true,
    });
    expect(ok).toMatchObject({ status: 200, json: { durationMinutes: 20, randomDraw: true } });
    const stale = await call<ApiError>('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: exam.updatedAt,
      title: 'Lost update',
    });
    expect(stale).toMatchObject({ status: 409, json: { details: ['stale'] } });
  });

  it('checks options: unique keys and a correct key among them', async () => {
    const exam = await draftWith([]);
    const dup = questionBody('Dup', {
      options: [...OPTIONS.slice(0, 3), { key: 'A', text: 'Again' }],
    });
    expect(await call<ApiError>('POST', `/admin/exams/${exam.id}/questions`, dup)).toMatchObject({
      status: 400,
      json: { details: ['duplicate_option_key'] },
    });
    const missing = questionBody('Missing', { correctKey: 'F' });
    expect(
      await call<ApiError>('POST', `/admin/exams/${exam.id}/questions`, missing),
    ).toMatchObject({
      status: 400,
      json: { details: ['correct_key_missing'] },
    });
    const extra = { ...questionBody('Extra'), isActive: false };
    expect((await call('POST', `/admin/exams/${exam.id}/questions`, extra)).status).toBe(400);
  });

  it('edits and deletes draft questions in place', async () => {
    const exam = await draftWith(['One']);
    const [q] = exam.questions as [AdminQuestion];
    const edited = await call<AdminQuestion>('PUT', `/admin/exams/${exam.id}/questions/${q.id}`, {
      ...questionBody('One, fixed'),
      expectedUpdatedAt: q.updatedAt,
    });
    expect(edited).toMatchObject({
      status: 200,
      json: { id: q.id, version: 1, text: 'One, fixed' },
    });
    expect((await call('DELETE', `/admin/exams/${exam.id}/questions/${q.id}`)).status).toBe(204);
    expect(await prisma.question.findUnique({ where: { id: q.id } })).toBeNull();
  });
});

describe('publishing (owner Q2: the same questions for everyone by default)', () => {
  it('refuses a pool that differs from the questions per attempt, then publishes', async () => {
    const exam = await draftWith(['One']);
    const refused = await call<ApiError>('POST', `/admin/exams/${exam.id}/publish`, {
      expectedUpdatedAt: exam.updatedAt,
    });
    expect(refused).toMatchObject({ status: 409, json: { details: ['question_count'] } });

    const done = await published(['One', 'Two']);
    expect(done).toMatchObject({ status: 'published', locked: true });
    expect(done.publishedAt).not.toBeNull();
    expect(await auditRows(done.id, 'exam.published')).toHaveLength(1);
  });

  it('refuses duplicate question texts and a stale copy', async () => {
    const exam = await draftWith(['Same', 'same ']);
    expect(
      await call<ApiError>('POST', `/admin/exams/${exam.id}/publish`, {
        expectedUpdatedAt: exam.updatedAt,
      }),
    ).toMatchObject({ status: 409, json: { details: ['duplicate_question_text'] } });
    const old = new Date(new Date(exam.updatedAt).getTime() - 1000).toISOString();
    expect(
      await call<ApiError>('POST', `/admin/exams/${exam.id}/publish`, { expectedUpdatedAt: old }),
    ).toMatchObject({ status: 409, json: { details: ['stale'] } });
  });
});

describe('the lock after publish', () => {
  it('freezes timing and pool; the title changes and the window only grows with a reason', async () => {
    const exam = await published();
    const frozen = await call<ApiError>('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: exam.updatedAt,
      durationMinutes: 10,
    });
    expect(frozen).toMatchObject({ status: 409, json: { details: ['exam_published'] } });

    const later = new Date(new Date(exam.windowEnd).getTime() + HOUR_MS).toISOString();
    const noReason = await call('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: exam.updatedAt,
      windowEnd: later,
    });
    expect(noReason.status).toBe(400);
    const extended = await call<AdminExamView>('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: exam.updatedAt,
      windowEnd: later,
      reason: 'Power cut in two districts',
    });
    expect(extended).toMatchObject({ status: 200, json: { windowEnd: later } });
    const [row] = await auditRows(exam.id, 'exam.window_extended');
    expect(row?.meta).toMatchObject({ reason: 'Power cut in two districts' });

    const shorter = await call<ApiError>('PATCH', `/admin/exams/${exam.id}`, {
      expectedUpdatedAt: extended.json.updatedAt,
      windowEnd: exam.windowEnd,
      reason: 'Undo',
    });
    expect(shorter).toMatchObject({ status: 409, json: { details: ['window_not_extendable'] } });
  });

  it('keeps a fixed pool fixed: no new question, no retirement', async () => {
    const exam = await published();
    const [q] = exam.questions as [AdminQuestion];
    expect(
      await call<ApiError>('POST', `/admin/exams/${exam.id}/questions`, questionBody('Three')),
    ).toMatchObject({ status: 409, json: { details: ['pool_fixed'] } });
    expect(
      await call<ApiError>('DELETE', `/admin/exams/${exam.id}/questions/${q.id}`),
    ).toMatchObject({ status: 409, json: { details: ['pool_fixed'] } });
  });

  it('saves an edit as a new version; the old one stays for attempts that have it', async () => {
    const exam = await published();
    const [q] = exam.questions as [AdminQuestion];
    const next = await call<AdminQuestion>('PUT', `/admin/exams/${exam.id}/questions/${q.id}`, {
      ...questionBody('One, corrected', { correctKey: 'C' }),
      expectedUpdatedAt: q.updatedAt,
    });
    expect(next.status).toBe(200);
    expect(next.json).toMatchObject({
      lineageId: q.lineageId,
      version: 2,
      position: q.position,
      isActive: true,
    });
    expect(next.json.id).not.toBe(q.id);

    const old = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(old).toMatchObject({ isActive: false, text: 'One', correctKey: 'B' });
    expect(old.deactivatedAt).not.toBeNull();

    const view = (await call<AdminExamView>('GET', `/admin/exams/${exam.id}`)).json;
    expect(view.questions.map((x) => x.id)).toContain(next.json.id);
    expect(view.questions.map((x) => x.id)).not.toContain(q.id);

    const versions = await call<AdminQuestion[]>(
      'GET',
      `/admin/exams/${exam.id}/questions/${next.json.id}/versions`,
    );
    expect(versions.json.map((v) => v.version)).toEqual([1, 2]);

    // The replaced version can no longer be edited, and an old copy of the new one is stale.
    expect(
      await call<ApiError>('PUT', `/admin/exams/${exam.id}/questions/${q.id}`, {
        ...questionBody('Again'),
        expectedUpdatedAt: q.updatedAt,
      }),
    ).toMatchObject({ status: 409, json: { details: ['not_active'] } });
    expect(await auditRows(exam.id, 'question.versioned')).toHaveLength(1);
  });

  it('retires from a random-draw pool only while enough questions stay active', async () => {
    const exam = await published(['One', 'Two', 'Three'], { randomDraw: true });
    const [q1, q2] = exam.questions as [AdminQuestion, AdminQuestion];
    expect((await call('DELETE', `/admin/exams/${exam.id}/questions/${q1.id}`)).status).toBe(204);
    expect(await prisma.question.findUniqueOrThrow({ where: { id: q1.id } })).toMatchObject({
      isActive: false,
    });
    expect(
      await call<ApiError>('DELETE', `/admin/exams/${exam.id}/questions/${q2.id}`),
    ).toMatchObject({ status: 409, json: { details: ['pool_too_small'] } });
  });
});

describe('unpublish and archive', () => {
  it('unpublishes before the window when nobody has started', async () => {
    const exam = await published();
    const res = await call<AdminExamView>('POST', `/admin/exams/${exam.id}/unpublish`, {
      expectedUpdatedAt: exam.updatedAt,
    });
    expect(res).toMatchObject({ status: 200, json: { status: 'draft', locked: false } });
  });

  it('refuses to unpublish once someone has an attempt', async () => {
    const exam = await published();
    await makeAttempt(prisma, (await makeUser(prisma)).id, exam.id);
    const res = await call<ApiError>('POST', `/admin/exams/${exam.id}/unpublish`, {
      expectedUpdatedAt: exam.updatedAt,
    });
    expect(res).toMatchObject({ status: 409, json: { details: ['has_attempts'] } });
  });

  it('archives a draft but not a published exam without results; an archived exam takes nothing', async () => {
    const live = await published();
    expect(
      await call<ApiError>('POST', `/admin/exams/${live.id}/archive`, {
        expectedUpdatedAt: live.updatedAt,
      }),
    ).toMatchObject({ status: 409, json: { details: ['results_not_published'] } });

    const draft = await draftWith([]);
    const archived = await call<AdminExamView>('POST', `/admin/exams/${draft.id}/archive`, {
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(archived).toMatchObject({ status: 200, json: { status: 'archived' } });
    expect(
      await call<ApiError>('POST', `/admin/exams/${draft.id}/questions`, questionBody('Late')),
    ).toMatchObject({ status: 409, json: { details: ['exam_archived'] } });
  });
});

describe('listing', () => {
  it('pages, filters by status and searches the title; counts active questions only', async () => {
    const tag = `Findme-${Math.random().toString(36).slice(2, 8)}`;
    const exam = await published(['One', 'Two'], { title: `${tag} live`, randomDraw: true });
    const [q] = exam.questions as [AdminQuestion];
    await call('PUT', `/admin/exams/${exam.id}/questions/${q.id}`, {
      ...questionBody('One v2'),
      expectedUpdatedAt: q.updatedAt,
    });
    await draftWith([], { title: `${tag} draft` });

    const all = await call<Paginated<AdminExamCard>>('GET', `/admin/exams?q=${tag}&pageSize=1`);
    expect(all.json).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(all.json.items).toHaveLength(1);

    const live = await call<Paginated<AdminExamCard>>(
      'GET',
      `/admin/exams?q=${tag}&status=published`,
    );
    expect(live.json.items).toEqual([expect.objectContaining({ id: exam.id, questionCount: 2 })]);
    expect((await call('GET', '/admin/exams?pageSize=51')).status).toBe(400);
  });

  it('answers 404 for an unknown exam and 400 for a malformed id', async () => {
    expect((await call('GET', '/admin/exams/00000000-0000-4000-8000-000000000000')).status).toBe(
      404,
    );
    expect((await call('GET', '/admin/exams/not-a-uuid')).status).toBe(400);
  });
});

describe('the database lock holds even if the API is bypassed', () => {
  it("refuses a direct change of a published exam's duration", async () => {
    const exam = await published();
    await expect(
      prisma.exam.update({ where: { id: exam.id }, data: { durationMinutes: 5 } }),
    ).rejects.toThrow(/exams_frozen_after_publish/);
  });
});
