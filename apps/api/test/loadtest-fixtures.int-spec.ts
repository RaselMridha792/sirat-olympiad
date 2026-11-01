/**
 * The exam load test's fixtures (E6; prisma/fixtures/loadtest-fixtures.ts): the students are real accounts on the
 * payment rules, a rerun only adds the missing ones, the exam can be taken over HTTP exactly as k6 does it (a real
 * login with the API's own argon2 parameters, so no re-hash on login), and the report counts what happened.
 */
import type { PrismaClient } from '@prisma/client';
import { seedConfig } from '../prisma/seed';
import {
  createLoadExam,
  ensureLoadUsers,
  hashLoadPassword,
  loadEmail,
  loadReport,
} from '../prisma/fixtures/loadtest-fixtures';
import { bootEngineApp, closeEngineApp, type EngineApp } from './exam-engine-app';
import { applyReferenceData, testPrisma, truncateAll } from './helpers';

jest.setTimeout(180_000);

const PASSWORD = 'Load-river-moon-42';
let env: EngineApp;
let prisma: PrismaClient;
let passwordHash: string;

beforeAll(async () => {
  env = await bootEngineApp(0);
  prisma = testPrisma();
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
  passwordHash = await hashLoadPassword(PASSWORD);
}, 60_000);

afterAll(async () => {
  await closeEngineApp(env);
  await prisma?.$disconnect();
});

const loadUsers = () =>
  prisma.user.findMany({
    where: { email: { endsWith: '@loadtest.invalid' } },
    select: {
      phone: true,
      category: true,
      emailVerifiedAt: true,
      registration: { select: { payment: { select: { status: true, amountMinor: true } } } },
      registrationAttempt: { select: { status: true } },
    },
  });

/** As k6 does it: a real login, then the session cookies on every call. */
async function login(n: number): Promise<{ status: number; cookie: string }> {
  const res = await fetch(`${env.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'k6' },
    body: JSON.stringify({ email: loadEmail(n), password: PASSWORD }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { status: res.status, cookie };
}

async function call<T>(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${env.base}/api${path}`, {
    method,
    headers: {
      cookie,
      'x-requested-with': 'k6',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

describe('load test fixtures', () => {
  it('creates verified students with a paid 400 BDT registration each, across batches and all three categories', async () => {
    expect(await ensureLoadUsers(prisma, 205, passwordHash)).toEqual({ created: 205, skipped: 0 });
    const users = await loadUsers();
    expect(users).toHaveLength(205);
    expect(new Set(users.map((u) => u.phone)).size).toBe(205);
    expect(new Set(users.map((u) => u.category))).toEqual(
      new Set(['activist', 'ambassador', 'achiever']),
    );
    for (const u of users) {
      expect(u.emailVerifiedAt).not.toBeNull();
      expect(u.registration?.payment).toEqual({ status: 'paid', amountMinor: 40000 });
      expect(u.registrationAttempt?.status).toBe('completed');
    }
  });

  it('a rerun adds only the missing students', async () => {
    expect(await ensureLoadUsers(prisma, 210, passwordHash)).toEqual({ created: 5, skipped: 205 });
    expect(await loadUsers()).toHaveLength(210);
  });

  it('the exam is taken over HTTP as k6 does it, without a re-hash on login, and the report counts it', async () => {
    const { examId, windowEnd } = await createLoadExam(prisma, {
      questions: 5,
      duration: 3,
      windowEndInMinutes: 30,
    });
    await env.redis.del('exam:published');
    expect(Date.parse(windowEnd)).toBeGreaterThan(Date.now() + 29 * 60_000);
    const before = await loadReport(prisma, examId);
    expect(before).toMatchObject({ examId, attempts: {}, submissions: {}, overdueOpen: 0 });

    const { status, cookie } = await login(7);
    expect(status).toBe(204);
    const hash = await prisma.user.findUniqueOrThrow({
      where: { email: loadEmail(7) },
      select: { passwordHash: true },
    });
    expect(hash.passwordHash).toBe(passwordHash);

    const room = await call<{ attempt: unknown; durationMinutes: number }>(
      'GET',
      `/exams/${examId}`,
      cookie,
    );
    expect(room.status).toBe(200);
    expect(room.json).toMatchObject({ attempt: null, durationMinutes: 3 });
    const start = await call<{ attemptId: string; questions: unknown[] }>(
      'POST',
      `/exams/${examId}/attempts`,
      cookie,
    );
    expect(start.status).toBe(201);
    expect(start.json.questions).toHaveLength(5);
    const submit = await call<{ receiptId: string }>(
      'POST',
      `/attempts/${start.json.attemptId}/submit`,
      cookie,
      {
        requestId: '0b5e1d1e-6c1f-4a51-9d55-2f0a6d1f7c11',
        answers: [0, 1, null, 2, 3],
        endReason: 'submitted',
        violationCount: 0,
        events: [],
      },
    );
    expect(submit.status).toBe(200);
    expect(submit.json.receiptId).toEqual(expect.any(String));

    const after = await loadReport(prisma, examId);
    expect(after.attempts).toEqual({ submitted: 1 });
    expect(after.submissions).toEqual({ submitted: 1 });
    expect(after.overdueOpen).toBe(0);
    expect(after.writes).toBeGreaterThan(0);
  });
});
