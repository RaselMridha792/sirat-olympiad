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
