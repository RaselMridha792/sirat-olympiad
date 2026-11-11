import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dammDigit, maskParticipantId, type AdmitCard } from '@sirat/shared';
import { createHttpSource } from './index.ts';
import { DataRequestError, type ApiGet, type ApiResult } from './request.ts';

function fakeApi(answers: Record<string, ApiResult>): ApiGet {
  return (async (path: string) => answers[path] ?? { status: 404, body: null }) as ApiGet;
}

const ID = `ON4821093755${dammDigit('4821093755')}`;
const OTHER = `ON1111111111${dammDigit('1111111111')}`;
const card: AdmitCard = {
  participantId: ID,
  participantIdMasked: maskParticipantId(ID),
  mode: 'online',
  name: 'Nusrat Jahan',
  category: 'activist',
  gradeLevel: 'Class 8',
  fee: { amountMinor: 40000, currency: 'BDT', paidAt: '2026-11-10T06:00:00.000Z' },
  registeredAt: '2026-11-10T06:00:00.000Z',
  exam: {
    examId: 'e1',
    title: 'Round 1',
    windowStart: '2027-03-19T04:00:00.000Z',
    windowEnd: '2027-03-19T06:00:00.000Z',
    durationMinutes: 60,
    roundName: 'Round 1',
  },
};

test('student.getAdmitCard reads GET /admit-card and passes on only the named fields', async () => {
  const extra = { ...card, email: 'n@example.org', phone: '01711111111', userId: 'u1' };
  const source = createHttpSource(fakeApi({ '/admit-card': { status: 200, body: extra } }));
  const got = await source.student.getAdmitCard();
  assert.deepEqual(got, card);
  assert.ok(!JSON.stringify(got).includes('example.org'));
});

test('student.getAdmitCard: no paid registration (404) is null; a refusal is an error', async () => {
  const none = createHttpSource(
    fakeApi({ '/admit-card': { status: 404, body: { details: ['not_registered'] } } }),
  );
  assert.equal(await none.student.getAdmitCard(), null);
  const refused = createHttpSource(fakeApi({ '/admit-card': { status: 403, body: null } }));
  await assert.rejects(refused.student.getAdmitCard(), DataRequestError);
});

test('the masked ID must be the mask of the card own ID: the share image can carry nothing else', async () => {
  for (const body of [
    // The full ID where the masked one belongs.
    { ...card, participantIdMasked: ID },
    // Another student's masked ID.
    { ...card, participantIdMasked: maskParticipantId(OTHER) },
    // An invalid ID (wrong check digit).
    { ...card, participantId: `${ID.slice(0, 12)}${(Number(ID.slice(12)) + 1) % 10}` },
    { ...card, mode: 'remote' },
    { ...card, exam: { ...card.exam, durationMinutes: '60' } },
  ]) {
    const source = createHttpSource(fakeApi({ '/admit-card': { status: 200, body } }));
    await assert.rejects(source.student.getAdmitCard(), DataRequestError);
  }
});
