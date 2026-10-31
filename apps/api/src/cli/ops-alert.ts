/**
 * Raises an ops alert from a shell script (LAUNCH-PLAN §6, L10): backup.sh when a run or its daily check fails,
 * monitor.sh when ops-check cannot run, and the fake-alert drill. Only kinds of the `ops` category (an allow-list), and
 * only numeric `key=value` details, so a script can neither forge a security or payments alert nor put text, and so
 * personal data, into an email. Like every alert it writes the audit row (`security.<kind>`) and a log line first,
 * then queues the operator email under the ops category's own caps.
 *
 *   VPS:   docker compose -p sirat --env-file .env -f infra/docker-compose.yml exec -T api \
 *            node dist/cli/ops-alert.js --kind ops.backup_failed --meta step=5
 *   Local: pnpm --filter @sirat/api ops:alert --kind ops.alert_test
 *
 * Prints the kind only (never the recipient). Exit 0 once recorded; 1 when the database or Redis cannot be reached;
 * 2 for bad arguments.
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { BackgroundTasks } from '../common/background/background-tasks';
import { AlertEmailLimiter } from '../modules/audit/alert-email-limiter';
import { AuditService } from '../modules/audit/audit.service';
import { SecurityAlerts, type SecurityAlertKind } from '../modules/audit/security-alerts.service';
import { EmailQueue } from '../modules/notifications/email-queue.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CACHE_REDIS_OPTIONS, QUEUE_REDIS_OPTIONS } from '../redis/redis.module';
import { OpsEnvError, opsEnv, type OpsEnv } from './ops-env';

/**
 * The kinds a script may raise: three ops kinds, nothing of another category. The server checks raise their own
 * kinds inside ops-check, so a script can neither forge a security or payments alert nor fake a check's state.
 */
export const OPS_ALERT_KINDS = [
  'ops.backup_failed',
  'ops.monitor_failed',
  'ops.alert_test',
] as const satisfies readonly SecurityAlertKind[];

const MAX_META = 10;
const META_KEY = /^[a-z][A-Za-z0-9_]{0,31}$/;
const META_NUMBER = /^-?\d{1,12}(\.\d{1,6})?$/;

export class OpsAlertUsageError extends Error {}

export interface OpsAlertArgs {
  kind: SecurityAlertKind;
  meta: Record<string, number>;
}

export function parseOpsAlertArgs(argv: readonly string[]): OpsAlertArgs {
  let kind: string | undefined;
  const meta: Record<string, number> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === '--kind' || flag === '--meta') && value === undefined)
      throw new OpsAlertUsageError(`${flag} needs a value`);
    if (flag === '--kind') {
      kind = value;
    } else if (flag === '--meta') {
      const eq = value!.indexOf('=');
      const key = eq > 0 ? value!.slice(0, eq) : '';
      const raw = eq > 0 ? value!.slice(eq + 1) : '';
      if (!META_KEY.test(key))
        throw new OpsAlertUsageError('--meta needs key=number (key: a-z, 0-9, _)');
      if (!META_NUMBER.test(raw))
        throw new OpsAlertUsageError(`--meta ${key}: the value must be a number`);
      if (!(key in meta) && Object.keys(meta).length >= MAX_META)
        throw new OpsAlertUsageError(`at most ${MAX_META} --meta values`);
      meta[key] = Number(raw);
    } else {
      throw new OpsAlertUsageError(`unknown argument: ${String(flag)}`);
    }
    i += 1;
  }
  if (!kind) throw new OpsAlertUsageError('--kind is required');
  if (!(OPS_ALERT_KINDS as readonly string[]).includes(kind))
    throw new OpsAlertUsageError(`--kind must be one of: ${OPS_ALERT_KINDS.join(', ')}`);
  return { kind: kind as SecurityAlertKind, meta };
}

/** Records the alert and waits until its email (if any) is queued, so the process may exit right after. */
export async function raiseOpsAlert(
  args: OpsAlertArgs,
  deps: { alerts: SecurityAlerts; background: BackgroundTasks },
): Promise<void> {
  await deps.alerts.raise(args.kind, { actorId: null, meta: args.meta });
  await deps.background.idle();
}

async function main(): Promise<number> {
  let args: OpsAlertArgs;
  try {
    args = parseOpsAlertArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof OpsAlertUsageError)) throw e;
    console.error(`ops-alert: ${e.message}`);
    return 2;
  }
  let env: OpsEnv;
  try {
    env = opsEnv();
  } catch (e) {
    if (!(e instanceof OpsEnvError)) throw e;
    console.error(`ops-alert: ${e.message}`);
    return 2;
  }
  const prisma = new PrismaClient();
  const cache = new Redis(env.REDIS_CACHE_URL, { ...CACHE_REDIS_OPTIONS, lazyConnect: true });
  const queue = new Redis(env.REDIS_QUEUE_URL, { ...QUEUE_REDIS_OPTIONS, lazyConnect: true });
  let emails: EmailQueue | undefined;
  try {
    // Reachable before anything is raised: the limiter and the email queue skip a Redis that is not ready yet, and
    // the audit write never throws.
    await prisma.$queryRaw`SELECT 1`;
    await Promise.all([cache.connect(), queue.connect()]);
    // Only now: BullMQ would otherwise connect the client itself, and connect() above would then fail.
    emails = new EmailQueue(queue);
    const background = new BackgroundTasks();
    const alerts = new SecurityAlerts(
      new AuditService(prisma as unknown as PrismaService),
      emails,
      background,
      new AlertEmailLimiter(cache, env.SECURITY_ALERT_EMAILS_PER_HOUR),
      env.SECURITY_ALERT_EMAIL,
    );
    await raiseOpsAlert(args, { alerts, background });
    console.log(`ops-alert: ${args.kind} recorded`);
    return 0;
  } catch (e) {
    console.error(
      `ops-alert: could not record the alert (${e instanceof Error ? e.name : 'error'})`,
    );
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
