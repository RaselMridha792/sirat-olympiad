/**
 * The verify job and the settlement (docs/plans/PAYMENTS-PLAN.md 6.3, 6.5, 6.6, section 9), against the fake
 * PayStation and the *_test database. The rules checked here: paid only after the status API confirms our invoice and
 * exactly our amount; the account is made from the stored form in the same transaction, once; money taken always
 * wins (late success, a duplicate payment, an email or phone taken meanwhile) and is set aside with a critical alert;
 * a refund never changes a paid payment; reconciliation claims the right payments and backs off.
 */
import { randomUUID } from 'node:crypto';
import { PaymentStatus, RegistrationAttemptStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { EMAIL_TOKEN_TTLS } from '../src/modules/auth/email-tokens.service';
import { EMAIL_QUEUE, type EmailJobData } from '../src/modules/notifications/email.types';
import { PaymentsWorker } from '../src/modules/payments/verify/payments.worker';
import { makePaidPayment, makeRegistrationAttempt, makeUser, paymentData } from './helpers';
import {
  APP_ORIGIN,
  PASSWORD,
  bootPaymentsApp,
  caller,
  checkout,
  resetData,
  startRegistration,
  type PaymentsApp,
} from './payments-app';

let env: PaymentsApp;
const MIN = 60_000;

beforeAll(async () => {
  env = await bootPaymentsApp();
}, 60_000);

afterAll(async () => {
  await env?.close();
});

beforeEach(() => env.fake.reset());

const payment = (id: string) => env.prisma.payment.findUniqueOrThrow({ where: { id } });
const attempt = (id: string) => env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id } });
const events = (paymentId: string) =>
  env.prisma.paymentEvent.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } });
const alerts = (paymentId: string) =>
  env.prisma.auditLog.findMany({
    where: {
      action: 'security.payments.needs_review',
      meta: { path: ['paymentId'], equals: paymentId },
    },
  });

