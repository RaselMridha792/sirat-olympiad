/**
 * The server checks (LAUNCH-PLAN §6, L11). monitor.sh collects the host facts every 5 minutes and pipes them, with
 * the state of the last run, into this command inside the api container:
 *
 *   echo '{"host":{...},"state":{...},"lastRunAt":...}' | $DC exec -T api node dist/cli/ops-check.js [--dry-run]
 *   echo '{"host":{...}}' | $DC exec -T api node dist/cli/ops-check.js --digest     (08:00 Asia/Dhaka)
 *
 * It adds the app facts (queues, workers, failed jobs, the reconciliation schedule, the queue Redis memory, failed
 * logins across all accounts), decides
 * each check's level (src/modules/ops/ops-rules.ts) and raises `ops.<check>` alerts on a change, hourly while a
 * problem holds, and once when it is resolved. It prints two lines for monitor.sh (no jq needed):
 *
 *   OPS critical=<check,...> warn=<check,...> alerts=<n>
 *   STATE <json for the next run>
 *
 * --dry-run raises nothing (CI). --digest sends the daily digest once a day and prints `DIGEST <outcome>`.
 * Exit 0 when it ran; 1 when the database or Redis cannot be reached (monitor.sh counts that as critical); 2 for bad
 * input. Prints check names and numbers only.
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { BackgroundTasks } from '../common/background/background-tasks';
import { EXAM_QUEUE } from '../modules/attempts/exam-queue';
import { AlertEmailLimiter } from '../modules/audit/alert-email-limiter';
import { AuditService } from '../modules/audit/audit.service';
import { SecurityAlerts } from '../modules/audit/security-alerts.service';
import { EmailQueue } from '../modules/notifications/email-queue.service';
import { AMBASSADOR_QUEUE } from '../modules/ambassadors/points-queue';
import { ADMIT_CARD_PDF_QUEUE } from '../modules/admit-card/admit-card-pdf-queue';
import { CERTIFICATES_QUEUE } from '../modules/certificates/certificates-queue';
import { HOUSEKEEPING_QUEUE } from '../modules/housekeeping/housekeeping-queue';
import { EMAIL_QUEUE } from '../modules/notifications/email.types';
import { readLoginGlobalFacts } from '../modules/auth/login-spray';
import { readQuoteMissFacts } from '../modules/payments/discount/quote-misses';
import { collectAppFacts, type QueueSpec } from '../modules/ops/app-facts';
import { sendDailyDigest } from '../modules/ops/digest';
import {
  EMPTY_STATE,
  LEVEL_CODE,
  decideAlerts,
  evaluate,
  summarize,
  type AppFacts,
  type HostFacts,
  type OpsAlert,
  type OpsState,
} from '../modules/ops/ops-rules';
import { PAYMENT_JOBS, PAYMENT_QUEUE } from '../modules/payments/verify/payment-queue';
import { PAYMENT_TIMING } from '../modules/payments/verify/payment-timing';
import type { PrismaService } from '../prisma/prisma.service';
import { CACHE_REDIS_OPTIONS, QUEUE_REDIS_OPTIONS } from '../redis/redis.module';
import { OpsEnvError, opsEnv, type OpsEnv } from './ops-env';

export class OpsCheckInputError extends Error {}

const HOST_NUMBERS = [
  'diskUsedPercent',
  'cpuBusyPercent',
  'memoryUsedPercent',
  'swapUsedMb',
  'containersBad',
  'requests',
  'responses5xx',
  'apiP95Ms',
  'webRenderErrors',
  'api5xxLogged',
  'certificateDaysLeft',
  'backupAgeHours',
  'trustedGeneratorsMinutesLeft',
] as const;

export interface OpsCheckInput {
  host: HostFacts;
  state: OpsState;
  lastRunAt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stdin JSON from monitor.sh: every host fact a finite number or null; a missing or broken state starts over. */
export function parseOpsCheckInput(raw: string): OpsCheckInput {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OpsCheckInputError('the input is not JSON');
  }
  if (!isRecord(json) || !isRecord(json.host)) throw new OpsCheckInputError('no host facts');
  const host: Record<string, number | boolean | null> = {};
  for (const key of HOST_NUMBERS) {
    const value = json.host[key];
    if (value === undefined || value === null) host[key] = null;
    else if (typeof value === 'number' && Number.isFinite(value)) host[key] = value;
    else throw new OpsCheckInputError(`host.${key} must be a number or null`);
  }
  const synced = json.host.timeSynced;
  if (synced !== undefined && synced !== null && typeof synced !== 'boolean')
    throw new OpsCheckInputError('host.timeSynced must be true, false or null');
  host.timeSynced = typeof synced === 'boolean' ? synced : null;
  const state =
    isRecord(json.state) && isRecord(json.state.streaks) && isRecord(json.state.alerts)
      ? (json.state as unknown as OpsState)
      : EMPTY_STATE;
  const fromState = isRecord(json.state) ? json.state.lastRunAt : undefined;
  const lastRunAt =
    typeof json.lastRunAt === 'number'
      ? json.lastRunAt
      : typeof fromState === 'number'
        ? fromState
        : null;
  return { host: host as unknown as HostFacts, state, lastRunAt };
}

export interface CheckRun {
  summary: ReturnType<typeof summarize>;
  alerts: OpsAlert[];
  state: OpsState & { lastRunAt: number };
}

