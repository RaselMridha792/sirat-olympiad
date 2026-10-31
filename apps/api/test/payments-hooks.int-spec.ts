/**
 * PayStation's callback and IPN, the recheck routes, and the admin payments and settings endpoints over HTTP
 * (docs/plans/PAYMENTS-PLAN.md 3.4, 6.2, 6.4, 6.7; lead, 2026-10-31 for the reconcile rule), against the fake
 * PayStation. The rules checked here: neither signal is trusted (each only records and asks for a check); the IPN is
 * the only CSRF-exempt route; every admin route is admin-only and audited; reconcile settles only a success PayStation
 * reported without a trx_id, once; a setting changes only from the value the admin saw.
 */
import { PaymentStatus } from '@prisma/client';
import { makePaidPayment, makeRegistrationAttempt, paymentData } from './helpers';
import {
  APP_ORIGIN,
  bootPaymentsApp,
  caller,
  checkout,
  clearCache,
  loginAs,
  startRegistration,
  type Call,
  type PaymentsApp,
} from './payments-app';

let env: PaymentsApp;
let call: Call;
let admin: { id: string; cookie: string };

beforeAll(async () => {
  env = await bootPaymentsApp();
  call = caller(env.base);
  admin = await loginAs(env, 'admin');
}, 60_000);

afterAll(async () => {
  await env?.close();
});

beforeEach(async () => {
  env.fake.reset();
  await clearCache(env.cache);
});

