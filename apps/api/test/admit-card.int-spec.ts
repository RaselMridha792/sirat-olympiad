/**
 * The admit card (core A1; 06-API "Admit card"; the lead's approval of 2026-11-11): GET /admit-card answers the
 * caller's own paid registration with the full participant ID (the login secret: this page only, never cached) and
 * its masked form for the share image, the mode from the ID's prefix, the name, category and class, the fee, and
 * exam's next round exam. Never another student's ID; 404 not_registered without a paid registration; students and
 * ambassadors only.
 */
import type { PrismaClient } from '@prisma/client';
import { formatParticipantId, maskParticipantId, type AdmitCard } from '@sirat/shared';
import { randomUUID } from 'node:crypto';
import { bootCoreApp, call, registeredStudent, sessionFor, type CoreApp } from './core-helpers';
import { makePublishedExam } from './exam-helpers';
import {
  applyReferenceData,
  makeRegistrationAttempt,
  makeUser,
  paymentData,
  testPrisma,
} from './helpers';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let env: CoreApp;
let prisma: PrismaClient;
let round1: { id: string };

beforeAll(async () => {
  env = await bootCoreApp();
  prisma = testPrisma();
  if (!(await prisma.round.findUnique({ where: { sortOrder: 1 } })))
    await applyReferenceData(prisma);
  round1 = await prisma.round.findUniqueOrThrow({ where: { sortOrder: 1 }, select: { id: true } });
}, 60_000);

afterAll(async () => {
  await env?.app.close();
  await prisma?.$disconnect();
});

const details = (json: unknown) => (json as { details?: string[] }).details;
const card = (cookie: string) => call<AdmitCard>(env, 'GET', '/admit-card', cookie);

/** A paid, registered student with a session. */
async function registered(data: Parameters<typeof registeredStudent>[1] = {}) {
  const { user, registration, payment } = await registeredStudent(prisma, data);
  const s = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.61', userAgent: 'jest' },
  );
  return { user, registration, payment, cookie: `sirat_access=${s.accessToken}` };
}

describe('the admit card', () => {
  it("answers the caller's own registration: the full ID, its masked form, mode, name, class, fee; never cached", async () => {
    const grade = await prisma.gradeLevel.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } });
    const me = await registered({
      name: 'Admit Card Student',
      category: grade.category,
      gradeLevelId: grade.id,
    });
    const other = await registered({ name: 'Another Student' });
    const res = await card(me.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.json).toMatchObject({
      participantId: me.registration.participantId,
      participantIdMasked: maskParticipantId(me.registration.participantId),
      mode: me.registration.participantId.startsWith('OF') ? 'offline' : 'online',
      name: 'Admit Card Student',
      category: grade.category,
      gradeLevel: grade.label,
      fee: { amountMinor: me.payment.amountMinor, currency: me.payment.currency },
      registeredAt: me.registration.createdAt.toISOString(),
    });
    expect(Object.keys(res.json).sort()).toEqual(
      [
        'category',
        'exam',
        'fee',
        'gradeLevel',
        'mode',
        'name',
        'participantId',
        'participantIdMasked',
        'registeredAt',
      ].sort(),
    );
    // Never another student's ID, in any form; no email or phone.
    expect(res.text).not.toContain(other.registration.participantId);
    expect(res.text).not.toContain(formatParticipantId(other.registration.participantId));
    expect(res.text).not.toContain(me.user.email);
  });

  it('shows the amount actually paid for a discounted registration, not the list price (a review by payments)', async () => {
    const admin = await makeUser(prisma, { role: 'admin' });
    const code = await prisma.discountCode.create({
      data: {
        code: `AC${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
        kind: 'amount',
        value: 5000,
        createdById: admin.id,
      },
    });
    const user = await makeUser(prisma, { role: 'student', name: 'Discounted Student' });
    const attempt = await makeRegistrationAttempt(prisma);
    const created = await prisma.payment.create({
      data: paymentData(attempt.id, {
        userId: user.id,
        listAmountMinor: 40000,
        discountMinor: 5000,
        amountMinor: 35000,
        discountCodeId: code.id,
      }),
    });
    await prisma.payment.update({ where: { id: created.id }, data: { status: 'pending' } });
    const payment = await prisma.payment.update({
      where: { id: created.id },
      data: {
        status: 'paid',
        trxId: `TRX${randomUUID().slice(0, 8)}`,
        paidAmountMinor: 35000,
        paidAt: new Date(),
      },
    });
    await prisma.registration.create({ data: { userId: user.id, paymentId: payment.id } });
    const s = await env.sessions.start(
      { id: user.id, role: user.role },
      { ip: '203.0.113.61', userAgent: 'jest' },
    );
    const res = await card(`sirat_access=${s.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.json.fee).toEqual({
      amountMinor: 35000,
      currency: 'BDT',
      paidAt: payment.paidAt?.toISOString(),
    });
  });

  it("names exam's next round exam, or null while none is published", async () => {
    const me = await registered();
    await prisma.$executeRaw`
      UPDATE "exams" SET "status" = 'archived'
      WHERE "round_id" IS NOT NULL AND "status"::text = 'published' AND "demo_batch_id" IS NULL`;
    expect((await card(me.cookie)).json.exam).toBeNull();
    const start = new Date(Date.now() + 2 * DAY_MS);
    const exam = await makePublishedExam(prisma, {
      roundId: round1.id,
      title: 'Round 1 exam',
      windowStart: start,
      windowEnd: new Date(start.getTime() + 2 * HOUR_MS),
    });
    try {
      const next = (await card(me.cookie)).json.exam;
      expect(next).toMatchObject({
        examId: exam.id,
        title: 'Round 1 exam',
        windowStart: start.toISOString(),
      });
    } finally {
      await prisma.exam.update({ where: { id: exam.id }, data: { status: 'archived' } });
    }
  });

  it('is refused without a paid registration (404 not_registered), and to anyone but students and ambassadors', async () => {
    const unpaid = await sessionFor(env, prisma, { role: 'student' });
    const res = await card(unpaid.cookie);
    expect(res.status).toBe(404);
    expect(details(res.json)).toEqual(['not_registered']);
    expect((await card('')).status).toBe(401);
    for (const role of ['admin', 'manager', 'jury'] as const)
      expect((await card((await sessionFor(env, prisma, { role })).cookie)).status).toBe(403);
    // A token minted before a block: the account is re-read.
    const blocked = await registered();
    await prisma.user.update({ where: { id: blocked.user.id }, data: { isBlocked: true } });
    expect([401, 403]).toContain((await card(blocked.cookie)).status);
  });
});
