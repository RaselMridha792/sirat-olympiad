/**
 * Dev fixtures on the payment rules (docs/plans/PAYMENTS-PLAN.md section 4.4). A2's web-session CI page check and
 * its e2e log in as student1@fixtures.invalid with its fixed participant ID, so the login path is checked here over
 * HTTP, not only the rows.
 * --clean removes only the fixture students' payments and registrations; a reload completes them again.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { isParticipantId } from '@sirat/shared';
import { seedConfig } from '../prisma/seed';
import {
  FIXTURE_PARTICIPANT_IDS,
  FIXTURE_STUDENTS,
  cleanFixturePayments,
  loadDevFixtures,
} from '../prisma/fixtures/dev-fixtures';
import { applyReferenceData, makePaidPayment, makeUser, testPrisma, truncateAll } from './helpers';

const prisma: PrismaClient = testPrisma();

const fixtureState = () =>
  prisma.user.findMany({
    where: { email: { endsWith: '@fixtures.invalid' } },
    orderBy: { email: 'asc' },
    select: {
      email: true,
      phone: true,
      passwordHash: true,
      registration: {
        select: {
          participantId: true,
          payment: { select: { status: true, amountMinor: true } },
        },
      },
      registrationAttempt: { select: { status: true } },
    },
  });

beforeAll(async () => {
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('dev fixtures', () => {
  it('creates three students, each with a paid 400 BDT registration, a completed attempt and its own phone', async () => {
    expect(await loadDevFixtures(prisma)).toEqual({
      created: 3,
      completed: 0,
      skipped: 0,
    });
    const users = await fixtureState();
    expect(users.map((u) => u.email)).toEqual(
      FIXTURE_STUDENTS.map((s) => `student${s.n}@fixtures.invalid`),
    );
    expect(new Set(users.map((u) => u.phone)).size).toBe(3);
    for (const u of users) {
      expect(u.registration?.payment).toEqual({ status: 'paid', amountMinor: 40000 });
      expect(u.registrationAttempt?.status).toBe('completed');
      expect(u.passwordHash).toBeNull(); // students have none (participant-ID login)
    }
    // The fixed IDs RUNBOOK section 0 and the page checks name: valid, one per student.
    expect(users.map((u) => u.registration?.participantId)).toEqual(FIXTURE_PARTICIPANT_IDS);
    expect(FIXTURE_PARTICIPANT_IDS).toEqual(['ON99999999012', 'ON99999999020', 'ON99999999036']);
    expect(FIXTURE_PARTICIPANT_IDS.every(isParticipantId)).toBe(true);
  });

  it('is idempotent: a second run creates nothing', async () => {
    expect(await loadDevFixtures(prisma)).toEqual({
      created: 0,
      completed: 0,
      skipped: 3,
    });
  });

  it('--clean removes only the fixture payments and registrations; a reload completes them again', async () => {
    const other = await makeUser(prisma);
    const othersPayment = await makePaidPayment(prisma, other.id);
    await prisma.registration.create({ data: { userId: other.id, paymentId: othersPayment.id } });

    expect(await cleanFixturePayments(prisma)).toEqual({
      registrations: 3,
      payments: 3,
      attempts: 3,
    });
    const cleaned = await fixtureState();
    expect(cleaned).toHaveLength(3); // users stay
    expect(cleaned.every((u) => u.registration === null && u.registrationAttempt === null)).toBe(
      true,
    );
    expect(await prisma.registration.count({ where: { userId: other.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { id: othersPayment.id } })).toBe(1);

    expect(await loadDevFixtures(prisma)).toEqual({
      created: 0,
      completed: 3,
      skipped: 0,
    });
    for (const u of await fixtureState()) expect(u.registration?.payment.status).toBe('paid');
  });

  it('a fixture student logs in over HTTP (the path the dashboard page check uses)', async () => {
    process.env.LOG_LEVEL = 'silent';
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/configure-app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    try {
      const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
          'x-forwarded-for': '2001:db8:f1x::1',
        },
        // Typed the way the admit card prints it: the login normalizes spaces and case.
        body: JSON.stringify({
          email: 'student1@fixtures.invalid',
          participantId: 'on 9999 9999 012',
        }),
      });
      expect(res.status).toBe(204);
    } finally {
      await app.close();
    }
  }, 60_000);
});