describe('verify: a confirmed success', () => {
  it('creates the account from the stored form, the registration and the payment user, in one transaction', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);

    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('applied_paid');

    const p = await payment(s.paymentId);
    expect(p).toMatchObject({
      status: PaymentStatus.paid,
      trxId: checkout(env, s.invoiceNumber).trxId,
      paidAmountMinor: 40000,
      checkCount: 1,
      gatewayStatus: 'success',
      reviewReason: null,
    });
    expect(p.paidAt).toBeInstanceOf(Date);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    const grade = await env.prisma.gradeLevel.findUniqueOrThrow({
      where: { id: env.gradeLevelId },
    });
    expect(user).toMatchObject({
      role: 'student',
      phone: s.phone,
      category: grade.category,
      gradeLevelId: env.gradeLevelId,
      signupSource: 'registration',
      emailVerifiedAt: null,
      district: 'Dhaka',
    });
    expect(p.userId).toBe(user.id);
    expect(await env.prisma.registration.findUnique({ where: { userId: user.id } })).toMatchObject({
      paymentId: s.paymentId,
    });
    // The attempt is consumed; the form and the password hash are not kept.
    expect(await attempt(s.attemptId)).toMatchObject({
      status: RegistrationAttemptStatus.completed,
      userId: user.id,
      payload: null,
    });
    expect(
      await env.prisma.auditLog.count({
        where: { action: 'registration.completed', entityId: user.id },
      }),
    ).toBe(1);
    // The verification email: a fresh email_verify token for the new account.
    expect(
      await env.prisma.authToken.count({
        where: { userId: user.id, type: 'email_verify', usedAt: null },
      }),
    ).toBe(1);
    const evs = await events(s.paymentId);
    expect(evs.at(-1)).toMatchObject({
      source: 'status_v1',
      outcome: 'applied_paid',
      statusCode: '200',
    });

    // The student logs in with the password typed in the form, and this browser sees "completed".
    const call = caller(env.base);
    const login = await call('POST', '/auth/login', {
      body: { email: s.email, password: PASSWORD },
    });
    expect(login.status).toBe(204);
    const current = await call('GET', '/registrations/current', { cookie: s.cookie });
    expect(await current.json()).toMatchObject({
      state: 'completed',
      canResume: false,
      canRetry: false,
    });
  });

  it("sends A2's verification link: one token store, AuthModule's lifetimes, accepted by /auth/verify-email", async () => {
    // EmailTokenService is provided again in PaymentsCoreModule (the worker has no AuthModule): stateless, the same
    // auth_tokens table through the one PrismaService, and the same TTL factory. This proves the last two.
    const { AuthModule } = await import('../src/modules/auth/auth.module');
    const { PaymentsCoreModule } = await import('../src/modules/payments/payments-core.module');
    expect(env.app.select(PaymentsCoreModule).get(EMAIL_TOKEN_TTLS)).toEqual(
      env.app.select(AuthModule).get(EMAIL_TOKEN_TTLS),
    );
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    await env.verifier.verify(s.paymentId, 'callback');
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    const issued = await env.prisma.authToken.findFirstOrThrow({
      where: { userId: user.id, type: 'email_verify' },
    });
    const emails = new Queue<EmailJobData>(EMAIL_QUEUE, { connection: env.queueRedis });
    const job = await emails.getJob(`verify-email.${issued.id}`);
    expect(job?.data.message.to).toBe(s.email);
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(job?.data.message.text ?? '')?.[1];
    expect(token).toBeDefined();
    await job?.remove();
    const res = await caller(env.base)('POST', '/auth/verify-email', { body: { token } });
    expect(res.status).toBe(204);
    expect(
      (await env.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt,
    ).toBeInstanceOf(Date);
  });

  it('is idempotent: a second check is a duplicate, and two checks at once make one account', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    const outcomes = await Promise.all([
      env.verifier.verify(s.paymentId, 'callback'),
      env.verifier.verify(s.paymentId, 'ipn'),
    ]);
    expect(outcomes.sort()).toEqual(['applied_paid', 'duplicate']);
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('duplicate');
    expect(await env.prisma.user.count({ where: { email: s.email } })).toBe(1);
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(await env.prisma.registration.count({ where: { userId: user.id } })).toBe(1);
    expect((await payment(s.paymentId)).checkCount).toBe(3);
  });

  it('moves an initiated payment through pending to paid (the trigger allows only the state machine)', async () => {
    const s = await startRegistration(env);
    // A second attempt whose payment never left `initiated` (as when initiate's answer was lost), with a checkout.
    const a = await makeRegistrationAttempt(env.prisma, {
      payload: (await attempt(s.attemptId)).payload as Prisma.InputJsonValue,
    });
    const p = await env.prisma.payment.create({
      data: paymentData(a.id, { gatewayAccount: 'test-fake' }),
    });
    env.fake.checkouts.set(p.invoiceNumber, {
      ...checkout(env, s.invoiceNumber),
      invoiceNumber: p.invoiceNumber,
      reference: p.id,
      status: 'success',
      trxId: randomUUID(),
    });
    expect(await env.verifier.verify(p.id, 'reconcile')).toBe('applied_paid');
    expect((await payment(p.id)).status).toBe(PaymentStatus.paid);
    expect((await attempt(a.id)).status).toBe(RegistrationAttemptStatus.completed);
  });
});

