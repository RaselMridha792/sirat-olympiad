/**
 * Break-glass switch of the admin two-factor REQUIREMENT (DECISIONS 2026-11-08 "The admin 2FA requirement is a
 * setting"; RUNBOOK section 22): which of admin and manager must prove a second factor on the admin routes, for when
 * no admin can use PUT /admin/security/two-factor-requirement. Writes the setting and its audit row in one
 * transaction, then raises the security alert. Enrolments, recovery codes and sessions stay as they are, and an
 * enrolled admin or manager still gets the login's code step.
 *
 *   VPS:   $DC run --rm --no-deps -T api node dist/cli/admin-2fa-requirement.js --roles "" --reason "Testing before go-live"
 *          $DC run --rm --no-deps -T api node dist/cli/admin-2fa-requirement.js --roles "admin,manager" --reason "Go-live"
 *   Local: pnpm --filter @sirat/api admin:2fa-requirement --roles "admin,manager" --reason "Go-live"
 *
 * Needs the database and both Redis (the alert); never TOTP_ENCRYPTION_KEY. Prints only the new set
 * (`two-factor requirement: admin,manager`, or `none`). The API replicas pick it up within REQUIREMENT_CACHE_MS.
 * Exit 0 done; 1 refused or the database or Redis cannot be reached; 2 usage (an unknown role: nothing changed).
 */
import { PrismaClient } from '@prisma/client';
import type { Role } from '@sirat/shared';
import Redis from 'ioredis';
import { BackgroundTasks } from '../common/background/background-tasks';
import { AlertEmailLimiter } from '../modules/audit/alert-email-limiter';
import { AuditService } from '../modules/audit/audit.service';
import { SecurityAlerts } from '../modules/audit/security-alerts.service';
import {
  applyRequirementChange,
  rolesLabel,
} from '../modules/auth/two-factor/two-factor-requirement';
import { TWO_FACTOR_ROLES } from '../modules/auth/two-factor/two-factor.config';
import { EmailQueue } from '../modules/notifications/email-queue.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CACHE_REDIS_OPTIONS, QUEUE_REDIS_OPTIONS } from '../redis/redis.module';
import { OpsEnvError, opsEnv } from './ops-env';

/** A message that is safe to show the operator. */
export class TwoFactorRequirementCliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

const USAGE =
  'Usage: admin-2fa-requirement --roles "admin,manager" | --roles "" --reason "<why, 3-200 characters>"';

export interface TwoFactorRequirementArgs {
  roles: Role[];
  reason: string;
}

export function parseRequirementArgs(argv: readonly string[]): TwoFactorRequirementArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag !== '--roles' && flag !== '--reason') {
      // Only a flag-like word is repeated back: a stray value could be anything typed by mistake.
      const shown = /^--[a-z-]+$/.test(flag) ? ` ${flag}` : '';
      throw new TwoFactorRequirementCliError(`Unknown argument${shown}. ${USAGE}`, 2);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new TwoFactorRequirementCliError(`${flag} needs a value. ${USAGE}`, 2);
    values[flag.slice(2)] = value;
    i += 1;
  }
  const reason = (values.reason ?? '').trim().replace(/\s+/g, ' ');
  if (values.roles === undefined || !reason) throw new TwoFactorRequirementCliError(USAGE, 2);
  const parts = values.roles.trim() === '' ? [] : values.roles.split(',').map((r) => r.trim());
  if (!parts.every((r) => TWO_FACTOR_ROLES.includes(r as Role)))
    throw new TwoFactorRequirementCliError(
      `Unknown role: --roles takes ${TWO_FACTOR_ROLES.join(', ')} (comma-separated), or "" for none. Nothing was changed.`,
      2,
    );
  if (reason.length < 3 || reason.length > 200)
    throw new TwoFactorRequirementCliError('The reason must be 3-200 characters.', 2);
  return { roles: TWO_FACTOR_ROLES.filter((r) => parts.includes(r)), reason };
}

/**
 * Writes the requirement in one transaction with its audit row (no actor: an operator at the server, `via: 'cli'`),
 * then raises the alert when it changed. Returns the new set.
 */
export async function setRequirement(
  prisma: PrismaClient,
  args: TwoFactorRequirementArgs,
  alerts: Pick<SecurityAlerts, 'raise'>,
): Promise<Role[]> {
  const result = await prisma.$transaction((tx) =>
    applyRequirementChange(tx, {
      to: args.roles,
      actorId: null,
      meta: { reason: args.reason, via: 'cli' },
    }),
  );
  if (result.changed)
    await alerts.raise('two_factor.requirement_changed', {
      actorId: null,
      meta: { from: rolesLabel(result.from), to: rolesLabel(result.to) },
    });
  return result.to;
}

async function main(): Promise<number> {
  let args: TwoFactorRequirementArgs;
  try {
    args = parseRequirementArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof TwoFactorRequirementCliError)) throw e;
    process.stderr.write(`admin-2fa-requirement: ${e.message}\n`);
    return e.exitCode;
  }
  let env: ReturnType<typeof opsEnv>;
  try {
    env = opsEnv();
  } catch (e) {
    if (!(e instanceof OpsEnvError)) throw e;
    process.stderr.write(`admin-2fa-requirement: ${e.message}\n`);
    return 2;
  }
  const prisma = new PrismaClient();
  const cache = new Redis(env.REDIS_CACHE_URL, { ...CACHE_REDIS_OPTIONS, lazyConnect: true });
  const queue = new Redis(env.REDIS_QUEUE_URL, { ...QUEUE_REDIS_OPTIONS, lazyConnect: true });
  let emails: EmailQueue | undefined;
  try {
    // Everything reachable before anything changes: a change without its alert must not happen silently.
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
    const roles = await setRequirement(prisma, args, alerts);
    await background.idle();
    process.stdout.write(`two-factor requirement: ${rolesLabel(roles)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(
      `admin-2fa-requirement: could not change it (${e instanceof Error ? e.name : 'error'}). Nothing was changed unless the audit log shows security.two_factor_requirement_changed.\n`,
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
