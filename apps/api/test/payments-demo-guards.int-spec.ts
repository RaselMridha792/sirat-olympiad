/**
 * Demo payments stay out of the money flow (DECISIONS 2026-11-08 "Demo data"; payments' part of exam's demo data):
 * start records the configured PayStation environment; the registration form refuses the demo email domain; the
 * verifier, reconciliation and the admin re-check and reconcile leave a demo payment alone; and paymentsAllowDemo
 * refuses a database that holds real money, or one whose payments run live.
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, type Payment } from '@prisma/client';
import { DEMO_ACCOUNT_LABEL, DEMO_EMAIL_DOMAIN, DEMO_INVOICE_PREFIX } from '@sirat/shared';
import { paymentsAllowDemo } from '../src/modules/payments/demo/allow-demo';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../src/modules/payments/gateway/payment-gateway';
import type { PaymentConfig } from '../src/modules/payments/payment.config';
import { PAYMENT_CONFIG } from '../src/modules/payments/payments-boot-check';
import { makeRegistrationAttempt, paymentData, testInvoice } from './helpers';
import {
  bootPaymentsApp,
  caller,
  loginAs,
  startRegistration,
  type PaymentsApp,
} from './payments-app';

let env: PaymentsApp;

beforeAll(async () => {
  env = await bootPaymentsApp();
}, 60_000);

afterAll(async () => {
  await env?.close();
});

afterEach(() => jest.restoreAllMocks());

const demoInvoice = () =>
  `${DEMO_INVOICE_PREFIX}261108${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** A payment of `gatewayEnv` brought along legal transitions to `status` (paid: with a trx_id and paid_at). */
async function payment(
  gatewayEnv: string,
  status: PaymentStatus,
  over: { gatewayAccount?: string; invoiceNumber?: string } = {},
): Promise<Payment> {
  const attempt = await makeRegistrationAttempt(env.prisma);
  const config = env.app.get<PaymentConfig>(PAYMENT_CONFIG);
  // The configured label by default, so reconciliation would pick the row if nothing else kept it out.
  const gatewayAccount = config.enabled ? config.accountLabel : 'test-fake';
  const row = await env.prisma.payment.create({
    data: paymentData(attempt.id, { gatewayEnv, gatewayAccount, ...over }),
  });
  if (status === PaymentStatus.initiated) return row;
  await env.prisma.payment.update({ where: { id: row.id }, data: { status: 'pending' } });
  if (status === PaymentStatus.pending)
    return env.prisma.payment.findUniqueOrThrow({ where: { id: row.id } });
  return env.prisma.payment.update({
    where: { id: row.id },
    data:
      status === PaymentStatus.paid
        ? {
            status,
            trxId: `T${randomUUID().replace(/-/g, '').slice(0, 14)}`,
            paidAt: new Date(),
            paidAmountMinor: row.amountMinor,
          }
        : { status },
  });
}

const demoPayment = (status: PaymentStatus) =>
  payment('demo', status, { gatewayAccount: DEMO_ACCOUNT_LABEL, invoiceNumber: demoInvoice() });

describe('start and the registration form', () => {
  it('start records the configured PayStation environment (fake here)', async () => {
    const started = await startRegistration(env);
    const row = await env.prisma.payment.findUniqueOrThrow({ where: { id: started.paymentId } });
    expect(row.gatewayEnv).toBe('fake');
  });

  it('gateway_env has no default: a write that does not name it is refused, so live money cannot pass as sandbox', async () => {
    const attempt = await makeRegistrationAttempt(env.prisma);
    // 23502 not_null_violation (Prisma's message does not name the column): every other NOT NULL column is given, and
    // the control below, identical but naming gateway_env, goes in.
    await expect(env.prisma.$executeRaw`
      INSERT INTO "payments" ("id", "pending_registration_id", "invoice_number", "amount_minor", "currency",
                              "pay_with_charge", "gateway_account", "expires_at", "updated_at")
      VALUES (gen_random_uuid(), ${attempt.id}::uuid, ${testInvoice()}, 40000, 'BDT', false, 'test-fake',
              now() + interval '1 hour', now())`).rejects.toThrow(/Code: `23502`/);
    expect(await env.prisma.payment.count({ where: { pendingRegistrationId: attempt.id } })).toBe(
      0,
    );
    await env.prisma.$executeRaw`
      INSERT INTO "payments" ("id", "pending_registration_id", "invoice_number", "amount_minor", "currency",
                              "pay_with_charge", "gateway_account", "gateway_env", "expires_at", "updated_at")
      VALUES (gen_random_uuid(), ${attempt.id}::uuid, ${testInvoice()}, 40000, 'BDT', false, 'test-fake', 'fake',
              now() + interval '1 hour', now())`;
    expect(await env.prisma.payment.count({ where: { pendingRegistrationId: attempt.id } })).toBe(
      1,
    );
  });

  it('refuses exactly the demo email domain, in any case, and starts nothing', async () => {
    for (const address of [
      `a-${randomUUID().slice(0, 8)}@${DEMO_EMAIL_DOMAIN}`,
      `B@${DEMO_EMAIL_DOMAIN.toUpperCase()}`,
    ]) {
      await expect(startRegistration(env, { email: address })).rejects.toThrow(
        /start answered 400/,
      );
      expect(
        await env.prisma.pendingRegistration.count({
          where: { email: { equals: address, mode: 'insensitive' } },
        }),
      ).toBe(0);
    }
    // Only that domain: a sub-domain or any other .invalid address (CI fixtures use them) is an address like any other.
    await expect(
      startRegistration(env, { email: `c-${randomUUID().slice(0, 8)}@sub.${DEMO_EMAIL_DOMAIN}` }),
    ).resolves.toBeDefined();
  });
});

