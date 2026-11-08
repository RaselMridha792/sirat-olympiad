import { PaymentStatus, type Prisma } from '@prisma/client';
import type { PaymentConfig } from '../payment.config';

export type DemoRefusal = 'payments_live' | 'real_payments';

/**
 * Whether demo data may be loaded beside this database's payments (DECISIONS 2026-11-08 "Demo data"; the demo
 * framework calls it before writing). Refused while payments run live, and once real money was taken: a paid payment
 * started in the live environment (payments.gateway_env). Sandbox, fake and demo payments never count: none of them
 * moved money. Registration may stay open.
 */
export async function paymentsAllowDemo(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  config: PaymentConfig,
): Promise<{ ok: true } | { ok: false; reason: DemoRefusal }> {
  if (config.enabled && config.env === 'live') return { ok: false, reason: 'payments_live' };
  const real = await db.payment.findFirst({
    where: { status: PaymentStatus.paid, gatewayEnv: 'live' },
    select: { id: true },
  });
  return real ? { ok: false, reason: 'real_payments' } : { ok: true };
}
