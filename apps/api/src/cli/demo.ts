/**
 * Demo data from the server shell (DECISIONS 2026-11-08 "Demo data"): the same load and removal as the admin card,
 * without the queue, for the VPS before launch.
 *
 *   VPS:   docker compose -p sirat --env-file .env -f infra/docker-compose.yml exec -T api \
 *            node dist/cli/demo.js load --reason "client demo"
 *          ... node dist/cli/demo.js clear --reason "before launch"
 *   Local: pnpm --filter @sirat/api demo:load --reason "try the dashboards"
 *          pnpm --filter @sirat/api demo:clear --reason "done"
 *
 * Load needs DEMO_DATA_ALLOWED=true; removal works whatever it says, so demo data never outlives the switch. Prints
 * the batch, the counts and, after a load, the demo logins' one password (shown once, stored only as a hash). Exit 0
 * when done (also "no demo data" for a removal); 1 when refused or failed; 2 for bad arguments or settings.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DEMO_EMAIL_DOMAIN, DEMO_REASON_LIMITS } from '@sirat/shared';
import Redis from 'ioredis';
import { BackgroundTasks } from '../common/background/background-tasks';
import { AlertEmailLimiter } from '../modules/audit/alert-email-limiter';
import { AuditService } from '../modules/audit/audit.service';
import { SecurityAlerts } from '../modules/audit/security-alerts.service';
import { PasswordService } from '../modules/auth/password.service';
import {
  beginDemoClear,
  beginDemoLoad,
  DemoRefusalError,
  type DemoRequest,
  isSecondBatch,
} from '../modules/demo/demo-batches';
import { DemoClearBlocked, DemoClearBusy, DemoRunner } from '../modules/demo/demo-runner';
import { paymentsAllowDemo } from '../modules/payments/demo/allow-demo';
import {
  buildPaymentConfig,
  type PaymentConfig,
  type PaymentEnv,
} from '../modules/payments/payment.config';
import { EmailQueue } from '../modules/notifications/email-queue.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CACHE_REDIS_OPTIONS, QUEUE_REDIS_OPTIONS } from '../redis/redis.module';
import { opsEnv, type OpsEnv } from './ops-env';

const USAGE = 'Usage: demo <load|clear> --reason "<why, 3 to 200 characters>"';

export class DemoCliUsageError extends Error {}

export interface DemoArgs {
  action: 'load' | 'clear';
  reason: string;
}

export function parseDemoArgs(argv: readonly string[]): DemoArgs {
  const [action, ...rest] = argv;
  if (action !== 'load' && action !== 'clear') throw new DemoCliUsageError(USAGE);
  let reason: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--reason' && i + 1 < rest.length) reason = rest[++i];
    else throw new DemoCliUsageError(USAGE); // never echoes the stray value
  }
  const clean = (reason ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < DEMO_REASON_LIMITS.min || clean.length > DEMO_REASON_LIMITS.max)
    throw new DemoCliUsageError(USAGE);
  return { action, reason: clean };
}

/** PayStation's settings, as the API builds them (payment.config.ts), for payments' guard. */
function paymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  const timeout = env.PAYSTATION_TIMEOUT_MS ? Number(env.PAYSTATION_TIMEOUT_MS) : 10_000;
  return buildPaymentConfig({
    NODE_ENV: env.NODE_ENV ?? 'development',
    PAYSTATION_ENV: env.PAYSTATION_ENV || undefined,
    PAYSTATION_BASE_URL: env.PAYSTATION_BASE_URL || undefined,
    PAYSTATION_MERCHANT_ID: env.PAYSTATION_MERCHANT_ID || undefined,
    PAYSTATION_PASSWORD: env.PAYSTATION_PASSWORD || undefined,
    PAYSTATION_ACCOUNT_LABEL: env.PAYSTATION_ACCOUNT_LABEL || undefined,
    PAYSTATION_INVOICE_PREFIX: env.PAYSTATION_INVOICE_PREFIX || undefined,
    PAYSTATION_CALLBACK_URL: env.PAYSTATION_CALLBACK_URL || undefined,
    PAYSTATION_IPN_URL: env.PAYSTATION_IPN_URL || undefined,
    PAYSTATION_PAY_WITH_CHARGE: env.PAYSTATION_PAY_WITH_CHARGE || undefined,
    PAYSTATION_TIMEOUT_MS: timeout,
  } as PaymentEnv);
}

interface Deps {
  prisma: PrismaClient;
  runner: DemoRunner;
  alerts: SecurityAlerts;
  out: (line: string) => void;
}

const cliRequest = (reason: string): DemoRequest => ({
  actorId: null,
  ip: null,
  reason,
  via: 'cli',
});

