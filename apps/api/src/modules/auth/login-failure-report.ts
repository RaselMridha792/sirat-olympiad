import type { AuditService } from '../audit/audit.service';
import type { SecurityAlerts } from '../audit/security-alerts.service';
import type { FailureResult } from './login-limiter';

/**
 * What follows a failure counted in the login limits (owner rules, 2026-10-31): a lock is audited, and the start of the
 * account limit and a distributed attempt are security alerts. Shared by every check under those limits: the login's
 * password and its code step (DECISIONS "Admin two-factor login"). The caller audits the failure itself first.
 */
export async function reportLoginFailure(
  deps: { audit: AuditService; alerts: SecurityAlerts },
  failure: FailureResult,
  actorId: string | null,
  ip: string | null | undefined,
): Promise<void> {
  if (failure.lockedForMs > 0)
    await deps.audit.record({
      action: 'auth.login_locked',
      actorId,
      ip,
      meta: {
        scope: 'account_ip',
        level: failure.lockLevel,
        minutes: failure.lockedForMs / 60_000,
      },
    });
  const meta = { accountFailures: failure.accountFailures, distinctIps: failure.distinctIps };
  if (failure.accountLimitStarted)
    await deps.alerts.raise('login.account_limit', { actorId, ip, meta });
  if (failure.distributedSignal)
    await deps.alerts.raise('login.distributed', { actorId, ip, meta });
  // Across all accounts (the spray defence, login-spray.ts): not about this account, so no actor. The IP is the one
  // whose failure crossed the line; the audit row keeps it, the email does not.
  const wide = {
    failuresThisMinute: failure.failuresThisMinute,
    failedAccounts10Min: failure.failedAccounts10Min,
  };
  if (failure.burstSignal)
    await deps.alerts.raise('login.failure_burst', { actorId: null, ip, meta: wide });
  if (failure.spraySignal)
    await deps.alerts.raise('login.spray', { actorId: null, ip, meta: wide });
}
