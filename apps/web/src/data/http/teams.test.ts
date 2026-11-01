import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminTeamDetail, AdminTeamRow, MyTeam } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet & { asked: string[] };
  get.asked = asked;
  return get;
}

const TEAM_ID = '0190f3a1-7c2e-7d4b-8a11-3c5d9e0f1a2b';
const mine: MyTeam = {
  id: TEAM_ID,
  name: 'Dhaka Readers',
  memberCount: 2,
  isOwner: true,
  joinCode: 'TM-7K3Q9P',
  members: [
    { firstName: 'Rahim', isOwner: true },
    { firstName: 'Karim', isOwner: false },
  ],
};
const row: AdminTeamRow = {
  id: TEAM_ID,
  name: 'Dhaka Readers',
  owner: { userId: 'u1', name: 'Rahim Uddin' },
  open: true,
  memberCount: 2,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
};
const detail: AdminTeamDetail = {
  ...row,
  members: [
    {
      userId: 'u1',
      name: 'Rahim Uddin',
      email: 'rahim@example.org',
      joinedAt: '2026-11-01T06:00:00.000Z',
    },
  ],
};
const page = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

test('student.getMyTeam passes on first names only and no extra fields', async () => {
  const extra = {
    ...mine,
    ownerId: 'u1',
    members: mine.members.map((m) => ({ ...m, lastName: 'Uddin', email: 'x@example.org' })),
  };
  const source = createHttpSource(fakeApi({ '/teams/mine': { status: 200, body: extra } }));
  const got = await source.student.getMyTeam();
  assert.deepEqual(got, mine);
  assert.ok(!JSON.stringify(got).includes('Uddin'));
  assert.ok(!JSON.stringify(got).includes('example.org'));
});

test('student.getMyTeam shows the join code to the team lead only', async () => {
  const member = { ...mine, isOwner: false };
  const source = createHttpSource(fakeApi({ '/teams/mine': { status: 200, body: member } }));
  assert.equal((await source.student.getMyTeam())?.joinCode, null);
});

test('student.getMyTeam: not in a team is null', async () => {
  const source = createHttpSource(fakeApi({}));
  assert.equal(await source.student.getMyTeam(), null);
});

test('admin.listTeams sends the search and passes on only the row fields', async () => {
  const extra = { ...row, joinCode: 'TM-7K3Q9P', owner: { ...row.owner, email: 'r@example.org' } };
  const source = createHttpSource(
    fakeApi({
      '/admin/teams?q=dhaka&page=1&pageSize=20': { status: 200, body: page([extra]) },
    }),
  );
  const got = await source.admin.listTeams({ q: 'dhaka', page: 1, pageSize: 20 });
  assert.deepEqual(got, page([row]));
  assert.ok(!JSON.stringify(got).includes('TM-'));
});

test('admin.getTeam passes on the picked members; a malformed id is not sent', async () => {
  const extra = {
    ...detail,
    members: detail.members.map((m) => ({ ...m, phone: '01711111111' })),
  };
  const get = fakeApi({ [`/admin/teams/${TEAM_ID}`]: { status: 200, body: extra } }) as ApiGet & {
    asked: string[];
  };
  const source = createHttpSource(get);
  assert.deepEqual(await source.admin.getTeam(TEAM_ID), detail);
  assert.equal(await source.admin.getTeam('../users'), null);
  assert.deepEqual(get.asked, [`/admin/teams/${TEAM_ID}`]);
});

test('a wrong shape or a refusal is an error (the page shows its error state)', async () => {
  for (const body of [
    { ...mine, memberCount: '2' },
    { ...mine, joinCode: 7 },
    { ...mine, members: [{ firstName: 'Rahim' }] },
  ]) {
    const source = createHttpSource(fakeApi({ '/teams/mine': { status: 200, body } }));
    await assert.rejects(source.student.getMyTeam(), DataRequestError);
  }
  for (const body of [
    page([{ ...row, open: 'yes' }]),
    page([{ ...row, owner: null }]),
    { items: [] },
  ]) {
    const source = createHttpSource(
      fakeApi({ '/admin/teams?page=1&pageSize=20': { status: 200, body } }),
    );
    await assert.rejects(source.admin.listTeams({ page: 1, pageSize: 20 }), DataRequestError);
  }
  const refused = createHttpSource(fakeApi({ '/teams/mine': { status: 403, body: null } }));
  await assert.rejects(refused.student.getMyTeam(), DataRequestError);
});
