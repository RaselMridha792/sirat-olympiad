import type { Payment } from '@prisma/client';
import { DEMO_ACCOUNT_LABEL } from '@sirat/shared';

/**
 * A demo payment (DECISIONS 2026-11-08 "Demo data"): never sent to PayStation, never verified, never re-checked or
 * reconciled by an admin. Either marker is enough. payment.config refuses the label for a real account, and only the
 * demo loader writes gateway_env 'demo'.
 */
export function isDemoPayment(payment: Pick<Payment, 'gatewayAccount' | 'gatewayEnv'>): boolean {
  return payment.gatewayEnv === 'demo' || payment.gatewayAccount === DEMO_ACCOUNT_LABEL;
}