describe('a demo payment is never sent to PayStation', () => {
  it('the verifier returns "demo": no status call, no event, no account-mismatch alert', async () => {
    const statusCall = jest.spyOn(env.app.get<PaymentGateway>(PAYMENT_GATEWAY), 'statusByInvoice');
    for (const status of [PaymentStatus.pending, PaymentStatus.failed, PaymentStatus.paid]) {
      const demo = await demoPayment(status);
      for (const reason of ['callback', 'ipn', 'reconcile', 'admin'] as const)
        expect(await env.verifier.verify(demo.id, reason)).toBe('demo');
      expect(await env.prisma.paymentEvent.count({ where: { paymentId: demo.id } })).toBe(0);
      expect(
        await env.prisma.auditLog.count({ where: { entityType: 'payment', entityId: demo.id } }),
      ).toBe(0);
    }
    // gateway_env alone is enough, even under the configured label.
    const underRealLabel = await payment('demo', PaymentStatus.pending);
    expect(await env.verifier.verify(underRealLabel.id, 'reconcile')).toBe('demo');
    expect(statusCall).not.toHaveBeenCalled();
  });

  it('reconciliation and the late watch never claim one, under either marker', async () => {
    const byLabel = await demoPayment(PaymentStatus.pending);
    const byEnv = await payment('demo', PaymentStatus.pending); // the configured label, gateway_env 'demo'
    const real = await payment('fake', PaymentStatus.pending); // the control: claimed
    await env.reconciler.run(new Date(Date.now() + 60 * 60 * 1000));
    const checked = await env.prisma.payment.findMany({
      where: { id: { in: [byLabel.id, byEnv.id, real.id] } },
      select: { id: true, lastCheckedAt: true },
    });
    const seen = new Map(checked.map((p) => [p.id, p.lastCheckedAt]));
    expect(seen.get(byLabel.id)).toBeNull();
    expect(seen.get(byEnv.id)).toBeNull();
    expect(seen.get(real.id)).not.toBeNull();
  });

  it('admin re-check and reconcile answer 409 DEMO_PAYMENT, and audit nothing', async () => {
    const admin = await loginAs(env, 'admin');
    const call = caller(env.base);
    for (const status of [PaymentStatus.pending, PaymentStatus.expired]) {
      const demo = await demoPayment(status);
      const recheck = await call('POST', `/admin/payments/${demo.id}/recheck`, {
        cookie: admin.cookie,
      });
      expect(recheck.status).toBe(409);
      expect(await recheck.json()).toMatchObject({ code: 'DEMO_PAYMENT' });
      const reconcile = await call('POST', `/admin/payments/${demo.id}/reconcile`, {
        cookie: admin.cookie,
        body: { trxId: 'TRX123456', reason: 'Seen in the PayStation panel' },
      });
      expect(reconcile.status).toBe(409);
      expect(await reconcile.json()).toMatchObject({ code: 'DEMO_PAYMENT' });
      expect(
        await env.prisma.auditLog.count({ where: { entityType: 'payment', entityId: demo.id } }),
      ).toBe(0);
      expect((await env.prisma.payment.findUniqueOrThrow({ where: { id: demo.id } })).status).toBe(
        status,
      );
    }
  });
});

describe('paymentsAllowDemo', () => {
  it('refuses while payments run live, and once a live payment is paid; sandbox, fake and demo money never counts', async () => {
    const config = env.app.get<PaymentConfig>(PAYMENT_CONFIG);
    if (!config.enabled) throw new Error('the test app runs with payments enabled (fake)');
    const live = { ...config, env: 'live' } as PaymentConfig;

    expect(await paymentsAllowDemo(env.prisma, live)).toEqual({
      ok: false,
      reason: 'payments_live',
    });

    await payment('sandbox', PaymentStatus.paid);
    await payment('fake', PaymentStatus.paid);
    await demoPayment(PaymentStatus.paid);
    await payment('live', PaymentStatus.pending); // started live but never paid: no money
    await payment('live', PaymentStatus.failed);
    expect(await paymentsAllowDemo(env.prisma, config)).toEqual({ ok: true });

    const real = await payment('live', PaymentStatus.paid);
    try {
      expect(await paymentsAllowDemo(env.prisma, config)).toEqual({
        ok: false,
        reason: 'real_payments',
      });
    } finally {
      // Left behind, it would make every later demo load in this test database answer real_payments.
      await env.prisma.payment.delete({ where: { id: real.id } });
    }
    expect(await paymentsAllowDemo(env.prisma, config)).toEqual({ ok: true });
  });
});