describe('verify: no success', () => {
  it('a failed checkout fails the payment; the attempt stays open and retry is offered', async () => {
    const s = await startRegistration(env);
    env.fake.fail(s.invoiceNumber);
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('applied_failed');
    expect((await payment(s.paymentId)).status).toBe(PaymentStatus.failed);
    expect((await attempt(s.attemptId)).status).toBe(RegistrationAttemptStatus.open);
    const current = await caller(env.base)('GET', '/registrations/current', { cookie: s.cookie });
    expect(await current.json()).toMatchObject({ state: 'failed', canRetry: true });
  });

  it('still processing: no change before the expiry, expired after it', async () => {
    const s = await startRegistration(env);
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('no_change');
    const p = await payment(s.paymentId);
    expect(p.status).toBe(PaymentStatus.pending);
    const after = new Date(p.expiresAt.getTime() + MIN);
    expect(await env.verifier.verify(s.paymentId, 'reconcile', after)).toBe('applied_expired');
    expect((await payment(s.paymentId)).status).toBe(PaymentStatus.expired);
  });

  it('2001 and an unreachable PayStation change nothing; each check is counted and recorded', async () => {
    const s = await startRegistration(env);
    env.fake.scenario.statusCode = '2001';
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('not_found_2001');
    env.fake.scenario.statusCode = undefined;
    env.fake.scenario.nonJson = true;
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('unavailable');
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: PaymentStatus.pending, checkCount: 2 });
    const outcomes = (await events(s.paymentId)).map((e) => `${e.source}:${e.outcome}`);
    expect(outcomes).toEqual(
      expect.arrayContaining(['status_v1:not_found_2001', 'status_v1:unavailable']),
    );
  });

  it('a payment started on another PayStation account is not asked about (account_mismatch)', async () => {
    const a = await makeRegistrationAttempt(env.prisma);
    const p = await env.prisma.payment.create({
      data: paymentData(a.id, { gatewayAccount: 'old-account' }),
    });
    expect(await env.verifier.verify(p.id, 'admin')).toBe('account_mismatch');
    expect((await payment(p.id)).status).toBe(PaymentStatus.initiated);
    expect((await events(p.id)).map((e) => e.outcome)).toEqual(['account_mismatch']);
  });
});

describe('verify: money taken, set aside for an admin', () => {
  it('never pays a different amount: rejected_amount, review amount_mismatch, critical alert', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    env.fake.scenario.amountDeltaMinor = 100;
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('rejected_amount');
    expect(await payment(s.paymentId)).toMatchObject({
      status: PaymentStatus.pending,
      reviewReason: 'amount_mismatch',
      paidAmountMinor: null,
    });
    expect(await env.prisma.user.count({ where: { email: s.email } })).toBe(0);
    expect(await alerts(s.paymentId)).toHaveLength(1);
  });

  it('a late success after expiry is paid (late_success) and still makes the account', async () => {
    const s = await startRegistration(env);
    const p = await payment(s.paymentId);
    await env.verifier.verify(s.paymentId, 'reconcile', new Date(p.expiresAt.getTime() + MIN));
    expect((await payment(s.paymentId)).status).toBe(PaymentStatus.expired);
    await env.fake.pay(s.invoiceNumber);
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('applied_paid');
    expect(await payment(s.paymentId)).toMatchObject({
      status: PaymentStatus.paid,
      reviewReason: 'late_success',
    });
    expect(await env.prisma.user.count({ where: { email: s.email } })).toBe(1);
    expect(
      await env.prisma.auditLog.count({
        where: { action: 'payments.warning', entityId: s.paymentId },
      }),
    ).toBe(1);
  });

  it('an email that got an account meanwhile: paid, email_taken, attempt conflict, no account, critical alert', async () => {
    const s = await startRegistration(env);
    await makeUser(env.prisma, { email: s.email });
    await env.fake.pay(s.invoiceNumber);
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('email_taken');
    expect(await payment(s.paymentId)).toMatchObject({
      status: PaymentStatus.paid,
      reviewReason: 'email_taken',
      userId: null,
    });
    expect((await attempt(s.attemptId)).status).toBe(RegistrationAttemptStatus.conflict);
    expect(await env.prisma.user.count({ where: { phone: s.phone } })).toBe(0);
    expect(await alerts(s.paymentId)).toHaveLength(1);
    const current = await caller(env.base)('GET', '/registrations/current', { cookie: s.cookie });
    expect(await current.json()).toMatchObject({ state: 'needs_help' });
  });

  it('a phone that got an account meanwhile: paid, phone_taken', async () => {
    const s = await startRegistration(env);
    await makeUser(env.prisma, { phone: s.phone });
    await env.fake.pay(s.invoiceNumber);
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('phone_taken');
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'paid',
      reviewReason: 'phone_taken',
    });
    expect((await attempt(s.attemptId)).status).toBe(RegistrationAttemptStatus.conflict);
  });

  it('a second paid payment of a completed attempt: duplicate_payment, the same user, no second registration', async () => {
    const s = await startRegistration(env);
    env.fake.fail(s.invoiceNumber);
    await env.verifier.verify(s.paymentId, 'callback');
    const retry = await caller(env.base)('POST', '/registrations/current/retry', {
      cookie: s.cookie,
    });
    expect(retry.status).toBe(201);
    const second = await env.prisma.payment.findFirstOrThrow({
      where: { pendingRegistrationId: s.attemptId, NOT: { id: s.paymentId } },
    });
    await env.fake.pay(second.invoiceNumber);
    expect(await env.verifier.verify(second.id, 'callback')).toBe('applied_paid');
    // The first checkout was paid after all (PayStation lets a failed checkout be retried).
    checkout(env, s.invoiceNumber).status = 'success';
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('duplicate_payment');
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'paid',
      reviewReason: 'duplicate_payment',
      userId: user.id,
    });
    expect(await env.prisma.registration.count({ where: { userId: user.id } })).toBe(1);
    expect(await alerts(s.paymentId)).toHaveLength(1);
  });

  it('a late success on an attempt the student gave up: paid, abandoned_attempt_paid, no account from it', async () => {
    const s = await startRegistration(env);
    env.fake.fail(s.invoiceNumber);
    await env.verifier.verify(s.paymentId, 'callback');
    const cancel = await caller(env.base)('POST', '/registrations/current/cancel', {
      cookie: s.cookie,
    });
    expect(cancel.status).toBe(204);
    expect((await attempt(s.attemptId)).status).toBe(RegistrationAttemptStatus.abandoned);
    checkout(env, s.invoiceNumber).status = 'success';
    expect(await env.verifier.verify(s.paymentId, 'reconcile')).toBe('abandoned_attempt_paid');
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'paid',
      reviewReason: 'abandoned_attempt_paid',
      userId: null,
    });
    expect(await env.prisma.user.count({ where: { email: s.email } })).toBe(0);
    expect((await attempt(s.attemptId)).status).toBe(RegistrationAttemptStatus.abandoned);
    expect(await alerts(s.paymentId)).toHaveLength(1);
  });

  it('a trx_id another payment already holds is never paid here: trx_id_reused', async () => {
    const paid = await makePaidPayment(env.prisma);
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    checkout(env, s.invoiceNumber).trxId = paid.trxId as string;
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('duplicate');
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'pending',
      trxId: null,
      reviewReason: 'trx_id_reused',
    });
    expect(await alerts(s.paymentId)).toHaveLength(1);
  });

  it('a refund reported for a paid payment changes nothing: refund_reported, critical alert', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    await env.verifier.verify(s.paymentId, 'callback');
    env.fake.refund(s.invoiceNumber);
    expect(await env.verifier.verify(s.paymentId, 'admin')).toBe('refund_reported');
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'paid',
      reviewReason: 'refund_reported',
    });
    expect(await alerts(s.paymentId)).toHaveLength(1);
  });
});

