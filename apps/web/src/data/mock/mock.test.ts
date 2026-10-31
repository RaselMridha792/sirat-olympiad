import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSource } from './index.ts';

const source = createMockSource(null);

test('student leaderboard rows carry no score, time or email', async () => {
  const view = await source.leaderboard.get({ page: 1, pageSize: 20 });
  assert.equal(view.status, 'published');
  if (view.status !== 'published') return;
  assert.ok(view.items.length > 0);
  for (const row of view.items) {
    assert.deepEqual(Object.keys(row).sort(), ['entryStatus', 'institution', 'name', 'rank']);
  }
});

test('the server pages: never more than pageSize rows, ranks ascending with shared ties', async () => {
  const view = await source.leaderboard.get({ page: 2, pageSize: 50 });
  assert.equal(view.status, 'published');
  if (view.status !== 'published') return;
  assert.equal(view.items.length, 50);
  assert.ok(view.total > 100); // one exam, one category: still many pages
  const ranks = view.items.map((r) => r.rank);
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
  assert.ok(ranks.every((rank, i) => i === 0 || rank === ranks[i - 1] || rank === 51 + i));
});

test('students cannot search the leaderboard by email', async () => {
  const byName = await source.leaderboard.get({ page: 1, pageSize: 20, q: 'Nafis Ahmed' });
  const byEmail = await source.leaderboard.get({
    page: 1,
    pageSize: 20,
    q: 'nafis.ahmed@example.com',
  });
  assert.ok(byName.status === 'published' && byName.total > 0);
  assert.ok(byEmail.status === 'published' && byEmail.total === 0);
});

test('an exam without published results is reported as unpublished', async () => {
  const view = await source.leaderboard.get({ page: 1, pageSize: 20, exam: 'ex-r2-check' });
  assert.equal(view.status, 'unpublished');
  assert.equal(view.exam?.id, 'ex-r2-check');
  assert.equal(view.items.length, 0);
});

test('each exam ranks its own participants (one category), with shared ties', async () => {
  const view = await source.leaderboard.get({ page: 1, pageSize: 50, exam: 'ex-r1-act' });
  assert.equal(view.status, 'published');
  assert.equal(view.items[0]?.rank, 1);
  const admin = await source.admin.getLeaderboard({ page: 1, pageSize: 50, exam: 'ex-r1-act' });
  assert.ok(admin.items.length > 0 && admin.items.every((r) => r.category === 'activist'));
});

test('student exam cards never include questions or answers', async () => {
  const exams = await source.student.listExams();
  assert.ok(exams.length > 0);
  for (const exam of exams) {
    assert.ok(!('questions' in exam) && !('correctKey' in exam) && !('graceSeconds' in exam));
  }
  assert.ok(exams.some((e) => e.state === 'open') && exams.some((e) => e.state === 'upcoming'));
});

test('?mock=empty and ?mock=error states', async () => {
  const empty = createMockSource('empty');
  assert.equal((await empty.student.listExams()).length, 0);
  assert.equal((await empty.admin.listUsers({ page: 1, pageSize: 20 })).total, 0);
  assert.equal((await empty.leaderboard.get({ page: 1, pageSize: 20 })).status, 'unpublished');
  await assert.rejects(createMockSource('error').student.getHome());
});

test('admin lists are paged on the server and filter by role', async () => {
  const page = await source.admin.listUsers({ page: 1, pageSize: 20, role: 'jury' });
  assert.ok(page.items.length > 0 && page.items.every((u) => u.role === 'jury'));
  const all = await source.admin.listUsers({ page: 1, pageSize: 5000 });
  assert.equal(all.items.length, 50);
  assert.equal(await source.admin.getUser('does-not-exist'), null);
});
