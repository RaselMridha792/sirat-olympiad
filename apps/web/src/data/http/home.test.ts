import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StudentExamListItem } from '@sirat/shared';
import { pickNextExam } from './home.ts';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const exam = (
  id: string,
  state: StudentExamListItem['state'],
  windowStart: string,
): StudentExamListItem => ({
  id,
  title: `Exam ${id}`,
  category: null,
  durationMinutes: 30,
  questionsPerAttempt: 20,
  windowStart,
  windowEnd: '2026-12-01T00:00:00.000Z',
  state,
  resultsPublished: false,
});

const profile = {
  name: 'Rahim Uddin',
  email: 'rahim@test.invalid',
  phone: '01712345678',
  district: 'Dhaka',
  institution: 'Dhaka College',
  educationType: 'Bangla Medium (Bangla & English Version)',
  category: 'activist',
  role: 'student',
  emailVerifiedAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  gradeLevel: { id: 'g8', label: 'Class 8' },
  currentRound: null,
};
const registration = {
  registered: true,
  registeredAt: '2026-11-01T04:00:00.000Z',
  category: 'activist',
  gradeLevel: 'Class 8',
  payment: {
    invoiceNumber: 'T261101ABCDEFGHJK2',
    amountMinor: 40000,
    currency: 'BDT',
    status: 'paid',
    paidAt: '2026-11-01T04:00:00.000Z',
  },
};
const announcement = {
  id: 'a1',
  title: 'Exam dates',
  body: 'Round 1 opens soon.',
  publishedAt: '2026-11-01T04:00:00.000Z',
};

test('the next exam: in progress first, then open, then the earliest upcoming; never a closed one', () => {
  const up1 = exam('u1', 'upcoming', '2026-11-20T00:00:00.000Z');
  const up2 = exam('u2', 'upcoming', '2026-11-10T00:00:00.000Z');
  const open = exam('o1', 'open', '2026-11-01T00:00:00.000Z');
  const going = exam('p1', 'in_progress', '2026-11-01T00:00:00.000Z');
  const done = exam('c1', 'closed', '2026-10-01T00:00:00.000Z');
  assert.equal(pickNextExam([up1, open, going, done])?.id, 'p1');
  assert.equal(pickNextExam([up1, open, done])?.id, 'o1');
  assert.equal(pickNextExam([up1, up2, done])?.id, 'u2');
  assert.equal(pickNextExam([done, exam('s1', 'submitted', '2026-11-01T00:00:00.000Z')]), null);
});

test('getHome composes the profile, the next exam with its grace, 3 announcements and the registration', async () => {
  const next = exam('0190f000-0000-7000-8000-0000000000e1', 'open', '2026-11-01T00:00:00.000Z');
  const get = fakeApi({
    '/users/me': { status: 200, body: { ...profile, passwordHash: 'canary' } },
    '/exams': { status: 200, body: [next] },
    [`/exams/${next.id}`]: {
      status: 200,
      body: {
        ...next,
        graceSeconds: 30,
        violationWarnings: 5,
        serverNow: '2026-11-01T05:00:00.000Z',
        attempt: null,
      },
    },
    '/announcements?page=1&pageSize=3': {
      status: 200,
      body: { items: [{ ...announcement, createdBy: 'canary' }], page: 1, pageSize: 3, total: 1 },
    },
    '/registrations/me': {
      status: 200,
      body: {
        ...registration,
        payment: { ...registration.payment, trxId: 'canary' },
        userId: 'canary',
      },
    },
  });
  const home = await createHttpSource(get).student.getHome();
  assert.deepEqual(home, {
    user: { name: 'Rahim Uddin', category: 'activist' },
    currentRound: null,
    nextExam: {
      id: next.id,
      title: next.title,
      category: null,
      durationMinutes: 30,
      questionsPerAttempt: 20,
      windowStart: '2026-11-01T00:00:00.000Z',
      windowEnd: '2026-12-01T00:00:00.000Z',
      state: 'open',
      graceSeconds: 30,
    },
    latestAnnouncements: [announcement],
    registration,
  });
  assert.equal(JSON.stringify(home).includes('canary'), false);
});