const payment = (id: string) => env.prisma.payment.findUniqueOrThrow({ where: { id } });
const events = (paymentId: string, source?: string) =>
  env.prisma.paymentEvent.findMany({
    where: { paymentId, ...(source ? { source } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
const job = (paymentId: string) => env.queue.getJob(`verify.${paymentId}`);
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('GET /payments/paystation/callback/:invoice', () => {
  it('records the return, asks for one check, never reads the result from the query, and redirects 303', async () => {
    const s = await startRegistration(env);
    const query = `status=Successful&invoice_number=${s.invoiceNumber}&trx_id=forged-trx`;
    const res = await call('GET', `/payments/paystation/callback/${s.invoiceNumber}?${query}`, {
      csrf: false,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${APP_ORIGIN}/register/result`);
    expect((await payment(s.paymentId)).status).toBe(PaymentStatus.pending);
    const queued = await job(s.paymentId);
    expect(queued?.data).toEqual({ paymentId: s.paymentId, reason: 'callback' });
    expect(queued?.opts.priority).toBe(1);

    // A second return (a refresh) within 30 s is recorded; no second check is asked for.
    const again = await call('GET', `/payments/paystation/callback/${s.invoiceNumber}?${query}`, {
      csrf: false,
    });
    expect(again.status).toBe(303);
    const recorded = await events(s.paymentId, 'callback');
    expect(recorded.map((e) => e.outcome)).toEqual(['verify_requested', 'verify_throttled']);
    expect(recorded[0]).toMatchObject({ trxStatus: 'successful', trxId: 'forged-trx' });
    expect(recorded[0]?.payload).toMatchObject({ status: 'Successful', trx_id: 'forged-trx' });
  });

  it('an unknown invoice is recorded and redirected; a malformed one is only redirected; a paid one needs no check', async () => {
    const unknown = 'TUNKNOWN0000000001';
    const res = await call('GET', `/payments/paystation/callback/${unknown}?status=Failed`);
    expect(res.status).toBe(303);
    expect(
      await env.prisma.paymentEvent.findFirst({
        where: { invoiceNumber: unknown, source: 'callback' },
      }),
    ).toMatchObject({ paymentId: null, outcome: 'unknown_invoice' });

    const bad = await call('GET', '/payments/paystation/callback/not-ours?status=x');
    expect(bad.status).toBe(303);
    expect(await env.prisma.paymentEvent.count({ where: { invoiceNumber: 'not-ours' } })).toBe(0);

    const paid = await makePaidPayment(env.prisma);
    expect((await call('GET', `/payments/paystation/callback/${paid.invoiceNumber}`)).status).toBe(
      303,
    );
    expect((await events(paid.id, 'callback')).map((e) => e.outcome)).toEqual(['no_check_needed']);
    expect(await job(paid.id)).toBeUndefined();
  });
});

describe('POST /payments/paystation/ipn', () => {
  const ipnBody = (invoice: string, trxId: string, extra: Record<string, unknown> = {}) => ({
    invoice_number: invoice,
    trx_status: 'Success',
    trx_id: trxId,
    trx_amount: 400,
    order_date_time: '2026-10-31 23:00:00',
    payment_method: 'bKash',
    ...extra,
  });

  it('needs no X-Requested-With, keeps the body redacted, and only asks for a check: nothing is marked', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    const body = ipnBody(s.invoiceNumber, checkout(env, s.invoiceNumber).trxId, {
      payer_mobile_no: '01712345678',
    });
    const res = await call('POST', '/payments/paystation/ipn', { body, csrf: false });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ received: true });
    expect((await payment(s.paymentId)).status).toBe(PaymentStatus.pending);
    expect((await job(s.paymentId))?.data).toEqual({ paymentId: s.paymentId, reason: 'ipn' });
    const [recorded] = await events(s.paymentId, 'ipn');
    expect(recorded).toMatchObject({ outcome: 'verify_requested', trxStatus: 'success' });
    expect(recorded?.payload).toMatchObject({ payer_mobile_no: '***678', trx_amount: 400 });
  });

  it('a repeat for a payment already paid with the same trx_id is a duplicate: 200 and no check', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    await env.verifier.verify(s.paymentId, 'callback');
    await env.queue.obliterate({ force: true });
    const body = ipnBody(s.invoiceNumber, checkout(env, s.invoiceNumber).trxId);
    expect((await call('POST', '/payments/paystation/ipn', { body, csrf: false })).status).toBe(
      200,
    );
    expect((await events(s.paymentId, 'ipn')).map((e) => e.outcome)).toEqual(['duplicate']);
    expect(await job(s.paymentId)).toBeUndefined();
  });

  it('an unknown invoice: 200, recorded with only the documented fields', async () => {
    const invoice = 'TUNKNOWN0000000002';
    const body = ipnBody(invoice, 'trx-unknown', { note: 'x'.repeat(500) });
    expect((await call('POST', '/payments/paystation/ipn', { body, csrf: false })).status).toBe(
      200,
    );
    const recorded = await env.prisma.paymentEvent.findFirstOrThrow({
      where: { invoiceNumber: invoice, source: 'ipn' },
    });
    expect(recorded).toMatchObject({ paymentId: null, outcome: 'unknown_invoice' });
    expect(Object.keys(recorded.payload as object).sort()).toEqual(
      [
        'invoice_number',
        'order_date_time',
        'payment_method',
        'trx_amount',
        'trx_id',
        'trx_status',
      ].sort(),
    );
  });

  it('refuses a body over 16 KB with 413', async () => {
    const body = ipnBody('TUNKNOWN0000000003', 'trx', { pad: 'x'.repeat(17_000) });
    expect((await call('POST', '/payments/paystation/ipn', { body, csrf: false })).status).toBe(
      413,
    );
  });
});

describe('recheck', () => {
  it('POST /registrations/current/recheck: the cookie only, CSRF-checked, one check per 10 s', async () => {
    expect((await call('POST', '/registrations/current/recheck')).status).toBe(404);
    const s = await startRegistration(env);
    expect(
      (await call('POST', '/registrations/current/recheck', { cookie: s.cookie, csrf: false }))
        .status,
    ).toBe(403);
    const first = await call('POST', '/registrations/current/recheck', { cookie: s.cookie });
    expect(first.status).toBe(202);
    expect(await json(first)).toEqual({ requested: true });
    expect((await job(s.paymentId))?.data).toEqual({ paymentId: s.paymentId, reason: 'recheck' });
    const second = await call('POST', '/registrations/current/recheck', { cookie: s.cookie });
    expect(await json(second)).toEqual({ requested: false });
  });

  it('POST /payments/:id/recheck: the owner only (another user gets 404), a session required', async () => {
    const owner = await loginAs(env, 'student');
    const other = await loginAs(env, 'student');
    const a = await makeRegistrationAttempt(env.prisma);
    const p = await env.prisma.payment.create({
      data: paymentData(a.id, { userId: owner.id, gatewayAccount: 'test-fake' }),
    });
    await env.prisma.payment.update({
      where: { id: p.id },
      data: { status: PaymentStatus.pending, paymentUrl: 'https://checkout.test.invalid/p' },
    });
    expect((await call('POST', `/payments/${p.id}/recheck`)).status).toBe(401);
    expect((await call('POST', `/payments/${p.id}/recheck`, { cookie: other.cookie })).status).toBe(
      404,
    );
    const res = await call('POST', `/payments/${p.id}/recheck`, { cookie: owner.cookie });
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ requested: true });
  });
});

describe('admin payments', () => {
  it('lists with filters, paginated; admin only (manager and student 403, no session 401)', async () => {
    const s = await startRegistration(env);
    const list = async (q: string) =>
      (await json(await call('GET', `/admin/payments?${q}`, { cookie: admin.cookie }))) as {
        items: { id: string; pendingRegistration: { email: string } }[];
        total: number;
        pageSize: number;
      };
    expect((await list(`invoice=${s.invoiceNumber}`)).items.map((p) => p.id)).toEqual([
      s.paymentId,
    ]);
    expect((await list(`phone=%2B88${s.phone}`)).items.map((p) => p.id)).toEqual([s.paymentId]);
    expect((await list(`email=${s.email.toUpperCase()}`)).items[0]?.pendingRegistration.email).toBe(
      s.email,
    );
    expect((await list('pageSize=1')).items).toHaveLength(1);
    const reviewed = await list('review=1');
    expect(reviewed.items.every((p) => p.id !== s.paymentId)).toBe(true);
    expect(
      (await call('GET', '/admin/payments?pageSize=500', { cookie: admin.cookie })).status,
    ).toBe(400);

    for (const role of ['manager', 'student'] as const) {
      const { cookie } = await loginAs(env, role);
      expect((await call('GET', '/admin/payments', { cookie })).status).toBe(403);
      expect((await call('GET', '/admin/settings', { cookie })).status).toBe(403);
    }
    expect((await call('GET', '/admin/payments')).status).toBe(401);
  });

  it('GET :id shows the events; recheck asks for a check and is audited', async () => {
    const s = await startRegistration(env);
    const one = await json(
      await call('GET', `/admin/payments/${s.paymentId}`, { cookie: admin.cookie }),
    );
    expect(one.payment).toMatchObject({ id: s.paymentId, status: 'pending' });
    expect((one.events as { source: string }[]).map((e) => e.source)).toContain('initiate');

    const res = await call('POST', `/admin/payments/${s.paymentId}/recheck`, {
      cookie: admin.cookie,
    });
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ requested: true });
    expect((await job(s.paymentId))?.data).toEqual({ paymentId: s.paymentId, reason: 'admin' });
    expect(
      await env.prisma.auditLog.count({
        where: { action: 'payments.recheck_requested', actorId: admin.id, entityId: s.paymentId },
      }),
    ).toBe(1);
  });
});

describe('admin reconcile (lead, 2026-10-31)', () => {
  const reconcile = (id: string, body: unknown, cookie = admin.cookie) =>
    call('POST', `/admin/payments/${id}/reconcile`, { body, cookie });
  const body = { trxId: 'PANEL-TRX-0001', reason: 'Checked in the PayStation merchant panel' };

  /** A success PayStation reported without a trx_id: the automatic rule stops on success_without_trx_id. */
  async function successWithoutTrxId() {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    checkout(env, s.invoiceNumber).trxId = '';
    expect(await env.verifier.verify(s.paymentId, 'callback')).toBe('unknown_status');
    expect(await payment(s.paymentId)).toMatchObject({
      status: 'pending',
      reviewReason: 'success_without_trx_id',
    });
    return s;
  }

  it('settles exactly as the automatic path, once, with the typed trx_id; audited', async () => {
    const s = await successWithoutTrxId();
    const trxId = `PANEL-${Date.now()}`;
    const res = await reconcile(s.paymentId, { ...body, trxId });
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out).toMatchObject({
      applied: true,
      payment: { status: 'paid', trxId, reviewReason: 'manually_reconciled' },
    });
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(await payment(s.paymentId)).toMatchObject({ userId: user.id, paidAmountMinor: 40000 });
    expect(await env.prisma.registration.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await env.prisma.auditLog.findFirst({
        where: { action: 'payments.reconciled', entityId: s.paymentId },
      }),
    ).toMatchObject({ actorId: admin.id, meta: { trxId, outcome: 'manual_paid' } });
    expect((await events(s.paymentId, 'admin')).map((e) => [e.outcome, e.actorId])).toEqual([
      ['manual_paid', admin.id],
    ]);

    // A second call answers the current state and settles nothing.
    const again = await reconcile(s.paymentId, { ...body, trxId: `${trxId}-2` });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ applied: false, payment: { status: 'paid', trxId } });
    expect(await env.prisma.registration.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await env.prisma.auditLog.count({
        where: { action: 'payments.reconciled', entityId: s.paymentId },
      }),
    ).toBe(1);
  });

  it('is refused without a qualifying status answer', async () => {
    const plain = await startRegistration(env);
    const res = await reconcile(plain.paymentId, body);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'RECONCILE_NOT_ALLOWED' });
    // The review reason alone is not enough: PayStation's answer must say so.
    await env.prisma.payment.update({
      where: { id: plain.paymentId },
      data: { reviewReason: 'success_without_trx_id' },
    });
    expect((await reconcile(plain.paymentId, body)).status).toBe(409);
    expect((await payment(plain.paymentId)).status).toBe('pending');
  });

  it('is refused on an amount mismatch and on an invoice mismatch', async () => {
    const s = await startRegistration(env);
    await env.fake.pay(s.invoiceNumber);
    checkout(env, s.invoiceNumber).trxId = '';
    env.fake.scenario.amountDeltaMinor = 100;
    await env.verifier.verify(s.paymentId, 'callback');
    expect((await payment(s.paymentId)).reviewReason).toBe('success_without_trx_id');
    expect((await reconcile(s.paymentId, body)).status).toBe(409);

    env.fake.scenario.amountDeltaMinor = undefined;
    const t = await successWithoutTrxId();
    // A later stored answer for another invoice (as a mix-up would look) blocks it too.
    const [last] = await events(t.paymentId, 'status_v1');
    const data = (last?.payload as { data: Record<string, unknown> }).data;
    await env.prisma.paymentEvent.create({
      data: {
        paymentId: t.paymentId,
        source: 'status_v1',
        invoiceNumber: t.invoiceNumber,
        outcome: 'unknown_status',
        payload: { status_code: '200', data: { ...data, invoice_number: 'TOTHER000000000001' } },
      },
    });
    expect((await reconcile(t.paymentId, body)).status).toBe(409);
    expect((await payment(t.paymentId)).status).toBe('pending');
  });

  it('is refused when the trx_id already belongs to another payment (409 TRX_ID_IN_USE)', async () => {
    const paid = await makePaidPayment(env.prisma);
    const s = await successWithoutTrxId();
    const res = await reconcile(s.paymentId, { ...body, trxId: paid.trxId });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ code: 'TRX_ID_IN_USE' });
    expect(await payment(s.paymentId)).toMatchObject({ status: 'pending', trxId: null });
  });

  it('is admin only, and validates the body', async () => {
    const s = await successWithoutTrxId();
    const manager = await loginAs(env, 'manager');
    expect((await reconcile(s.paymentId, body, manager.cookie)).status).toBe(403);
    expect((await reconcile(s.paymentId, { ...body, reason: 'short' })).status).toBe(400);
    expect((await reconcile(s.paymentId, { ...body, trxId: 'has space' })).status).toBe(400);
    expect((await reconcile(s.paymentId, { ...body, amountMinor: 1 })).status).toBe(400);
    expect((await payment(s.paymentId)).status).toBe('pending');
  });
});

describe('admin settings', () => {
  const put = (key: string, b: unknown, cookie = admin.cookie) =>
    call('PUT', `/admin/settings/${key}`, { body: b, cookie });

  it('changes the fee from the value the admin saw, with a reason: audited, the info cache cleared', async () => {
    const started = await startRegistration(env);
    expect(await json(await call('GET', '/registrations/info'))).toMatchObject({
      fee: { amountMinor: 40000 },
    });
    const list = (await json(
      await call('GET', '/admin/settings', { cookie: admin.cookie }),
    )) as unknown as {
      key: string;
    }[];
    expect(list.map((s) => s.key)).toEqual(
      expect.arrayContaining(['registration_fee_minor', 'registration_open']),
    );

    const res = await put('registration_fee_minor', {
      value: 45000,
      expected: 40000,
      reason: 'Owner decision (test)',
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ key: 'registration_fee_minor', value: 45000 });
    expect(await json(await call('GET', '/registrations/info'))).toMatchObject({
      fee: { amountMinor: 45000 },
    });
    expect((await payment(started.paymentId)).amountMinor).toBe(40000); // the snapshot is kept
    expect(
      await env.prisma.auditLog.findFirst({
        where: { action: 'settings.changed', entityId: 'registration_fee_minor' },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      actorId: admin.id,
      meta: { old: 40000, new: 45000, reason: 'Owner decision (test)' },
    });

    // A form showing the old value cannot overwrite the new one.
    const stale = await put('registration_fee_minor', {
      value: 50000,
      expected: 40000,
      reason: 'Old form',
    });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: 'SETTING_CHANGED' });
    expect(
      (
        await put('registration_fee_minor', {
          value: 40000,
          expected: 45000,
          reason: 'Back to 400',
        })
      ).status,
    ).toBe(200);
  });

  it('refuses invalid values, a missing reason for the fee, unknown keys, a bad window and a manager', async () => {
    const cases: [string, unknown, number][] = [
      ['registration_fee_minor', { value: 45050, expected: 40000, reason: 'Fractional taka' }, 400],
      ['registration_fee_minor', { value: 100, expected: 40000, reason: 'Below 10 BDT' }, 400],
      ['registration_fee_minor', { value: 45000, expected: 40000 }, 400],
      ['registration_open', { value: 'yes', expected: true }, 400],
      ['payment_expiry_minutes', { value: 2, expected: 60 }, 400],
      ['currency', { value: 'USD', expected: 'BDT' }, 404],
      ['registration_open', { value: false }, 400],
      ['registration_open', { value: false, expected: true, role: 'admin' }, 400],
    ];
    for (const [key, b, status] of cases)
      expect([key, (await put(key, b)).status]).toEqual([key, status]);

    expect(
      (await put('registration_closes_at', { value: '2026-11-15T00:00:00Z', expected: null }))
        .status,
    ).toBe(200);
    const bad = await put('registration_opens_at', {
      value: '2026-11-16T00:00:00Z',
      expected: null,
    });
    expect(bad.status).toBe(400);
    expect(
      (await put('registration_closes_at', { value: null, expected: '2026-11-15T00:00:00.000Z' }))
        .status,
    ).toBe(200);

    const manager = await loginAs(env, 'manager');
    expect(
      (await put('registration_open', { value: false, expected: true }, manager.cookie)).status,
    ).toBe(403);
    expect(
      await env.prisma.setting.findUnique({ where: { key: 'registration_open' } }),
    ).toMatchObject({
      value: true,
    });
  });
});
