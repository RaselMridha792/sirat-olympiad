import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Prisma, PrismaClient, Role } from '@prisma/client';
import { seedConfig } from '../prisma/seed';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import {
  applyReferenceData,
  makePaidPayment,
  makeUser,
  testPhone,
  testPrisma,
  truncateAll,
} from './helpers';

/* Shared setup for the free book's HTTP tests (plan 16.6): the real AppModule against the *_test database. */

export interface BookApp {
  app: NestExpressApplication;
  base: string;
  prisma: PrismaClient;
  sessions: SessionService;
  close(): Promise<void>;
}

export async function bootBookApp(): Promise<BookApp> {
  process.env.LOG_LEVEL = 'silent';
  const prisma = testPrisma();
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    app,
    base,
    prisma,
    sessions: app.get(SessionService),
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** A session cookie for a new user with this role. */
export async function loginAs(
  env: BookApp,
  role: Role,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
): Promise<{ id: string; cookie: string }> {
  const user = await makeUser(env.prisma, { role, ...data });
  const issued = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.8', userAgent: 'jest' },
  );
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

/** A student with a paid payment and its registration (what settling a payment makes). */
export async function paidStudent(
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const user = await makeUser(prisma, { role: 'student', phone: testPhone(), ...data });
  const payment = await makePaidPayment(prisma, user.id);
  const registration = await prisma.registration.create({
    data: { userId: user.id, paymentId: payment.id },
  });
  return { user, registration };
}

/** A logged-in student with a paid registration. */
export async function paidStudentSession(
  env: BookApp,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const { user, registration } = await paidStudent(env.prisma, data);
  const issued = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.9', userAgent: 'jest' },
  );
  return { user, registration, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

export const ADDRESS = {
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  district: 'Dhaka',
  upazila: 'Mirpur',
  addressLine: 'House 12, Road 3, Block C',
  note: 'Call before coming',
};

export function caller(base: string) {
  return (
    method: string,
    path: string,
    opts: { body?: unknown; cookie?: string; csrf?: boolean; form?: FormData } = {},
  ) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(opts.form ? {} : { 'content-type': 'application/json' }),
        ...(opts.csrf === false ? {} : { 'x-requested-with': 'XMLHttpRequest' }),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
}
