import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLeakCanaries } from '../mock/leak.ts';
import { isRoleBehind, pickOverview } from './ambassador.ts';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const overview = {
  promoCode: 'SR-7K3QXD',
  participantIdMasked: 'ON •••• •••• 558',
  approvedAt: '2026-11-01T04:00:00.000Z',
  referralCount: 2,
  points: 120,
  rank: { current: { name: 'Silver', minPoints: 100 }, next: { name: 'Gold', minPoints: 250 } },
  team: null,
  tasks: [],
  recentReferrals: [
    { name: 'Rahim', institution: 'Dhaka College', createdAt: '2026-11-01T05:00:00.000Z' },
  ],
};
const CANARIES = ['LEAK_CANARY_7Q9Z', 'leak.canary', '98765431', '87654319'];

test("the panel keeps only its own fields: a referred student's email, phone or anything else never passes", () => {
  // Canary fields (score, time, email, phone, correct key, hash) on every object, the referrals included.
  const picked = pickOverview(withLeakCanaries(overview));
  const sent = JSON.stringify(picked);
  for (const canary of CANARIES) assert.equal(sent.includes(canary), false, canary);
  assert.deepEqual(picked, overview);
});

test('student.getAmbassador reads GET /ambassador/me and refuses a wrong shape or a refusal', async () => {
  const ok = createHttpSource(fakeApi({ '/ambassador/me': { status: 200, body: overview } }));
  assert.deepEqual(await ok.student.getAmbassador(), overview);
  for (const [status, body] of [
    [200, { ...overview, points: '120' }],
    [200, { ...overview, recentReferrals: [{ name: 1 }] }],
    // The card only ever shows the masked ID: a full ID (the login secret), even a valid one, is refused, and so is
    // any other shape.
    [200, { ...overview, participantIdMasked: 'ON48210937558' }],
    [200, { ...overview, participantIdMasked: 'ON 4821 0937 558' }],
    [200, { ...overview, participantIdMasked: 'XX •••• •••• 558' }],
    [403, null],
  ] as const) {
    const source = createHttpSource(fakeApi({ '/ambassador/me': { status, body } }));
    await assert.rejects(source.student.getAmbassador(), DataRequestError);
  }
});

test('only a 403 from GET /ambassador/me means the token is behind the role (the panel renews it once)', async () => {
  const refused = async (status: number) =>
    createHttpSource(fakeApi({ '/ambassador/me': { status, body: null } }))
      .student.getAmbassador()
      .catch((error: unknown) => error);
  assert.equal(isRoleBehind(await refused(403)), true);
  for (const status of [404, 429, 500, 503])
    assert.equal(isRoleBehind(await refused(status)), false);
  const wrongShape = await createHttpSource(
    fakeApi({ '/ambassador/me': { status: 200, body: { ...overview, points: 'x' } } }),
  )
    .student.getAmbassador()
    .catch((error: unknown) => error);
  assert.equal(isRoleBehind(wrongShape), false);
  assert.equal(isRoleBehind(new Error('x')), false);
});

test('admin.listAmbassadors passes on only the row fields', async () => {
  const row = {
    userId: 'u1',
    name: 'Amb One',
    email: 'amb@test.invalid',
    promoCode: 'SR-7K3QXD',
    approvedAt: null,
    createdAt: '2026-11-01T04:00:00.000Z',
    referralCount: 3,
    points: 0,
    rankName: null,
    demo: true,
  };
  const source = createHttpSource(
    fakeApi({
      '/admin/ambassadors?page=1&pageSize=20&q=SR-7K3QXD': {
        status: 200,
        body: { items: [{ ...row, passwordHash: 'canary' }], page: 1, pageSize: 20, total: 1 },
      },
    }),
  );
  const page = await source.admin.listAmbassadors({ page: 1, pageSize: 20, q: 'SR-7K3QXD' });
  assert.deepEqual(page.items, [row]);
});

test('admin.getAmbassadorPoints reads GET /admin/ambassador-points and passes on only the named fields', async () => {
  const config = {
    pointsPerReferral: 10,
    thresholds: [
      { name: 'Bronze', minPoints: 0 },
      { name: 'Silver', minPoints: 100 },
    ],
  };
  const extra = {
    ...config,
    updatedBy: 'admin@example.com',
    thresholds: config.thresholds.map((t) => ({ ...t, id: 'x' })),
  };
  const ok = createHttpSource(
    fakeApi({ '/admin/ambassador-points': { status: 200, body: extra } }),
  );
  assert.deepEqual(await ok.admin.getAmbassadorPoints(), config);
  for (const body of [
    { ...config, pointsPerReferral: '10' },
    { ...config, thresholds: [{ name: 'Bronze' }] },
    { pointsPerReferral: 10 },
  ]) {
    const source = createHttpSource(fakeApi({ '/admin/ambassador-points': { status: 200, body } }));
    await assert.rejects(source.admin.getAmbassadorPoints(), DataRequestError);
  }
});

const board = {
  items: [
    {
      rank: 1,
      name: 'Amb One',
      institution: 'Dhaka School',
      points: 130,
      tier: 'Silver',
      isMe: false,
    },
    { rank: 2, name: 'Amb Two', institution: null, points: 90, tier: 'Bronze', isMe: true },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  me: { rank: 2, points: 90 },
  asOf: '2026-11-10T06:00:00.000Z',
};

test('student.getAmbassadorLeaderboard sends the page and passes on only the named fields', async () => {
  const extra = {
    ...board,
    items: board.items.map((r) => ({ ...r, userId: 'u1', email: 'amb@test.invalid' })),
    me: { ...board.me, userId: 'u2' },
  };
  const source = createHttpSource(
    fakeApi({ '/ambassador/leaderboard?page=1&pageSize=20': { status: 200, body: extra } }),
  );
  const got = await source.student.getAmbassadorLeaderboard({ page: 1, pageSize: 20 });
  assert.deepEqual(got, board);
  assert.ok(!JSON.stringify(got).includes('@') && !JSON.stringify(got).includes('userId'));
});

test('student.getAmbassadorLeaderboard refuses a wrong shape or a refusal', async () => {
  for (const body of [
    { ...board, items: [{ ...board.items[0], isMe: 'no' }] },
    { ...board, items: [{ ...board.items[0], rank: '1' }] },
    { ...board, me: { rank: 2 } },
    { ...board, asOf: undefined },
  ]) {
    const source = createHttpSource(
      fakeApi({ '/ambassador/leaderboard?page=1&pageSize=20': { status: 200, body } }),
    );
    await assert.rejects(
      source.student.getAmbassadorLeaderboard({ page: 1, pageSize: 20 }),
      DataRequestError,
    );
  }
  const refused = createHttpSource(
    fakeApi({ '/ambassador/leaderboard?page=1&pageSize=20': { status: 403, body: null } }),
  );
  await assert.rejects(
    refused.student.getAmbassadorLeaderboard({ page: 1, pageSize: 20 }),
    DataRequestError,
  );
});

test('admin.listAmbassadors sends sort=points only for the points order', async () => {
  const empty = { items: [], page: 1, pageSize: 20, total: 0 };
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    return { status: 200, body: empty };
  }) as ApiGet;
  const source = createHttpSource(get);
  await source.admin.listAmbassadors({ page: 1, pageSize: 20, sort: 'points' });
  await source.admin.listAmbassadors({ page: 1, pageSize: 20 });
  assert.deepEqual(asked, [
    '/admin/ambassadors?page=1&pageSize=20&sort=points',
    '/admin/ambassadors?page=1&pageSize=20',
  ]);
});