test('without an exam or a registration the home still renders', async () => {
  const quiet = fakeApi({
    '/users/me': { status: 200, body: profile },
    '/exams': { status: 200, body: [] },
    '/announcements?page=1&pageSize=3': {
      status: 200,
      body: { items: [], page: 1, pageSize: 3, total: 0 },
    },
    '/registrations/me': { status: 200, body: { registered: false } },
  });
  const home = await createHttpSource(quiet).student.getHome();
  assert.equal(home.nextExam, null);
  assert.deepEqual(home.registration, { registered: false });
  assert.equal(quiet.calls.includes('/exams/undefined'), false);

});

test('the admin announcement list keeps only its fields and refuses an unknown status', async () => {
  const row = {
    ...announcement,
    category: 'achiever',
    archivedAt: null,
    createdAt: '2026-11-01T03:00:00.000Z',
    updatedAt: '2026-11-01T03:00:00.000Z',
    status: 'published',
    authorName: 'Admin',
  };
  const ok = fakeApi({
    '/admin/announcements?page=1&pageSize=10&status=published': {
      status: 200,
      body: { items: [{ ...row, createdById: 'canary' }], page: 1, pageSize: 10, total: 1 },
    },
  });
  const page = await createHttpSource(ok).admin.listAnnouncements({
    page: 1,
    pageSize: 10,
    status: 'published',
  });
  assert.deepEqual(page.items, [row]);
  const bad = fakeApi({
    '/admin/announcements?page=1&pageSize=10': {
      status: 200,
      body: { items: [{ ...row, status: 'deleted' }], page: 1, pageSize: 10, total: 1 },
    },
  });
  await assert.rejects(
    createHttpSource(bad).admin.listAnnouncements({ page: 1, pageSize: 10 }),
    DataRequestError,
  );
});

test('each section falls back on its own; only the profile is required', async () => {
  const next = exam('0190f000-0000-7000-8000-0000000000e2', 'open', '2026-11-01T00:00:00.000Z');
  const answers: Record<string, ApiResult> = {
    '/users/me': { status: 200, body: profile },
    '/exams': { status: 200, body: [next] },
    [`/exams/${next.id}`]: { status: 503, body: null },
    '/announcements?page=1&pageSize=3': { status: 500, body: null },
    '/registrations/me': { status: 503, body: null },
  };
  const home = await createHttpSource(fakeApi(answers)).student.getHome();
  assert.equal(home.user.name, 'Rahim Uddin');
  assert.equal(home.nextExam, null); // its detail (the grace) failed
  assert.deepEqual(home.latestAnnouncements, []);
  assert.equal(home.registration, null); // the card says "cannot be shown right now"

  const noExams = await createHttpSource(
    fakeApi({ ...answers, '/exams': { status: 500, body: null } }),
  ).student.getHome();
  assert.equal(noExams.nextExam, null);

  await assert.rejects(
    createHttpSource(
      fakeApi({ ...answers, '/users/me': { status: 500, body: null } }),
    ).student.getHome(),
    DataRequestError,
  );
});

test('a redirect from a section (the session expired: to /refresh) is never swallowed by a fallback', async () => {
  const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: 'NEXT_REDIRECT;replace;/refresh;307;',
  });
  const get = (async (path: string) => {
    if (path === '/registrations/me') throw redirect;
    if (path === '/users/me') return { status: 200, body: profile };
    if (path === '/exams') return { status: 200, body: [] };
    return { status: 200, body: { items: [], page: 1, pageSize: 3, total: 0 } };
  }) as ApiGet;
  await assert.rejects(createHttpSource(get).student.getHome(), (e) => e === redirect);
});