describe('reconciliation', () => {
  it('claims old active and watched failed/expired payments of this account, backs off, and queues one verify each', async () => {
    env.gradeLevelId = await resetData(env.prisma);
    await env.queue.obliterate({ force: true });
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const make = async (
      status: PaymentStatus,
      over: { createdAt?: Date; expiresAt?: Date; account?: string; url?: string | null } = {},
    ) => {
      const a = await makeRegistrationAttempt(env.prisma);
      const p = await env.prisma.payment.create({
        data: paymentData(a.id, {
          gatewayAccount: over.account ?? 'test-fake',
          createdAt: over.createdAt ?? ago(10 * MIN),
          expiresAt: over.expiresAt ?? new Date(now.getTime() + 50 * MIN),
        }),
      });
      if (status === PaymentStatus.initiated) return p.id;
      const url = over.url === undefined ? 'https://checkout.test.invalid/x' : over.url;
      if (status === PaymentStatus.failed && url === null) {
        await env.prisma.payment.update({ where: { id: p.id }, data: { status } });
        return p.id;
      }
      await env.prisma.payment.update({
        where: { id: p.id },
        data: { status: PaymentStatus.pending, paymentUrl: url },
      });
      if (status !== PaymentStatus.pending)
        await env.prisma.payment.update({ where: { id: p.id }, data: { status } });
      return p.id;
    };
    const claimed = {
      pending: await make(PaymentStatus.pending),
      initiated: await make(PaymentStatus.initiated),
      expiredInWatch: await make(PaymentStatus.expired, { expiresAt: ago(47 * 60 * MIN) }),
      failedInWatch: await make(PaymentStatus.failed, { expiresAt: ago(MIN) }),
    };
    const skipped = {
      young: await make(PaymentStatus.pending, { createdAt: ago(MIN) }),
      otherAccount: await make(PaymentStatus.pending, { account: 'old-account' }),
      pastWatch: await make(PaymentStatus.expired, { expiresAt: ago(49 * 60 * MIN) }),
      neverReachedCheckout: await make(PaymentStatus.failed, { url: null }),
      paid: (await makePaidPayment(env.prisma)).id,
    };

    expect(await env.reconciler.run(now)).toEqual({ claimed: 4, queued: 4 });
    for (const id of Object.values(claimed)) {
      const job = await env.queue.getJob(`verify.${id}`);
      expect(job?.data).toEqual({ paymentId: id, reason: 'reconcile' });
      expect((await payment(id)).lastCheckedAt?.getTime()).toBe(now.getTime());
    }
    for (const id of Object.values(skipped))
      expect(await env.queue.getJob(`verify.${id}`)).toBeUndefined();

    // Back-off: nothing again right away; then 2 minutes after the last check, or 10 at check_count 4.
    expect((await env.reconciler.run(new Date(now.getTime() + 1_000))).claimed).toBe(0);
    await env.prisma.payment.update({ where: { id: claimed.pending }, data: { checkCount: 4 } });
    await env.queue.obliterate({ force: true });
    await env.reconciler.run(new Date(now.getTime() + 2 * MIN + 1_000));
    expect(await env.queue.getJob(`verify.${claimed.initiated}`)).toBeDefined();
    expect(await env.queue.getJob(`verify.${claimed.pending}`)).toBeUndefined();
    await env.queue.obliterate({ force: true });
    await env.reconciler.run(new Date(now.getTime() + 10 * MIN + 1_000));
    expect(await env.queue.getJob(`verify.${claimed.pending}`)).toBeDefined();
  });
});

