import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminAuditRow } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

const ID = '019a3b4c-5d6e-7f80-9123-456789abcdef';

function recordingApi(answers: Record<string, ApiResult>): { get: ApiGet; paths: string[] } {
  const paths: string[] = [];
  const get = (async (path: string) => {
    paths.push(path);
    return answers[path] ?? { status: 404, body: null };
  }) as ApiGet;
  return { get, paths };
}

const row: AdminAuditRow = {
  id: ID,
  createdAt: '2026-11-01T06:00:00.000Z',
  action: 'users.exported',
  system: false,
  actor: { name: 'Admin One', role: 'admin' },
  entityType: 'user',
  entityId: null,
};

test('admin.listAudit sends the filters and drops any IP, email or meta from the rows', async () => {
  const leaky = {
    ...row,
    ip: '203.0.113.9',
    actorEmail: 'admin@example.com',
    meta: { email: 'x@y.co' },
  };
  const path = '/admin/audit?action=auth.*&actor=system&from=2026-10-01&to=2026-10-31&before=abc_1';
  const { get, paths } = recordingApi({
    [path]: { status: 200, body: { items: [leaky], next: 'next_cursor', extra: 1 } },
  });
  const page = await createHttpSource(get).admin.listAudit({
    action: 'auth.*',
    actor: 'system',
    from: '2026-10-01',
    to: '2026-10-31',
    before: 'abc_1',
  });
  assert.deepEqual(paths, [path]);
  assert.deepEqual(page, { items: [row], next: 'next_cursor' });
  for (const needle of ['203.0.113.9', 'example.com', 'x@y.co', 'meta', 'extra'])
    assert.ok(!JSON.stringify(page).includes(needle), needle);
});

test('admin.listAudit refuses a wrong shape or a refusal', async () => {
  for (const body of [
    { items: [{ ...row, system: 'no' }], next: null },
    { items: [{ ...row, actor: { name: 'X', role: 'owner' } }], next: null },
    { items: [row], next: 3 },
    { items: 'none', next: null },
  ]) {
    const { get } = recordingApi({ '/admin/audit': { status: 200, body } });
    await assert.rejects(createHttpSource(get).admin.listAudit({}), DataRequestError);
  }
  const { get } = recordingApi({ '/admin/audit': { status: 403, body: null } });
  await assert.rejects(createHttpSource(get).admin.listAudit({}), DataRequestError);
});

test('admin.getAuditEntry keeps the IP, the email and the meta; an unknown or malformed id is not found', async () => {
  const detail = {
    ...row,
    ip: '203.0.113.9',
    actorEmail: 'admin@example.com',
    meta: { rowCount: 12 },
  };
  const { get, paths } = recordingApi({
    [`/admin/audit/${ID}`]: { status: 200, body: { ...detail, more: 1 } },
  });
  const source = createHttpSource(get);
  assert.deepEqual(await source.admin.getAuditEntry(ID), detail);
  assert.equal(await source.admin.getAuditEntry('not-a-uuid'), null);
  assert.equal(await source.admin.getAuditEntry('019a3b4c-5d6e-7f80-9123-000000000000'), null);
  // The malformed id never reached the API.
  assert.deepEqual(paths, [
    `/admin/audit/${ID}`,
    '/admin/audit/019a3b4c-5d6e-7f80-9123-000000000000',
  ]);
});
