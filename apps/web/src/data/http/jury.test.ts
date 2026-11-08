import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminRoundJury, JuryEntryRow, JuryRound } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>) {
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet;
  return { get, asked };
}

const ROUND = '0190f3a1-7c2e-7d4b-8a11-3c5d9e0f1a2b';
const jury: AdminRoundJury = {
  round: { id: ROUND, name: 'Video round', demo: true },
  assignments: [
    {
      id: 'a1',
      judge: { userId: 'j1', name: 'Judge One', email: 'j1@example.org' },
      category: 'activist',
      createdAt: '2026-11-20T06:00:00.000Z',
    },
  ],
  candidates: [{ userId: 'j1', name: 'Judge One', email: 'j1@example.org' }],
};
const round: JuryRound = {
  id: ROUND,
  name: 'Video round',
  closesAt: '2026-11-27T18:00:00.000Z',
  scoringOpen: true,
  criteria: [{ key: 'clarity', en: 'Clarity', bn: 'স্পষ্টতা' }],
  categories: ['activist'],
  pending: 2,
  evaluated: 1,
};
const entry: JuryEntryRow = {
  entryId: 'e1',
  code: 'E-3FA9C1D2',
  category: 'activist',
  videoUrl: 'https://youtu.be/abc',
  videoSubmittedAt: '2026-11-21T06:00:00.000Z',
  myScore: {
    criteria: { clarity: 7 },
    total: 70,
    comment: null,
    scoredAt: '2026-11-28T06:00:00.000Z',
  },
};
const page = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

test('admin.getRoundJury picks the fields; a malformed id is not sent', async () => {
  const extra = {
    ...jury,
    assignments: [{ ...jury.assignments[0], createdById: 'admin-1' }],
    candidates: [{ ...jury.candidates[0], phone: '01711111111' }],
  };
  const { get, asked } = fakeApi({ [`/admin/rounds/${ROUND}/jury`]: { status: 200, body: extra } });
  const source = createHttpSource(get);
  assert.deepEqual(await source.admin.getRoundJury(ROUND), jury);
  assert.equal(await source.admin.getRoundJury('../users'), null);
  assert.deepEqual(asked, [`/admin/rounds/${ROUND}/jury`]);
});

test("the judge's rounds and entries pass on only their fields, never a name", async () => {
  const { get } = fakeApi({
    '/jury/rounds': { status: 200, body: [{ ...round, judgeIds: ['j1'] }] },
    [`/jury/entries?round=${ROUND}&status=evaluated&page=1&pageSize=20`]: {
      status: 200,
      body: page([{ ...entry, studentName: 'Nusrat Jahan', userId: 'u1' }]),
    },
  });
  const source = createHttpSource(get);
  assert.deepEqual(await source.admin.listJuryRounds(), [round]);
  const got = await source.admin.listJuryEntries({
    round: ROUND,
    status: 'evaluated',
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(got, page([entry]));
  assert.ok(!JSON.stringify(got).includes('Nusrat'));
});

test('a wrong shape or a refusal is an error (the page shows its error state)', async () => {
  for (const body of [
    [{ ...round, scoringOpen: 'yes' }],
    [{ ...round, categories: ['nobody'] }],
    round,
  ])
    await assert.rejects(
      createHttpSource(
        fakeApi({ '/jury/rounds': { status: 200, body } }).get,
      ).admin.listJuryRounds(),
      DataRequestError,
    );
  const path = `/jury/entries?round=${ROUND}&page=1&pageSize=20`;
  for (const body of [
    page([{ ...entry, myScore: { ...entry.myScore, total: '70' } }]),
    page([{ ...entry, videoUrl: null }]),
  ])
    await assert.rejects(
      createHttpSource(fakeApi({ [path]: { status: 200, body } }).get).admin.listJuryEntries({
        round: ROUND,
        page: 1,
        pageSize: 20,
      }),
      DataRequestError,
    );
  const refused = createHttpSource(fakeApi({ '/jury/rounds': { status: 403, body: null } }).get);
  await assert.rejects(refused.admin.listJuryRounds(), DataRequestError);
});
