import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackgroundTasks } from '../../common/background/background-tasks';
import { escapeHtml } from '../../common/html';
import { EmailQueue } from '../notifications/email-queue.service';
import type { EmailMessage } from '../notifications/email.types';
import { ALERT_EMAIL_KIND_INTERVAL_MS, AlertEmailLimiter } from './alert-email-limiter';
import { AuditService } from './audit.service';

/** Security events that need a human (owner, 2026-10-31). */
export type SecurityAlertKind =
  | 'login.account_limit' // an account reached its hourly failure limit
  | 'login.distributed' // more distinct IPs than the threshold failed on one account within the hour
  | 'payments.disabled_in_production'; // PAYSTATION_ENV is blank on a production server (lead, 2026-10-31)

export interface SecurityAlertEvent {
  actorId: string | null;
  ip?: string | null;
  meta: Record<string, string | number | boolean>;
}

/** Operator inbox from config (SECURITY_ALERT_EMAIL); undefined means audit and log only. */
export const SECURITY_ALERT_RECIPIENT = Symbol('SECURITY_ALERT_RECIPIENT');

const TITLES: Record<SecurityAlertKind, string> = {
  'login.account_limit': 'An account reached its hourly limit of failed logins',
  'login.distributed': 'Failed logins on one account from many IP addresses',
  'payments.disabled_in_production': 'Payments are disabled: PAYSTATION_ENV is blank in production',
};

/** The operator email: kind, time, account id and counts. No email address and no IP (those stay in the audit log). */
export function securityAlertMessage(
  to: string,
  kind: SecurityAlertKind,
  event: SecurityAlertEvent,
  at: Date,
): EmailMessage {
  const lines = [
    TITLES[kind],
    '',
    `Time: ${at.toISOString()}`,
    `Account: ${event.actorId ?? 'no account with that email'}`,
    ...Object.entries(event.meta).map(([key, value]) => `${key}: ${String(value)}`),
    '',
    `Details: audit log, action security.${kind}.`,
    'Alert emails of this kind pause for 10 minutes after each one, and an hourly cap applies; the audit log',
    'records every event.',
  ];
  const text = lines.join('\n');
  return {
    to,
    subject: `[Sirat] Security alert: ${TITLES[kind]}`,
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
export class SecurityAlerts {
  private readonly logger = new Logger('SecurityAlert');

  constructor(
    private readonly audit: AuditService,
    private readonly emails: EmailQueue,
    private readonly background: BackgroundTasks,
    private readonly mailLimiter: AlertEmailLimiter,
    @Inject(SECURITY_ALERT_RECIPIENT) private readonly recipient: string | undefined,
  ) {}

  async raise(kind: SecurityAlertKind, event: SecurityAlertEvent): Promise<void> {
    await this.audit.record({
      action: `security.${kind}`,
      actorId: event.actorId,
      ip: event.ip ?? null,
      meta: event.meta,
    });
    this.logger.warn({ msg: 'security alert', alert: kind, userId: event.actorId, ...event.meta });
    const to = this.recipient;
    if (to) this.background.run('security-alert-email', () => this.mail(to, kind, event));
  }

  private async mail(
    to: string,
    kind: SecurityAlertKind,
    event: SecurityAlertEvent,
  ): Promise<void> {
    if (!(await this.mailLimiter.allow(kind))) {
      this.logger.log({
        msg: 'security alert email held back (rate limit)',
        alert: kind,
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
