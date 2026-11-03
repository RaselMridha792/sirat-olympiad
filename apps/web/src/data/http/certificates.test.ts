import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CERTIFICATE_REFUSALS, type AdminCertificateRow, type MyCertificate } from '@sirat/shared';
import { certificatesMessages } from '../../i18n/messages/certificates.ts';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const mine: MyCertificate = {
  id: 'c1',
  type: 'participation',
  round: { id: 'r1', name: 'Round 1' },
  serial: 'SLO-2026-000123',
  verificationCode: '3FA9C1D27B10',
  nameOnCertificate: 'Nusrat Jahan',
  issuedAt: '2026-11-20T06:00:00.000Z',
  revoked: false,
};
const row: AdminCertificateRow = {
  id: 'c1',
  user: { userId: 'u1', name: 'Nusrat Jahan', email: 'n@example.org' },
  type: 'participation',
  round: { id: 'r1', name: 'Round 1' },
  serial: 'SLO-2026-000123',
  nameOnCertificate: 'Nusrat Jahan',
  issuedAt: '2026-11-20T06:00:00.000Z',
  revokedAt: null,
  revokeReason: null,
  updatedAt: '2026-11-20T06:00:00.000Z',
};
const page = <T>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });

test("the student's list passes on only its fields", async () => {
  const extra = {
    ...mine,
    userId: 'u1',
    revokeReason: 'x',
    round: { ...mine.round, type: 'quiz' },
  };
  const source = createHttpSource(
    fakeApi({ '/certificates/mine': { status: 200, body: [extra] } }),
  );
  assert.deepEqual(await source.student.listMyCertificates(), [mine]);
});

test("the admin list sends the filters and passes on only the row's fields", async () => {
  const extra = {
    ...row,
    verificationCode: '3FA9C1D27B10',
    user: { ...row.user, phone: '01711111111' },
  };
  const source = createHttpSource(
    fakeApi({
      '/admin/certificates?q=nusrat&type=participation&page=1&pageSize=20': {
        status: 200,
        body: page([extra]),
      },
    }),
  );
  const got = await source.admin.listCertificates({
    q: 'nusrat',
    type: 'participation',
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(got, page([row]));
  assert.ok(!JSON.stringify(got).includes('3FA9C1D27B10'));
});

test('a wrong shape or a refusal is an error (the page shows its error state)', async () => {
  for (const body of [[{ ...mine, type: 'medal' }], [{ ...mine, revoked: 'no' }], mine])
    await assert.rejects(
      createHttpSource(
        fakeApi({ '/certificates/mine': { status: 200, body } }),
      ).student.listMyCertificates(),
      DataRequestError,
    );
  await assert.rejects(
    createHttpSource(
      fakeApi({
        '/admin/certificates?page=1&pageSize=20': {
          status: 200,
          body: page([{ ...row, revokedAt: 5 }]),
        },
      }),
    ).admin.listCertificates({ page: 1, pageSize: 20 }),
    DataRequestError,
  );
  const refused = createHttpSource(fakeApi({ '/certificates/mine': { status: 403, body: null } }));
  await assert.rejects(refused.student.listMyCertificates(), DataRequestError);
});

test('every certificate refusal has a message in both languages', () => {
  for (const code of [...CERTIFICATE_REFUSALS, 'notFound', 'limit', 'invalid', 'failed'])
    for (const lang of ['en', 'bn'] as const)
      assert.ok(
        (certificatesMessages[lang].errors as Record<string, string>)[code],
        `${lang} ${code}`,
      );
});
