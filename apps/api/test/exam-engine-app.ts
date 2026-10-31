import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Category, Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { CHECKPOINT_MIN_INTERVAL_MS } from '../src/modules/attempts/attempt-store';
import { ExamQueue } from '../src/modules/attempts/exam-queue';
import { ACCESS_COOKIE } from '../src/modules/auth/access-token.service';
import { SessionService } from '../src/modules/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CACHE, REDIS_QUEUE } from '../src/redis/redis.module';
import { examData, makePaidPayment, makeUser } from './helpers';

/*
 * Shared setup for the exam engine's HTTP tests: the real AppModule against the *_test database, a Prisma service that
 * counts its queries (to prove the checkpoint path touches no database), and a short checkpoint interval.
 */

export const HOUR_MS = 60 * 60 * 1000;

/** Records every SQL statement the app's own Prisma client sends. */
class QueryCountingPrisma extends PrismaService {
  readonly statements: string[] = [];
  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] } as never);
    (this as unknown as { $on(e: 'query', cb: (q: { query: string }) => void): void }).$on(
      'query',
      (q) => this.statements.push(q.query),
    );
  }
}

export interface EngineApp {
  app: NestExpressApplication;
  base: string;
  sessions: SessionService;
  redis: Redis;
  appPrisma: QueryCountingPrisma;
  /** This run's own exam queue: a dev stack worker on the same Redis database never takes these jobs. */
  examQueueName: string;
}

export async function bootEngineApp(checkpointIntervalMs: number): Promise<EngineApp> {
  process.env.LOG_LEVEL = 'silent';
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const examQueueName = `exam-test-${randomUUID()}`;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(new QueryCountingPrisma())
    .overrideProvider(CHECKPOINT_MIN_INTERVAL_MS)
    .useValue(checkpointIntervalMs)
    .overrideProvider(ExamQueue)
    .useFactory({
      factory: (redis: Redis) => new ExamQueue(redis, examQueueName),
      inject: [REDIS_QUEUE],
    })
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    base: (await app.getUrl()).replace('[::1]', '127.0.0.1'),
    sessions: app.get(SessionService),
    redis: app.get<Redis>(REDIS_CACHE),
    appPrisma: app.get(PrismaService) as QueryCountingPrisma,
    examQueueName,
  };
}

/** Removes this run's exam queue from Redis, then closes the app. */
export async function closeEngineApp(env: EngineApp | undefined): Promise<void> {
  if (!env) return;
  const queue = new Queue(env.examQueueName, { connection: env.app.get<Redis>(REDIS_QUEUE) });
  await queue.obliterate({ force: true });
  await queue.close();
  await env.app.close();
}

/** A verified student with a paid registration (unless `registered: false`), logged in. */
export async function loginAs(
  env: EngineApp,
  prisma: PrismaClient,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
  { registered = true }: { registered?: boolean } = {},
) {
  const user = await makeUser(prisma, {
    role: 'student',
    emailVerifiedAt: new Date(),
    category: 'activist' satisfies Category,
    ...data,
  });
  if (registered) {
    const payment = await makePaidPayment(prisma, user.id);
    await prisma.registration.create({ data: { userId: user.id, paymentId: payment.id } });
  }
  const issued = await env.sessions.start(
    { id: user.id, role: user.role },
    { ip: '203.0.113.20', userAgent: 'jest' },
  );
  return { id: user.id, cookie: `${ACCESS_COOKIE}=${issued.accessToken}` };
}

export async function call<T = unknown>(
  env: EngineApp,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; json: T; headers: Headers; text: string }> {
  const headers: Record<string, string> = { cookie, 'x-requested-with': 'XMLHttpRequest' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${env.base}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
    text,
  };
}

export interface SeededQuestion {
  id: string;
  text: string;
  correctKey: string;
  options: Array<{ key: string; text: string }>;
}

/**
 * A published exam with `count` questions (window open now unless given), created straight in the database the way
 * the admin API leaves it. Clears the cached published list so GET /exams sees it at once.
 */
export async function seedExam(
  env: EngineApp,
  prisma: PrismaClient,
  opts: {
    count?: number;
    questionsPerAttempt?: number;
    randomDraw?: boolean;
    data?: Partial<Prisma.ExamUncheckedCreateInput>;
    question?: (i: number) => Partial<Prisma.QuestionUncheckedCreateInput>;
  } = {},
) {
  const count = opts.count ?? 3;
  const now = Date.now();
  const exam = await prisma.exam.create({
    data: examData({
      windowStart: new Date(now - HOUR_MS),
      windowEnd: new Date(now + 24 * HOUR_MS),
      questionsPerAttempt: opts.questionsPerAttempt ?? count,
      randomDraw: opts.randomDraw ?? false,
      ...opts.data,
    }),
  });
  const questions: SeededQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const tag = randomUUID().slice(0, 6);
    const options = ['A', 'B', 'C', 'D'].map((key) => ({ key, text: `opt-${tag}-${key}` }));
    const q = await prisma.question.create({
      data: {
        examId: exam.id,
        lineageId: randomUUID(),
        position: i + 1,
        text: `Question ${i + 1} ${tag}`,
        options,
        correctKey: 'C',
        ...opts.question?.(i),
      },
    });
    questions.push({
      id: q.id,
      text: q.text,
      correctKey: q.correctKey,
      options: q.options as SeededQuestion['options'],
    });
  }
  const published = await prisma.exam.update({
    where: { id: exam.id },
    data: { status: opts.data?.status ?? 'published', publishedAt: new Date(now - 2 * HOUR_MS) },
  });
  await env.redis.del('exam:published');
  return { exam: published, questions };
}
