import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminStats } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const stats: AdminStats = {
  asOf: '2026-11-01T06:00:00.000Z',
  totals: {
    registered: 12,
    paid: 12,
    pendingPayments: 3,
    activeAttempts: 0,
    submittedAttempts: 0,
    secondRound: null,
    finalists: null,
  },
  registrationsDaily: [
    { date: '2026-10-31', count: 5 },
    { date: '2026-11-01', count: 7 },
  ],
  byCategory: [
    { category: 'activist', count: 4 },
    { category: 'ambassador', count: 3 },
    { category: 'achiever', count: 5 },
  ],
  registrationAttempts: { open: 2, completed: 12, abandoned: 1, conflict: 0 },
  paymentsByStatus: { initiated: 1, pending: 2, paid: 12, failed: 1, expired: 0 },
  paymentsNeedingReview: 1,
  ambassadors: { approved: 2, revoked: 1, referredStudents: 4 },
};

test('admin.getStats reads GET /admin/stats and passes on only the named counts', async () => {
  // Fields the page must never carry, at every level.
  const extra = {
    ...stats,
    emails: ['x@example.com'],
    totals: { ...stats.totals, revenueMinor: 480000 },
    byCategory: stats.byCategory.map((c) => ({ ...c, names: ['Rahim'] })),
    registrationsDaily: stats.registrationsDaily.map((d) => ({ ...d, ids: ['u1'] })),
    paymentsByStatus: { ...stats.paymentsByStatus, refunded: 0 },
    ambassadors: { ...stats.ambassadors, topCode: 'SR-7K3QXD' },
  };
  const got = await createHttpSource(
    fakeApi({ '/admin/stats': { status: 200, body: extra } }),
  ).admin.getStats();
  assert.deepEqual(got, stats);
  for (const needle of ['example.com', 'revenueMinor', 'Rahim', 'u1', 'refunded', 'SR-7K3QXD'])
    assert.ok(!JSON.stringify(got).includes(needle), needle);
});

test('admin.getStats refuses a wrong shape or a refusal (the page shows its error state)', async () => {
  const wrong: unknown[] = [
    { ...stats, totals: { ...stats.totals, paid: '12' } },
    { ...stats, totals: { ...stats.totals, secondRound: undefined } },
    { ...stats, registrationsDaily: [{ date: '1 Nov', count: 1 }] },
    { ...stats, byCategory: [{ category: 'other', count: 1 }] },
    { ...stats, registrationAttempts: { open: 1 } },
    { ...stats, paymentsByStatus: { ...stats.paymentsByStatus, failed: -1 } },
    { ...stats, ambassadors: { approved: 1, revoked: 0 } },
  ];
  for (const body of wrong) {
    const source = createHttpSource(fakeApi({ '/admin/stats': { status: 200, body } }));
    await assert.rejects(source.admin.getStats(), DataRequestError);
  }
  for (const status of [403, 500]) {
    const source = createHttpSource(fakeApi({ '/admin/stats': { status, body: null } }));
    await assert.rejects(source.admin.getStats(), DataRequestError);
  }
});
