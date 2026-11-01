import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminTaskReviewRow, AdminTaskRow } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const task: AdminTaskRow = {
  id: 't1',
  title: 'Poster week',
  description: 'Share the poster.',
  points: 20,
  archivedAt: null,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  counts: { assigned: 3, submitted: 1, approved: 2, rejected: 0 },
};
const review: AdminTaskReviewRow = {
  assignmentId: 'a1',
  taskId: 't1',
  taskTitle: 'Poster week',
  points: 20,
  ambassador: { userId: 'u1', name: 'Rahim' },
  proof: 'https://example.org/post',
  submittedAt: '2026-11-01T07:00:00.000Z',
};
const page = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

test('admin.listTasks sends the view and passes on only the row fields', async () => {
  const extra = { ...task, createdById: 'admin-1', counts: { ...task.counts, other: 9 } };
  const source = createHttpSource(
    fakeApi({
      '/admin/tasks?status=archived&page=1&pageSize=20': { status: 200, body: page([extra]) },
    }),
  );
  assert.deepEqual(
    await source.admin.listTasks({ page: 1, pageSize: 20, status: 'archived' }),
    page([task]),
  );
});

test('admin.listTaskReviews passes on only the review fields', async () => {
  const extra = {
    ...review,
    ambassador: { ...review.ambassador, email: 'r@example.com' },
    ip: '1.2.3.4',
  };
  const source = createHttpSource(
    fakeApi({ '/admin/task-assignments?page=1&pageSize=20': { status: 200, body: page([extra]) } }),
  );
  const got = await source.admin.listTaskReviews({ page: 1, pageSize: 20 });
  assert.deepEqual(got, page([review]));
  assert.ok(!JSON.stringify(got).includes('example.com'));
});

test('a wrong shape or a refusal is an error (the page shows its error state)', async () => {
  for (const body of [
    page([{ ...task, points: '20' }]),
    page([{ ...task, counts: { assigned: 1 } }]),
    { items: [task] },
  ]) {
    const source = createHttpSource(
      fakeApi({ '/admin/tasks?page=1&pageSize=20': { status: 200, body } }),
    );
    await assert.rejects(source.admin.listTasks({ page: 1, pageSize: 20 }), DataRequestError);
  }
  const refused = createHttpSource(
    fakeApi({ '/admin/task-assignments?page=1&pageSize=20': { status: 403, body: null } }),
  );
  await assert.rejects(refused.admin.listTaskReviews({ page: 1, pageSize: 20 }), DataRequestError);
});
