import { Logger } from '@nestjs/common';
import {
  ALERT_CATEGORIES,
  ALERT_CATEGORY,
  SecurityAlerts,
  securityAlertMessage,
  type SecurityAlertKind,
} from './security-alerts.service';

/* Alert categories, the message and the boot warning (LAUNCH-PLAN §6, L10). Example addresses only. */

const TO = 'alerts@example.invalid';
const SUBJECT: Record<string, RegExp> = {
  security: /^\[Sirat\] Security alert: /,
  payments: /^\[Sirat\] Payments alert: /,
  ops: /^\[Sirat\] Ops alert: /,
};

describe('alert categories', () => {
  it('give every kind a category, and the subject names it', () => {
    for (const [kind, category] of Object.entries(ALERT_CATEGORY)) {
      expect(ALERT_CATEGORIES).toContain(category);
      const message = securityAlertMessage(
        TO,
        kind as SecurityAlertKind,
        { actorId: null, meta: {} },
        new Date(0),
      );
      expect(message.subject).toMatch(SUBJECT[category]!);
    }
    expect(ALERT_CATEGORY['login.distributed']).toBe('security');
    expect(ALERT_CATEGORY['payments.needs_review']).toBe('payments');
    expect(ALERT_CATEGORY['ops.backup_failed']).toBe('ops');
  });

  it('write the Account line only when there is an account', () => {
    const none = securityAlertMessage(
      TO,
      'payments.needs_review',
      { actorId: null, meta: { amountMinor: 40_000 } },
      new Date(0),
    );
    expect(none.text).not.toContain('Account:');
    expect(none.text).toContain('amountMinor: 40000');
    const some = securityAlertMessage(
      TO,
      'login.account_limit',
      { actorId: 'user-1', meta: {} },
      new Date(0),
    );
    expect(some.text).toContain('Account: user-1');
  });
});

describe('the boot warning', () => {
  it('warns in production when SECURITY_ALERT_EMAIL is blank, and only then', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const alerts = (recipient: string | undefined, production: boolean) =>
        new SecurityAlerts(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          recipient,
          production,
        );
      alerts(undefined, true).onModuleInit();
      alerts(TO, true).onModuleInit();
      alerts(undefined, false).onModuleInit();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls[0])).toContain('SECURITY_ALERT_EMAIL is blank');
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TO);
    } finally {
      warn.mockRestore();
    }
  });
});
