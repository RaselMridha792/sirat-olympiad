import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { makePaidPayment, makeUser } from './helpers';

/*
 * Shared setup for the core session's HTTP tests (docs/plans/CORE-PLAN.md): the real AppModule against the *_test
 * database, with a Prisma service that records its statements (batch and N+1 checks).
 */

/** Records every SQL statement the app's own Prisma client sends. */
export class QueryCountingPrisma extends PrismaService {
  readonly statements: string[] = [];
  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] } as never);
    (this as unknown as { $on(e: 'query', cb: (q: { query: string }) => void): void }).$on(
      'query',
      (q) => this.statements.push(q.query),
    );
  }
}

export interface CoreApp {
  app: NestExpressApplication;
  base: string;
  sessions: SessionService;
  appPrisma: QueryCountingPrisma;
}

export async function bootCoreApp(): Promise<CoreApp> {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(new QueryCountingPrisma())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    base: (await app.getUrl()).replace('[::1]', '127.0.0.1'),
    sessions: app.get(SessionService),
    appPrisma: app.get(PrismaService) as QueryCountingPrisma,
  };
}

const client = { ip: '203.0.113.21', userAgent: 'jest' };

/** A session cookie for a new user with these fields. */
export async function sessionFor(
  env: CoreApp,
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
): Promise<{ id: string; cookie: string }> {
  const user = await makeUser(prisma, data);
  const issued = await env.sessions.start({ id: user.id, role: user.role }, client);
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

/** A student with a paid registration (the legal order: paid payment first, then the registration). */
export async function registeredStudent(
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const user = await makeUser(prisma, { role: 'student', ...data });
  const payment = await makePaidPayment(prisma, user.id);
  const registration = await prisma.registration.create({
    data: { userId: user.id, paymentId: payment.id },
  });
  return { user, payment, registration };
}

/** A short random marker: tests search by it, so rows of other suites in the shared test database never count. */
export const marker = (): string => `Mk${randomUUID().replace(/-/g, '').slice(0, 10)}`;

export interface CallResult<T> {
  status: number;
  json: T;
  text: string;
  headers: Headers;
}

/** One HTTP call with the CSRF header and a session cookie. */
export async function call<T = unknown>(
  env: CoreApp,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { cookie, 'x-requested-with': 'XMLHttpRequest' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${env.base}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null; // a CSV
  }
  return { status: res.status, json: json as T, text, headers: res.headers };
}
