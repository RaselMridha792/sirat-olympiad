import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env';
import { SecurityAlerts } from '../audit/security-alerts.service';
import type { PaymentConfig } from './payment.config';

export const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');

/**
 * Blank PAYSTATION_ENV disables payments without stopping the app (dev, CI and other sessions boot). On a production
 * server that is almost certainly a mistake, so it is loud: a WARN line and an operator alert (audit row, rate-limited
 * email) once per process start (lead, 2026-10-31). The RUNBOOK launch checklist also compares the boot log line.
 * Never throws: a failed alert must not stop the boot.
 */
@Injectable()
export class PaymentsBootCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('Payments');

  constructor(
    @Inject(PAYMENT_CONFIG) private readonly payment: PaymentConfig,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly alerts: SecurityAlerts,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.payment.enabled || this.config.get('NODE_ENV', { infer: true }) !== 'production')
      return;
    this.logger.warn(
      'PAYSTATION_ENV is blank with NODE_ENV=production: payments are DISABLED and no registration can be paid. ' +
        'Set the PayStation variables (RUNBOOK, launch checklist) unless this server must not take payments.',
    );
    try {
      await this.alerts.raise('payments.disabled_in_production', {
        actorId: null,
        meta: { setting: 'PAYSTATION_ENV', state: 'blank' },
      });
    } catch {
      this.logger.error('could not record the payments-disabled alert');
    }
  }
}
