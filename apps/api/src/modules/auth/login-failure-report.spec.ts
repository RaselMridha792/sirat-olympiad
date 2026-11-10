import type { AuditService } from '../audit/audit.service';
import type { SecurityAlerts } from '../audit/security-alerts.service';
import { reportLoginFailure } from './login-failure-report';
import type { FailureResult } from './login-limiter';

const quiet: FailureResult = {
  lockedForMs: 0,
  lockLevel: 0,
  accountFailures: 1,
  accountLimitStarted: false,
  distinctIps: 1,
  distributedSignal: false,
  failuresThisMinute: 1,
  failedAccounts10Min: 1,
  burstSignal: false,
  spraySignal: false,
};

function deps() {
  const record = jest.fn().mockResolvedValue(undefined);
  const raise = jest.fn().mockResolvedValue(undefined);
  return {
    record,
    raise,
    deps: {
      audit: { record } as unknown as AuditService,
      alerts: { raise } as unknown as SecurityAlerts,
    },
  };
}

describe('reportLoginFailure: the spray signals', () => {
  it('raises nothing for an ordinary failure', async () => {
    const d = deps();
    await reportLoginFailure(d.deps, quiet, 'user-1', '198.51.100.7');
    expect(d.raise).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it('raises login.failure_burst and login.spray without an actor, with the numbers and the IP', async () => {
    const d = deps();
    const failure = {
      ...quiet,
      failuresThisMinute: 2_000,
      failedAccounts10Min: 1_000,
      burstSignal: true,
      spraySignal: true,
    };
    await reportLoginFailure(d.deps, failure, 'user-1', '198.51.100.7');
    const meta = { failuresThisMinute: 2_000, failedAccounts10Min: 1_000 };
    expect(d.raise).toHaveBeenCalledWith('login.failure_burst', {
      actorId: null,
      ip: '198.51.100.7',
      meta,
    });
    expect(d.raise).toHaveBeenCalledWith('login.spray', {
      actorId: null,
      ip: '198.51.100.7',
      meta,
    });
    expect(d.raise).toHaveBeenCalledTimes(2);
  });
});