describe('the worker, end to end', () => {
  it('callback and IPN from a real checkout: the BullMQ worker verifies once and the student can log in', async () => {
    await env.queue.obliterate({ force: true });
    env.fakeOptions.ipnUrl = `${env.base}/api/payments/paystation/ipn`;
    const worker = new PaymentsWorker(env.verifier, env.reconciler, env.app.get(ConfigService));
    await worker.onModuleInit();
    try {
      const s = await startRegistration(env);
      // The payer presses Pay: the fake posts the IPN to us, then sends the browser to our callback.
      const pay = await fetch(`${env.fake.url}/checkout/${s.invoiceNumber}/pay`, {
        method: 'POST',
        redirect: 'manual',
      });
      expect(pay.status).toBe(303);
      const back = await fetch(
        pay.headers.get('location')?.replace('http://localhost:4100', env.base) ?? '',
        {
          redirect: 'manual',
        },
      );
      expect(back.status).toBe(303);
      expect(back.headers.get('location')).toBe(`${APP_ORIGIN}/register/result`);

      let status: PaymentStatus = PaymentStatus.pending;
      for (let i = 0; i < 50 && status !== PaymentStatus.paid; i += 1) {
        await new Promise((r) => setTimeout(r, 200));
        status = (await payment(s.paymentId)).status;
      }
      expect(status).toBe(PaymentStatus.paid);
      const evs = await events(s.paymentId);
      expect(
        evs.filter((e) => e.source === 'status_v1' && e.outcome === 'applied_paid'),
      ).toHaveLength(1);
      expect(evs.map((e) => e.source)).toEqual(expect.arrayContaining(['ipn', 'callback']));
      const login = await caller(env.base)('POST', '/auth/login', {
        body: { email: s.email, password: PASSWORD },
      });
      expect(login.status).toBe(204);
    } finally {
      env.fakeOptions.ipnUrl = undefined;
      await worker.onApplicationShutdown();
      await env.queue.removeJobScheduler('payments-reconcile');
    }
  }, 30_000);
});
