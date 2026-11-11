import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { BackgroundTasks } from '../../common/background/background-tasks';
import { escapeHtml } from '../../common/html';
import { EmailQueue } from '../notifications/email-queue.service';
import type { EmailMessage } from '../notifications/email.types';
import { ALERT_EMAIL_KIND_INTERVAL_MS, AlertEmailLimiter } from './alert-email-limiter';
import { AuditService } from './audit.service';

/** Events that need a human (owner, 2026-10-31). Each kind belongs to one category (ALERT_CATEGORY). */
export type SecurityAlertKind =
  | 'login.account_limit' // an account reached its hourly failure limit
  | 'login.distributed' // more distinct IPs than the threshold failed on one account within the hour
  | 'login.failure_burst' // failed logins of all accounts reached the per-minute threshold (login-spray.ts)
  | 'login.spray' // distinct emails failing within 10 minutes reached the spray threshold (login-spray.ts)
  | 'two_factor.recovery_used' // a 2FA recovery code was used (the login's code step, or turning 2FA off)
  | 'two_factor.reset' // an account's 2FA was reset by another admin or the break-glass CLI
  | 'two_factor.requirement_changed' // the roles that must prove 2FA changed (an admin, or the break-glass CLI)
  | 'payments.disabled_in_production' // PAYSTATION_ENV is blank on a production server (lead, 2026-10-31)
  | 'payments.fee_invalid' // settings.registration_fee_minor is not a valid fee: no payment can start
  | 'payments.credentials_rejected' // PayStation answered "1001": payments paused (lead, 2026-10-31)
  | 'payments.needs_review' // money taken but set aside for an admin (amount, invoice, duplicate, account conflict)
  | 'ops.backup_failed' // backup.sh: a run or its daily check failed (the heartbeat's /fail as well)
  | 'ops.monitor_failed' // monitor.sh: ops-check could not run, so nothing was checked
  | 'ops.alert_test' // ops-alert --kind ops.alert_test: proves the email path (the fake-alert drill)
  | 'ops.disk' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.swap' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.cpu' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.memory' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.containers' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.queue_redis_memory' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.workers' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.queue_backlog' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.failed_jobs' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.reconciliation' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.http_5xx' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.app_errors' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.api_p95' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.certificate' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.backup_age' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.time_sync' // a server check (ops-check, L11): see RUNBOOK §7
  | 'ops.trusted_generators' // the load-test generators are trusted (A2's L14): see RUNBOOK §7;
  | 'ops.login_failures' // a server check (ops-check): failed logins across all accounts, see RUNBOOK §7
  | 'ops.demo_loaded' // demo data was loaded (an admin or the CLI): remove it before launch
  | 'ops.demo_cleared'; // demo data was removed

