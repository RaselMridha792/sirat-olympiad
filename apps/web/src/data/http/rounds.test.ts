import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminRound, MyRound } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const mine: MyRound = {
  round: {
    id: 'r2',
    name: 'Video round',
    type: 'video',
    sortOrder: 2,
    opensAt: '2026-11-20T04:00:00.000Z',
    closesAt: '2026-11-27T18:00:00.000Z',
  },
  entryStatus: 'pending',
  videoUrl: null,
  videoSubmittedAt: null,
};
const round: AdminRound = {
  ...mine.round,
  criteria: [{ key: 'clarity', en: 'Clarity', bn: 'স্পষ্টতা' }],
  scored: false,
  entries: { pending: 3, submitted: 1, evaluated: 0, promoted: 0, eliminated: 0 },
  promotions: [
    {
      id: 'p1',
      category: 'activist',
      toRoundId: 'r3',
      topN: 2,
      promoted: 3,
      eliminated: 2,
      createdAt: '2026-11-28T04:00:00.000Z',
    },
  ],
  demo: false,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
};

test('student.getMyRound passes on only the round and the own entry', async () => {
  const extra = { ...mine, userId: 'u1', round: { ...mine.round, criteria: [] }, score: 70 };
  const source = createHttpSource(fakeApi({ '/rounds/me': { status: 200, body: extra } }));
  assert.deepEqual(await source.student.getMyRound(), mine);
});

test('admin.listRounds passes on only the round fields', async () => {
  const extra = {
    ...round,
    criteria: [{ ...round.criteria![0], weight: 2 }],
    entries: { ...round.entries, other: 4 },
    promotions: [{ ...round.promotions[0], createdById: 'admin-1' }],
  };
  const source = createHttpSource(
    fakeApi({ '/admin/rounds': { status: 200, body: { items: [extra] } } }),
  );
  assert.deepEqual(await source.admin.listRounds(), [round]);
});

test("the home's round comes from GET /rounds/me", async () => {
  const profile = {
    name: 'Rahim',
    email: 'r@example.org',
    phone: null,
    district: null,
    institution: null,
    educationType: null,
    category: 'activist',
    role: 'student',
    emailVerifiedAt: null,
    createdAt: '2026-11-01T06:00:00.000Z',
    gradeLevel: null,
    currentRound: null,
  };
  const source = createHttpSource(
    fakeApi({
      '/users/me': { status: 200, body: profile },
      '/rounds/me': { status: 200, body: mine },
    }),
  );
  const home = await source.student.getHome();
  assert.deepEqual(home.currentRound, {
    id: 'r2',
    name: 'Video round',
    type: 'video',
    sortOrder: 2,
    entryStatus: 'pending',
  });
});

test('a wrong shape or a refusal is an error (the page shows its error state)', async () => {
  for (const body of [
    { ...mine, entryStatus: 'winner' },
    { ...mine, round: { ...mine.round, type: 'essay' } },
    { ...mine, round: { ...mine.round, sortOrder: '2' } },
  ]) {
    const source = createHttpSource(fakeApi({ '/rounds/me': { status: 200, body } }));
    await assert.rejects(source.student.getMyRound(), DataRequestError);
  }
  for (const body of [
    { items: [{ ...round, entries: { pending: 1 } }] },
    { items: [{ ...round, criteria: [{ key: 'x' }] }] },
    { items: [{ ...round, promotions: [{ ...round.promotions[0], category: 'nobody' }] }] },
    [round],
  ]) {
    const source = createHttpSource(fakeApi({ '/admin/rounds': { status: 200, body } }));
    await assert.rejects(source.admin.listRounds(), DataRequestError);
  }
  const refused = createHttpSource(fakeApi({ '/admin/rounds': { status: 403, body: null } }));
  await assert.rejects(refused.admin.listRounds(), DataRequestError);
});