/** Loads a batch end to end; returns the exit code. */
export async function demoLoad(
  deps: Deps,
  reason: string,
  payments: PaymentConfig,
  passwords = new PasswordService(),
): Promise<number> {
  const password = randomBytes(12).toString('base64url');
  const passwordHash = await passwords.hash(password);
  let batchId: string;
  try {
    batchId = await deps.prisma.$transaction((tx) =>
      beginDemoLoad(tx, cliRequest(reason), payments),
    );
  } catch (e) {
    if (e instanceof DemoRefusalError || isSecondBatch(e)) {
      deps.out(`demo: refused (${e instanceof DemoRefusalError ? e.code : 'demo_busy'})`);
      return 1;
    }
    throw e;
  }
  deps.out(`demo: loading batch ${batchId} ...`);
  let counts: Record<string, number> | null;
  try {
    counts = await deps.runner.load(batchId, passwordHash);
  } catch (e) {
    await deps.runner.loadFailed(batchId);
    // A code or an error name only: a database error's text can hold the rows it tried to write.
    const why = e instanceof DemoRefusalError ? e.code : e instanceof Error ? e.name : 'error';
    deps.out(`demo: the load failed (${why}); the batch is 'failed': run "demo clear"`);
    return 1;
  }
  if (!counts) {
    deps.out('demo: the batch was not loading any more; nothing done');
    return 1;
  }
  await deps.alerts.raise('ops.demo_loaded', {
    actorId: null,
    meta: { batch: batchId, students: counts.students ?? 0, via: 'cli' },
  });
  deps.out(`demo: loaded ${JSON.stringify(counts)}`);
  deps.out(`demo: every demo login is <role>-<nnn>@${DEMO_EMAIL_DOMAIN}, e.g. student-001`);
  deps.out(`demo: the demo password (shown once): ${password}`);
  return 0;
}

/** Removes the batch; returns the exit code. */
export async function demoClear(deps: Deps, reason: string): Promise<number> {
  let begun: { batchId: string; previous: 'loaded' | 'failed' };
  try {
    begun = await deps.prisma.$transaction((tx) => beginDemoClear(tx, cliRequest(reason)));
  } catch (e) {
    if (e instanceof DemoRefusalError) {
      if (e.code === 'demo_absent') {
        deps.out('demo: no demo data; nothing to remove');
        return 0;
      }
      deps.out(`demo: refused (${e.code})`);
      return 1;
    }
    throw e;
  }
  try {
    const counts = await deps.runner.clear(begun.batchId);
    await deps.alerts.raise('ops.demo_cleared', {
      actorId: null,
      meta: { batch: begun.batchId, via: 'cli' },
    });
    deps.out(`demo: removed ${JSON.stringify(counts ?? {})}`);
    return 0;
  } catch (e) {
    const blockers = e instanceof DemoClearBlocked ? e.blockers : undefined;
    await deps.runner.clearRefused(begun.batchId, begun.previous, blockers);
    if (blockers) {
      deps.out(
        `demo: refused, nothing removed: real rows use demo rows ${JSON.stringify(blockers)} (RUNBOOK "Demo data")`,
      );
      return 1;
    }
    if (e instanceof DemoClearBusy) {
      deps.out('demo: refused (demo_busy)');
      return 1;
    }
    throw e;
  }
}

async function main(): Promise<number> {
  let args: DemoArgs;
  let env: OpsEnv;
  let payments: PaymentConfig;
  try {
    args = parseDemoArgs(process.argv.slice(2));
    env = opsEnv();
    payments = paymentConfig(process.env);
  } catch (e) {
    // Usage, or a setting named by variable (ops-env.ts, payment.config.ts never print values).
    console.error(`demo: ${e instanceof Error ? e.message : 'invalid settings'}`);
    return 2;
  }
  if (args.action === 'load' && process.env.DEMO_DATA_ALLOWED !== 'true') {
    console.error('demo: refused (demo_not_allowed): DEMO_DATA_ALLOWED is not true on this server');
    return 1;
  }
  const prisma = new PrismaClient();
  const cache = new Redis(env.REDIS_CACHE_URL, { ...CACHE_REDIS_OPTIONS, lazyConnect: true });
  const queue = new Redis(env.REDIS_QUEUE_URL, { ...QUEUE_REDIS_OPTIONS, lazyConnect: true });
  let emails: EmailQueue | undefined;
  const background = new BackgroundTasks();
  try {
    await prisma.$queryRaw`SELECT 1`;
    await Promise.all([cache.connect(), queue.connect()]);
    emails = new EmailQueue(queue);
    const alerts = new SecurityAlerts(
      new AuditService(prisma as unknown as PrismaService),
      emails,
      background,
      new AlertEmailLimiter(cache, env.SECURITY_ALERT_EMAILS_PER_HOUR),
      env.SECURITY_ALERT_EMAIL,
    );
    const runner = new DemoRunner({
      prisma,
      cache,
      guard: async (tx) => {
        const allowed = await paymentsAllowDemo(tx, payments);
        if (!allowed.ok) throw new DemoRefusalError(allowed.reason);
      },
    });
    const deps: Deps = { prisma, runner, alerts, out: (line) => console.log(line) };
    const code =
      args.action === 'load'
        ? await demoLoad(deps, args.reason, payments)
        : await demoClear(deps, args.reason);
    await background.idle();
    return code;
  } catch (e) {
    console.error(`demo: failed (${e instanceof Error ? e.name : 'error'})`);
    return 1;
  } finally {
    await emails?.onApplicationShutdown().catch(() => undefined);
    cache.disconnect();
    queue.disconnect();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