/** One run: levels, the alerts to raise, and the state for the next run. */
export function runChecks(input: OpsCheckInput, app: AppFacts, now: number): CheckRun {
  const { results, streaks } = evaluate(input.host, app, input.state);
  const { alerts, memory } = decideAlerts(results, input.state.alerts, now);
  return {
    summary: summarize(results),
    alerts,
    state: { streaks, alerts: memory, lastRunAt: now },
  };
}

export function outputLines(run: CheckRun, raised: number): string[] {
  return [
    `OPS critical=${run.summary.critical.join(',')} warn=${run.summary.warn.join(',')} alerts=${raised}`,
    `STATE ${JSON.stringify(run.state)}`,
  ];
}

/** Raises each alert as `ops.<check>` with numbers only: the level code, the value, and 1 for an hourly reminder. */
export async function raiseCheckAlerts(
  alerts: OpsAlert[],
  raiser: SecurityAlerts,
): Promise<number> {
  for (const a of alerts) {
    const meta: Record<string, number> = { level: LEVEL_CODE[a.level] };
    if (a.value !== null) meta.value = a.value;
    if (a.reason === 'reminder') meta.reminder = 1;
    await raiser.raise(`ops.${a.check}`, { actorId: null, meta });
  }
  return alerts.length;
}

export function queueSpecs(env: OpsEnv): QueueSpec[] {
  return [
    { name: 'email', queueName: EMAIL_QUEUE },
    {
      name: 'payments',
      queueName: env.PAYMENTS_QUEUE_NAME || PAYMENT_QUEUE,
      criticalJob: PAYMENT_JOBS.verify,
    },
    { name: 'exam', queueName: env.EXAM_QUEUE_NAME || EXAM_QUEUE },
    { name: 'housekeeping', queueName: env.HOUSEKEEPING_QUEUE_NAME || HOUSEKEEPING_QUEUE },
    { name: 'ambassador', queueName: env.AMBASSADOR_QUEUE_NAME || AMBASSADOR_QUEUE },
    { name: 'certificates', queueName: env.CERTIFICATES_QUEUE_NAME || CERTIFICATES_QUEUE },
    { name: 'admit-card-pdf', queueName: env.ADMIT_CARD_PDF_QUEUE_NAME || ADMIT_CARD_PDF_QUEUE },
  ];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const digest = args.includes('--digest');
  if (args.some((a) => a !== '--dry-run' && a !== '--digest') || (dryRun && digest)) {
    console.error('usage: ops-check [--dry-run | --digest] < facts.json');
    return 2;
  }
  let input: OpsCheckInput;
  try {
    input = parseOpsCheckInput(await readStdin());
  } catch (e) {
    if (!(e instanceof OpsCheckInputError)) throw e;
    console.error(`ops-check: ${e.message}`);
    return 2;
  }
  let env: OpsEnv;
  try {
    env = opsEnv();
  } catch (e) {
    if (!(e instanceof OpsEnvError)) throw e;
    console.error(`ops-check: ${e.message}`);
    return 2;
  }
  const prisma = new PrismaClient();
  const cache = new Redis(env.REDIS_CACHE_URL, { ...CACHE_REDIS_OPTIONS, lazyConnect: true });
  const queueRedis = new Redis(env.REDIS_QUEUE_URL, { ...QUEUE_REDIS_OPTIONS, lazyConnect: true });
  let emails: EmailQueue | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
    await Promise.all([cache.connect(), queueRedis.connect()]);
    // Only now: BullMQ would otherwise connect the client itself, and connect() above would then fail.
    const queue = new EmailQueue(queueRedis);
    emails = queue;
    const now = new Date();
    if (digest) {
      const outcome = await sendDailyDigest({
        prisma,
        enqueue: (kind, key, message) => queue.enqueue(kind, key, message),
        to: env.SECURITY_ALERT_EMAIL,
        host: {
          diskUsedPercent: input.host.diskUsedPercent,
          backupAgeHours: input.host.backupAgeHours,
        },
        now,
      });
      console.log(`DIGEST ${outcome}`);
      return 0;
    }
    const app = await collectAppFacts(queueRedis, {
      queues: queueSpecs(env),
      reconcile: {
        queueName: env.PAYMENTS_QUEUE_NAME || PAYMENT_QUEUE,
        jobName: PAYMENT_JOBS.reconcile,
        intervalSeconds: PAYMENT_TIMING.reconcileEveryMs / 1000,
      },
      sinceMs: input.lastRunAt ?? now.getTime() - 5 * 60_000,
      nowMs: now.getTime(),
    });
    // Failed logins across all accounts: the login limiter counts them in the cache Redis.
    app.login = await readLoginGlobalFacts(cache, now.getTime());
    // Discount-code quote misses per IP: the registration quote counts them in the cache Redis.
    app.quote = await readQuoteMissFacts(cache, now.getTime());
    const run = runChecks(input, app, now.getTime());
    let raised = 0;
    if (!dryRun) {
      const background = new BackgroundTasks();
      const alerts = new SecurityAlerts(
        new AuditService(prisma as unknown as PrismaService),
        queue,
        background,
        new AlertEmailLimiter(cache, env.SECURITY_ALERT_EMAILS_PER_HOUR),
        env.SECURITY_ALERT_EMAIL,
      );
      raised = await raiseCheckAlerts(run.alerts, alerts);
      await background.idle();
    }
    for (const line of outputLines(run, raised)) console.log(line);
    return 0;
  } catch (e) {
    console.error(`ops-check: could not run (${e instanceof Error ? e.name : 'error'})`);
    return 1;
  } finally {
    await emails?.onApplicationShutdown().catch(() => undefined);
    cache.disconnect();
    queueRedis.disconnect();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
