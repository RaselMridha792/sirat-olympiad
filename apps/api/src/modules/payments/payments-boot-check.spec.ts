import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env';
import type { SecurityAlerts } from '../audit/security-alerts.service';
import type { PaymentConfig } from './payment.config';
import { PaymentsBootCheck } from './payments-boot-check';

const enabled = { enabled: true } as PaymentConfig;
const disabled: PaymentConfig = { enabled: false };

function check(
  payment: PaymentConfig,
  nodeEnv: string,
  raise = jest.fn().mockResolvedValue(undefined),
) {
  const config = { get: () => nodeEnv } as unknown as ConfigService<EnvVars, true>;
  const alerts = { raise } as unknown as SecurityAlerts;
  return { boot: new PaymentsBootCheck(payment, config, alerts), raise };
}

describe('PaymentsBootCheck (lead, 2026-10-31)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('warns and raises an operator alert when payments are disabled in production', async () => {
    const { boot, raise } = check(disabled, 'production');
    await boot.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/payments are DISABLED/));
    expect(raise).toHaveBeenCalledWith('payments.disabled_in_production', {
      actorId: null,
      meta: { setting: 'PAYSTATION_ENV', state: 'blank' },
    });
  });

  it.each([
    ['payments enabled in production', enabled, 'production'],
    ['payments disabled in development', disabled, 'development'],
    ['payments disabled in test', disabled, 'test'],
  ])('stays quiet with %s', async (_label, payment, nodeEnv) => {
    const { boot, raise } = check(payment, nodeEnv);
    await boot.onApplicationBootstrap();
    expect(warn).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('never stops the boot when the alert cannot be recorded', async () => {
    const { boot } = check(
      disabled,
      'production',
      jest.fn().mockRejectedValue(new Error('db down')),
    );
    await expect(boot.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
