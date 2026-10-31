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
  | 'payments.disabled_in_production' // PAYSTATION_ENV is blank on a production server (lead, 2026-10-31)
  | 'payments.fee_invalid' // settings.registration_fee_minor is not a valid fee: no payment can start
  | 'payments.credentials_rejected' // PayStation answered "1001": payments paused (lead, 2026-10-31)
  | 'payments.needs_review' // money taken but set aside for an admin (amount, invoice, duplicate, account conflict)
  | 'ops.backup_failed' // backup.sh: a run or its daily check failed (the heartbeat's /fail as well)
  | 'ops.monitor_failed' // monitor.sh: ops-check could not run, so nothing was checked
  | 'ops.alert_test'; // ops-alert --kind ops.alert_test: proves the email path (the fake-alert drill)

/** Alert categories: each has its own hourly email cap (LAUNCH-PLAN §6, owner Q2) and its own subject. */
export const ALERT_CATEGORIES = ['security', 'payments', 'ops'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

/** Typed per kind: a new kind without a category fails typecheck. */
export const ALERT_CATEGORY: Record<SecurityAlertKind, AlertCategory> = {
  'login.account_limit': 'security',
  'login.distributed': 'security',
  'payments.disabled_in_production': 'payments',
  'payments.fee_invalid': 'payments',
  'payments.credentials_rejected': 'payments',
  'payments.needs_review': 'payments',
  'ops.backup_failed': 'ops',
  'ops.monitor_failed': 'ops',
  'ops.alert_test': 'ops',
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
};

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
  // trying an email that has no account. Payments and ops alerts without one carry their own details instead.
  const account =
    event.actorId ?? (ALERT_CATEGORY[kind] === 'security' ? 'no account with that email' : null);
  const lines = [
    TITLES[kind],
    '',
    `Time: ${at.toISOString()}`,
    ...(account ? [`Account: ${account}`] : []),
    ...Object.entries(event.meta).map(([key, value]) => `${key}: ${String(value)}`),
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
