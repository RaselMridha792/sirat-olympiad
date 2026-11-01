/**
 * Break-glass reset of an admin's or manager's two-factor login, for when no other admin can do it through the API
 * (POST /admin/users/:id/2fa/reset; RUNBOOK "Admin lost the authenticator"). Removes the factor and every recovery
 * code and ends all the account's sessions, in one transaction with its audit row; then raises a security alert.
 *
 *   VPS:   docker compose -p sirat --env-file .env -f infra/docker-compose.yml exec -T api \
 *            node dist/cli/admin-2fa-reset.js --email ops@example.org --reason "Lost phone, ticket 12"
 *   Local: pnpm --filter @sirat/api admin:2fa-reset --email ops@example.org --reason "Lost phone"
 *
 * Needs the database and both Redis (the alert); never TOTP_ENCRYPTION_KEY, since nothing is decrypted. Prints the
 * user id only. The account then logs in with its password alone and must enrol again before any admin page opens.
 * Exit 0 reset; 1 refused (no such account, no two-factor login) or the database or Redis cannot be reached; 2 usage.
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { BackgroundTasks } from '../common/background/background-tasks';
import { AlertEmailLimiter } from '../modules/audit/alert-email-limiter';
import { AuditService } from '../modules/audit/audit.service';
import { SecurityAlerts } from '../modules/audit/security-alerts.service';
import { removeTwoFactor } from '../modules/auth/two-factor/two-factor-reset';
import { EmailQueue } from '../modules/notifications/email-queue.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CACHE_REDIS_OPTIONS, QUEUE_REDIS_OPTIONS } from '../redis/redis.module';
import { OpsEnvError, opsEnv } from './ops-env';

/** A message that is safe to show the operator (never an email address or a secret). */
export class TwoFactorResetCliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const USAGE = 'Usage: admin-2fa-reset --email <address> --reason "<why, 3-200 characters>"';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TwoFactorResetArgs {
  email: string;
  reason: string;
}

export function parseResetArgs(argv: readonly string[]): TwoFactorResetArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag !== '--email' && flag !== '--reason') {
      // Only a flag-like word is repeated back: a stray value could be an address or a code.
      const shown = /^--[a-z-]+$/.test(flag) ? ` ${flag}` : '';
      throw new TwoFactorResetCliError(`Unknown argument${shown}. ${USAGE}`, 2);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new TwoFactorResetCliError(`${flag} needs a value. ${USAGE}`, 2);
    values[flag.slice(2)] = value;
    i += 1;
  }
  const email = (values.email ?? '').trim().toLowerCase();
  const reason = (values.reason ?? '').trim().replace(/\s+/g, ' ');
  if (!email || !reason) throw new TwoFactorResetCliError(USAGE, 2);
  if (!EMAIL.test(email) || email.length > 254)
    throw new TwoFactorResetCliError('That is not a valid email address.', 2);
  if (reason.length < 3 || reason.length > 200)
    throw new TwoFactorResetCliError('The reason must be 3-200 characters.', 2);
  return { email, reason };
}

/**
 * Resets the account's 2FA in one transaction with its audit row (no actor: an operator at the server), then raises
 * the alert. Returns the user id.
 */
export async function resetTwoFactor(
  prisma: PrismaClient,
  args: TwoFactorResetArgs,
  alerts: Pick<SecurityAlerts, 'raise'>,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true, twoFactor: { select: { userId: true } } },
  });
  if (!user) throw new TwoFactorResetCliError('No account with this email. Nothing was changed.');
  if (!user.twoFactor)
    throw new TwoFactorResetCliError(
      'This account has no two-factor login (nothing to reset). Nothing was changed.',
    );
  const sessionsEnded = await prisma.$transaction(async (tx) => {
    const ended = await removeTwoFactor(tx, user.id);
    await tx.auditLog.create({
      data: {
        action: 'auth.2fa_reset',
        entityType: 'user',
        entityId: user.id,
        meta: { via: 'cli', reason: args.reason, sessionsEnded: ended },
      },
    });
    return ended;
  });
  await alerts.raise('two_factor.reset', {
    actorId: null,
    meta: { via: 'cli', targetUserId: user.id, sessionsEnded },
  });
  return user.id;
}

async function main(): Promise<number> {
  let args: TwoFactorResetArgs;
  try {
    args = parseResetArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof TwoFactorResetCliError)) throw e;
    process.stderr.write(`admin-2fa-reset: ${e.message}\n`);
    return e.exitCode;
  }
  let env: ReturnType<typeof opsEnv>;
  try {
    env = opsEnv();
  } catch (e) {
    if (!(e instanceof OpsEnvError)) throw e;
    process.stderr.write(`admin-2fa-reset: ${e.message}\n`);
    return 2;
  }
  const prisma = new PrismaClient();
  const cache = new Redis(env.REDIS_CACHE_URL, { ...CACHE_REDIS_OPTIONS, lazyConnect: true });
  const queue = new Redis(env.REDIS_QUEUE_URL, { ...QUEUE_REDIS_OPTIONS, lazyConnect: true });
  let emails: EmailQueue | undefined;
  try {
    // Everything reachable before anything changes: a reset without its alert must not happen silently.
    await prisma.$queryRaw`SELECT 1`;
    await Promise.all([cache.connect(), queue.connect()]);
    emails = new EmailQueue(queue);
    const background = new BackgroundTasks();
    const alerts = new SecurityAlerts(
      new AuditService(prisma as unknown as PrismaService),
      emails,
      background,
      new AlertEmailLimiter(cache, env.SECURITY_ALERT_EMAILS_PER_HOUR),
      env.SECURITY_ALERT_EMAIL,
    );
    const id = await resetTwoFactor(prisma, args, alerts);
    await background.idle();
    process.stdout.write(`2FA reset: ${id}\n`);
    return 0;
  } catch (e) {
    if (e instanceof TwoFactorResetCliError) {
      process.stderr.write(`admin-2fa-reset: ${e.message}\n`);
      return e.exitCode;
    }
    process.stderr.write(
      `admin-2fa-reset: could not reset (${e instanceof Error ? e.name : 'error'}). Nothing was changed unless the audit log shows auth.2fa_reset.\n`,
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
