import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminExamLeaderboard, ExamLeaderboard } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

/* GET /leaderboard and GET /admin/leaderboard through the HTTP source (E5a; owner Q5). */

const EXAM = '0b9f6c1e-4a7d-4c2b-9e3f-1a2b3c4d5e6f';

function fakeApi(answers: Record<string, ApiResult>): ApiGet & { calls: string[] } {
  const calls: string[] = [];
  const get = (async (path: string) => {
    calls.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { calls: string[] };
  get.calls = calls;
  return get;
}

const board: ExamLeaderboard = {
  items: [
    { rank: 1, name: 'Nafis', institution: 'Dhaka College', entryStatus: null },
    { rank: 2, name: 'Rima', institution: null, entryStatus: null },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  exam: { id: EXAM, title: 'Round 1', category: 'activist' },
  status: 'published',
  snapshotAt: '2026-11-21T17:00:00.000Z',
};

const adminBoard: AdminExamLeaderboard = {
  items: [
    {
      rank: 1,
      name: 'Nafis',
      institution: 'Dhaka College',
      entryStatus: null,
      userId: 'u-1',
      email: 'nafis@example.com',
      category: 'activist',
      score: 18,
      timeTakenSeconds: 912,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  exam: { id: EXAM, title: 'Round 1', category: 'activist' },
  isPublic: false,
  snapshotAt: '2026-11-21T17:00:00.000Z',
  generation: 2,
};

test('the student board passes on rank, name and institution only, at every level', async () => {
  const body = {
    ...board,
    secret: 1,
    exam: { ...board.exam, windowEnd: 'x' },
    items: board.items.map((row) => ({
      ...row,
      score: 17,
      email: 'x@example.com',
      timeTakenSeconds: 9,
    })),
  };
  const path = `/leaderboard?exam=${EXAM}&page=1&pageSize=20&q=dhaka`;
  const get = fakeApi({ [path]: { status: 200, body } });
  const view = await createHttpSource(get).leaderboard.get({
    exam: EXAM,
    page: 1,
    pageSize: 20,
    q: 'dhaka',
  });
  assert.deepEqual(get.calls, [path]);
  assert.deepEqual(view, board);
});

test('an exam id the API would refuse is dropped: the latest exam with results is shown', async () => {
  const path = '/leaderboard?page=1&pageSize=20';
  const get = fakeApi({
    [path]: { status: 200, body: { ...board, status: 'unpublished', items: [] } },
  });
  await createHttpSource(get).leaderboard.get({ exam: '../admin', page: 1, pageSize: 20 });
  assert.deepEqual(get.calls, [path]);
});

test('the student board refuses an unexpected shape and passes refusals on', async () => {
  const path = '/leaderboard?page=1&pageSize=20';
  for (const bad of [
    { ...board, status: 'draft' },
    { ...board, items: [{ ...board.items[0], rank: '1' }] },
    { ...board, items: [{ ...board.items[0], entryStatus: 'winner' }] },
    { ...board, exam: { ...board.exam, category: 'sdg' } },
    { ...board, total: undefined },
  ]) {
    const get = fakeApi({ [path]: { status: 200, body: bad } });
    await assert.rejects(
      createHttpSource(get).leaderboard.get({ page: 1, pageSize: 20 }),
      DataRequestError,
    );
  }
  const refused = fakeApi({ [path]: { status: 404, body: null } });
  await assert.rejects(
    createHttpSource(refused).leaderboard.get({ page: 1, pageSize: 20 }),
    DataRequestError,
  );
});

test('the admin board passes on the staff fields and nothing else', async () => {
  const body = {
    ...adminBoard,
    items: adminBoard.items.map((row) => ({ ...row, phone: '01700000001', passwordHash: 'x' })),
  };
  const path = `/admin/leaderboard?exam=${EXAM}&page=1&pageSize=20`;
  const get = fakeApi({ [path]: { status: 200, body } });
  const view = await createHttpSource(get).admin.getLeaderboard({
    exam: EXAM,
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(view, adminBoard);
  for (const bad of [
    { ...adminBoard, isPublic: 'yes' },
    { ...adminBoard, items: [{ ...adminBoard.items[0], email: null }] },
    { ...adminBoard, generation: 1.5 },
  ]) {
    const wrong = fakeApi({ [path]: { status: 200, body: bad } });
    await assert.rejects(
      createHttpSource(wrong).admin.getLeaderboard({ exam: EXAM, page: 1, pageSize: 20 }),
      DataRequestError,
    );
  }
});
