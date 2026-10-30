import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Security events that need a human (owner, 2026-10-31). */
export type SecurityAlertKind =
  | 'login.account_limit' // an account reached its hourly failure limit
  | 'login.distributed'; // more distinct IPs than the threshold failed on one account within the hour

export interface SecurityAlertEvent {
  actorId: string | null;
  ip?: string | null;
  meta: Record<string, string | number | boolean>;
}

/**
 * Raises a security alert: a `security.<kind>` audit row (with the IP, like other audit rows) and a warn log line
 * marked `alert` that log-based alerting can match. The log line names the kind, the user id and counts only:
 * never an email or an IP. Never throws (the audit write does not either).
 */
@Injectable()
export class SecurityAlerts {
  private readonly logger = new Logger('SecurityAlert');

  constructor(private readonly audit: AuditService) {}

  async raise(kind: SecurityAlertKind, event: SecurityAlertEvent): Promise<void> {
    await this.audit.record({
      action: `security.${kind}`,
      actorId: event.actorId,
      ip: event.ip ?? null,
      meta: event.meta,
    });
    this.logger.warn({ msg: 'security alert', alert: kind, userId: event.actorId, ...event.meta });
  }
}
