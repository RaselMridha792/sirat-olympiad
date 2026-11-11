import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dammDigit, type AdminDemoStatus } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const ID = `ON0123456789${dammDigit('0123456789')}`;
const loaded: AdminDemoStatus = {
  allowed: true,
  batch: {
    id: '0196d3c0-0000-7000-8000-000000000001',
    status: 'loaded',
    createdAt: '2026-11-09T06:00:00.000Z',
    createdByName: 'Ops Admin',
    counts: { students: 300, ambassadors: 15, jury: 2, attempts: 271 },
    stale: false,
    logins: [
      {
        role: 'student',
        email: 'student-001@demo.sirat.invalid',
        name: 'Demo A',
        participantId: ID,
      },
      { role: 'jury', email: 'jury-001@demo.sirat.invalid', name: 'Demo J', participantId: null },
    ],
    unregisteredStudents: 54,
  },
  progress: null,
  lastOutcome: {
    action: 'clear',
    result: 'blocked',
    at: '2026-11-09T07:00:00.000Z',
    blockers: { real_users_referred_by_demo: 1 },
  },
};

test('admin.getDemoStatus reads GET /admin/demo and passes on only the named fields', async () => {
  const extra = {
    ...loaded,
    passwordHash: '$argon2id$v=19$secret',
    batch: {
      ...loaded.batch,
      reason: 'client demo',
      createdById: 'u1',
      logins: loaded.batch!.logins.map((l) => ({ ...l, passwordHash: '$argon2id$v=19$login' })),
    },
    lastOutcome: { ...loaded.lastOutcome, stack: 'Error: at x' },
  };
  const got = await createHttpSource(
    fakeApi({ '/admin/demo': { status: 200, body: extra } }),
  ).admin.getDemoStatus();
  assert.deepEqual(got, loaded);
  for (const needle of ['argon2id', 'client demo', 'u1', 'Error: at'])
    assert.ok(!JSON.stringify(got).includes(needle), needle);
});

test('admin.getDemoStatus: no batch, and a running job', async () => {
  const none: AdminDemoStatus = { allowed: false, batch: null, progress: null, lastOutcome: null };
  assert.deepEqual(
    await createHttpSource(
      fakeApi({ '/admin/demo': { status: 200, body: none } }),
    ).admin.getDemoStatus(),
    none,
  );
  const running: AdminDemoStatus = {
    ...loaded,
    batch: { ...loaded.batch!, status: 'loading', counts: {}, logins: [], unregisteredStudents: 0 },
    progress: { action: 'load', step: 'attempts' },
    lastOutcome: null,
  };
  assert.deepEqual(
    await createHttpSource(
      fakeApi({ '/admin/demo': { status: 200, body: running } }),
    ).admin.getDemoStatus(),
    running,
  );
});

test('admin.getDemoStatus refuses a wrong shape or a refusal (the card shows its error state)', async () => {
  const wrong: unknown[] = [
    { ...loaded, allowed: 'yes' },
    { ...loaded, batch: { ...loaded.batch, status: 'deleted' } },
    { ...loaded, batch: { ...loaded.batch, counts: { students: '300' } } },
    { ...loaded, batch: { ...loaded.batch, stale: 'no' } },
    { ...loaded, batch: { ...loaded.batch, logins: undefined } },
    { ...loaded, batch: { ...loaded.batch, unregisteredStudents: -1 } },
    // A student without a valid participant ID, or a jury account with one, is not a demo login.
    {
      ...loaded,
      batch: { ...loaded.batch, logins: [{ ...loaded.batch!.logins[0], participantId: null }] },
    },
    {
      ...loaded,
      batch: {
        ...loaded.batch,
        logins: [{ ...loaded.batch!.logins[0], participantId: 'ON0123456789' }],
      },
    },
    {
      ...loaded,
      batch: { ...loaded.batch, logins: [{ ...loaded.batch!.logins[1], participantId: ID }] },
    },
    {
      ...loaded,
      batch: { ...loaded.batch, logins: [{ ...loaded.batch!.logins[0], role: 'admin' }] },
    },
    { ...loaded, progress: { action: 'wipe', step: 'x' } },
    { ...loaded, lastOutcome: { ...loaded.lastOutcome, result: 'maybe' } },
    { ...loaded, lastOutcome: { ...loaded.lastOutcome, blockers: { x: -1 } } },
    null,
  ];
  for (const body of wrong)
    await assert.rejects(
      createHttpSource(fakeApi({ '/admin/demo': { status: 200, body } })).admin.getDemoStatus(),
      DataRequestError,
    );
  await assert.rejects(
    createHttpSource(fakeApi({ '/admin/demo': { status: 403, body: null } })).admin.getDemoStatus(),
    DataRequestError,
  );
});