/** Alert categories: each has its own hourly email cap (LAUNCH-PLAN §6, owner Q2) and its own subject. */
export const ALERT_CATEGORIES = ['security', 'payments', 'ops'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

/** Typed per kind: a new kind without a category fails typecheck. */
export const ALERT_CATEGORY: Record<SecurityAlertKind, AlertCategory> = {
  'login.account_limit': 'security',
  'login.distributed': 'security',
  'login.failure_burst': 'security',
  'login.spray': 'security',
  'two_factor.recovery_used': 'security',
  'two_factor.reset': 'security',
  'two_factor.requirement_changed': 'security',
  'payments.disabled_in_production': 'payments',
  'payments.fee_invalid': 'payments',
  'payments.credentials_rejected': 'payments',
  'payments.needs_review': 'payments',
  'ops.backup_failed': 'ops',
  'ops.monitor_failed': 'ops',
  'ops.alert_test': 'ops',
  'ops.disk': 'ops',
  'ops.swap': 'ops',
  'ops.cpu': 'ops',
  'ops.memory': 'ops',
  'ops.containers': 'ops',
  'ops.queue_redis_memory': 'ops',
  'ops.workers': 'ops',
  'ops.queue_backlog': 'ops',
  'ops.failed_jobs': 'ops',
  'ops.reconciliation': 'ops',
  'ops.http_5xx': 'ops',
  'ops.app_errors': 'ops',
  'ops.api_p95': 'ops',
  'ops.certificate': 'ops',
  'ops.backup_age': 'ops',
  'ops.time_sync': 'ops',
  'ops.trusted_generators': 'ops',
  'ops.login_failures': 'security',
  'ops.demo_loaded': 'ops',
  'ops.demo_cleared': 'ops',
};

const SUBJECT_PREFIX: Record<AlertCategory, string> = {
  security: 'Security alert',
  payments: 'Payments alert',
  ops: 'Ops alert',
};

export interface SecurityAlertEvent {
  actorId: string | null;
  ip?: string | null;
  meta: Record<string, string | number | boolean>;
}

/** Operator inbox from config (SECURITY_ALERT_EMAIL); undefined means audit and log only. */
export const SECURITY_ALERT_RECIPIENT = Symbol('SECURITY_ALERT_RECIPIENT');
/** True on a production server: a blank SECURITY_ALERT_EMAIL is then warned about at boot. */
export const ALERTS_IN_PRODUCTION = Symbol('ALERTS_IN_PRODUCTION');

const TITLES: Record<SecurityAlertKind, string> = {
  'login.account_limit': 'An account reached its hourly limit of failed logins',
  'login.distributed': 'Failed logins on one account from many IP addresses',
  'login.failure_burst': 'Failed logins across all accounts: over 2,000 in one minute (RUNBOOK §7)',
  'login.spray':
    'Failed logins on many different accounts within 10 minutes: a guessing spray? (RUNBOOK §7)',
  'two_factor.recovery_used': 'A two-factor recovery code was used',
  'two_factor.reset': "An account's two-factor login was reset",
  'two_factor.requirement_changed':
    'The roles that must sign in with two-factor login changed (from, to below)',
  'payments.disabled_in_production': 'Payments are disabled: PAYSTATION_ENV is blank in production',
  'payments.fee_invalid':
    'Registration payments stopped: the registration fee setting is not valid',
  'payments.credentials_rejected':
    'PayStation refused the merchant credentials (1001): payments are paused for 10 minutes',
  'payments.needs_review':
    'A payment needs an admin: see the admin payments review list (reason below)',
  'ops.backup_failed':
    'A database backup or its daily check failed: see the backup service log (RUNBOOK §5)',
  'ops.monitor_failed': 'The server checks could not run, so nothing was checked (RUNBOOK §7)',
  'ops.alert_test': 'Test alert: the alert email path works',
  'ops.disk': 'Disk usage on the server',
  'ops.swap': 'The server is using swap',
  'ops.cpu': 'CPU busy above 85% on two checks in a row',
  'ops.memory': 'Memory in use on the server',
  'ops.containers': 'A container is not running or unhealthy (two checks in a row)',
  'ops.queue_redis_memory': 'The queue Redis is filling up (of 512 MB)',
  'ops.workers': 'A job queue has no worker (two checks in a row)',
  'ops.queue_backlog': 'Jobs are waiting too long in a queue',
  'ops.failed_jobs': 'Background jobs failed for good',
  'ops.reconciliation': 'The payments reconciliation did not run on time',
  'ops.http_5xx': 'Server errors (5xx) in the last 5 minutes',
  'ops.app_errors': 'API or web errors in the logs of the last 5 minutes',
  'ops.api_p95': 'API responses are slow (p95 over 1 s)',
  'ops.certificate': 'The TLS certificate expires soon',
  'ops.backup_age': 'No database backup in the last 26 hours',
  'ops.time_sync': 'The server clock is not synchronised',
  'ops.trusted_generators':
    'Load-test generators are trusted to set client addresses (loadtest-realip): switch them off',
  'ops.demo_loaded':
    'Demo data was loaded: remove it before launch (the prelaunch check fails while it exists)',
  'ops.demo_cleared': 'Demo data was removed',
  'ops.login_failures': 'Failed logins across all accounts are above the spray thresholds',
};

/** The login alerts about one account; the spray alerts (all accounts) have no account line. */
const PER_ACCOUNT_LOGIN_KINDS: ReadonlySet<SecurityAlertKind> = new Set([
  'login.account_limit',
  'login.distributed',
]);

/**
 * The operator email: kind, time, the account (for a login alert also "no account with that email"), and the event's
 * values. No email address and no IP (those stay in the audit log). The subject names the category.
 */
export function securityAlertMessage(
  to: string,
  kind: SecurityAlertKind,
  event: SecurityAlertEvent,
  at: Date,
): EmailMessage {
  // A login alert without an account keeps its line (owner-approved, #7): it tells the operator that someone is
  // trying an email that has no account. Other alerts without one (the break-glass 2FA reset, payments, ops) carry
  // their own details instead.
  const account =
    event.actorId ?? (PER_ACCOUNT_LOGIN_KINDS.has(kind) ? 'no account with that email' : null);
  const lines = [
    TITLES[kind],
    '',
    `Time: ${at.toISOString()}`,
    ...(account ? [`Account: ${account}`] : []),
    ...Object.entries(event.meta).map(([key, value]) => `${key}: ${String(value)}`),
    ...('level' in event.meta ? ['(level: 2 = critical, 1 = warning, 0 = resolved)'] : []),
    '',
    `Details: audit log, action security.${kind}.`,
    'Alert emails of this kind pause for 10 minutes after each one, and each category (security, payments, ops)',
    'has its own hourly cap; the audit log records every event.',
  ];
  const text = lines.join('\n');
  return {
    to,
    subject: `[Sirat] ${SUBJECT_PREFIX[ALERT_CATEGORY[kind]]}: ${TITLES[kind]}`,
    text,
    html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`,
  };
}

/**
 * Raises a security alert. The audit row (`security.<kind>`, with the IP) and a warn log line marked `alert` are
 * the source of truth; they are written first and never depend on email. The operator email then goes out from the
 * background, rate limited (one per kind per 10 min, an hourly cap), so it can never slow or block a login and an
 * attack cannot flood the inbox. Never throws.
 */
@Injectable()
export class SecurityAlerts implements OnModuleInit {
  private readonly logger = new Logger('SecurityAlert');

  constructor(
    private readonly audit: AuditService,
    private readonly emails: EmailQueue,
    private readonly background: BackgroundTasks,
    private readonly mailLimiter: AlertEmailLimiter,
    @Inject(SECURITY_ALERT_RECIPIENT) private readonly recipient: string | undefined,
    @Optional() @Inject(ALERTS_IN_PRODUCTION) private readonly production: boolean = false,
  ) {}

  /** Production without an operator inbox: every alert would reach only the audit log and the log (LAUNCH-PLAN §6). */
  onModuleInit(): void {
    if (this.production && !this.recipient)
      this.logger.warn({
        msg: 'SECURITY_ALERT_EMAIL is blank: alerts reach only the audit log and the log, no one is emailed',
      });
  }

  async raise(kind: SecurityAlertKind, event: SecurityAlertEvent): Promise<void> {
    await this.audit.record({
      action: `security.${kind}`,
      actorId: event.actorId,
      ip: event.ip ?? null,
      meta: event.meta,
    });
    this.logger.warn({
      msg: 'security alert',
      alert: kind,
      category: ALERT_CATEGORY[kind],
      userId: event.actorId,
      ...event.meta,
    });
    const to = this.recipient;
    if (to) this.background.run('security-alert-email', () => this.mail(to, kind, event));
  }

  private async mail(
    to: string,
    kind: SecurityAlertKind,
    event: SecurityAlertEvent,
  ): Promise<void> {
    if (!(await this.mailLimiter.allow(kind, ALERT_CATEGORY[kind]))) {
      this.logger.log({
        msg: 'security alert email held back (rate limit)',
        alert: kind,
        category: ALERT_CATEGORY[kind],
        pauseMinutes: ALERT_EMAIL_KIND_INTERVAL_MS / 60_000,
      });
      return;
    }
    await this.emails.enqueue(
      'security-alert',
      `security-alert.${kind}.${randomUUID()}`,
      securityAlertMessage(to, kind, event, new Date()),
    );
  }
}
