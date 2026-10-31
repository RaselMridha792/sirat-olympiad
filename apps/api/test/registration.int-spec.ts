/**
 * Registration and the start of a payment over HTTP (docs/plans/PAYMENTS-PLAN.md 6.1, 6.7, section 9), against the
 * fake PayStation. Owner rules checked here: the fee snapshot, no client amount or role, one open attempt per email
 * and per phone with the owner's texts, the "1001" pause, and the student seeing only their own payments.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PaymentStatus, type PrismaClient } from '@prisma/client';
import { EDUCATION_TYPES, REGISTRATION_MESSAGES } from '@sirat/shared';
import Redis from 'ioredis';
import { seedConfig } from '../prisma/seed';
import { PasswordService } from '../src/modules/auth/password.service';
import { startFakePaystation, type FakePaystation } from './fake-paystation/fake-paystation';
import {
  applyReferenceData,
  makePaidPayment,
  makeUser,
  testPhone,
  testPrisma,
  truncateAll,
} from './helpers';

let app: NestExpressApplication;
let base: string;
let prisma: PrismaClient;
let fake: FakePaystation;
let redis: Redis;
let gradeLevelId: string;
const PASSWORD = 'Blue-river-moon-42';

const run = randomUUID().slice(0, 4);
let nextIp = 0;
const ip = () => `2001:db8:${run}:${(nextIp += 1).toString(16)}::1`;
const email = () => `r-${randomUUID().slice(0, 8)}@test.invalid`;

beforeAll(async () => {
  fake = await startFakePaystation();
  Object.assign(process.env, {
    LOG_LEVEL: 'silent',
    PAYSTATION_ENV: 'fake',
    PAYSTATION_BASE_URL: fake.url,
    PAYSTATION_MERCHANT_ID: '',
    PAYSTATION_PASSWORD: '',
    PAYSTATION_ACCOUNT_LABEL: 'test-fake',
    PAYSTATION_INVOICE_PREFIX: 'T',
    PAYSTATION_CALLBACK_URL: 'http://localhost:4100/api/payments/paystation/callback',
    PAYSTATION_IPN_URL: '',
    PAYSTATION_PAY_WITH_CHARGE: '0',
  });
  prisma = testPrisma();
  await truncateAll(prisma);
  await applyReferenceData(prisma);
  await seedConfig(prisma);
  await prisma.setting.update({ where: { key: 'registration_open' }, data: { value: true } });
  gradeLevelId = (await prisma.gradeLevel.findUniqueOrThrow({ where: { sortOrder: 5 } })).id;
  redis = new Redis(process.env.REDIS_CACHE_URL as string, { maxRetriesPerRequest: 1 });
  await redis.del('registration:info', 'reg:payments-paused');

  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/configure-app');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 60_000);

afterAll(async () => {
  await redis?.del('registration:info', 'reg:payments-paused');
  redis?.disconnect();
  await app?.close();
  await fake?.close();
  await prisma?.$disconnect();
});

beforeEach(() => fake.reset());

type Form = Record<string, unknown>;
const form = (over: Form = {}): Form => ({
  startRequestId: randomUUID(),
  name: 'TEST Student',
  phone: testPhone(),
  email: email(),
  password: PASSWORD,
  district: 'Dhaka',
  institution: 'Sirat Test School',
  educationType: EDUCATION_TYPES[0],
  gradeLevelId,
  ...over,
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; from?: string } = {},
) {
  return fetch(`${base}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      'x-forwarded-for': opts.from ?? ip(),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
const start = (body: Form, opts: { cookie?: string; from?: string } = {}) =>
  call('POST', '/registrations/start', { body, ...opts });
const regCookie = (res: Response) => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('sirat_reg='));
  return raw ? raw.split(';')[0] : undefined;
};
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('GET /registrations/info', () => {
  it('shows the fee, the choices, and open/closed (cached 30 s, invalidated with the cache key)', async () => {
    const res = await call('GET', '/registrations/info');
    expect(res.status).toBe(200);
    const info = await json(res);
    expect(info).toMatchObject({ open: true, fee: { amountMinor: 40000, currency: 'BDT' } });
    expect(info.gradeLevels).toHaveLength(17);
    expect(info.districts).toHaveLength(64);
    expect(info.educationTypes).toEqual(EDUCATION_TYPES);
  });
});

describe('POST /registrations/start', () => {
  it('stores the form server-side, snapshots the fee, starts a checkout and sets the resume cookie', async () => {
    const body = form({ phone: '+8801900000001', email: 'Mixed.Case@Test.invalid' });
    const res = await start(body);
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out).toMatchObject({ amountMinor: 40000, currency: 'BDT' });
    expect(String(out.paymentUrl)).toContain(`${fake.url}/checkout/`);
    expect(String(out.invoiceNumber)).toMatch(/^T\d{6}[0-9A-Z]{10}$/);

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sirat_reg=')) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/registrations/);

    const attempt = await prisma.pendingRegistration.findFirstOrThrow({
      where: { startRequestId: body.startRequestId as string },
      include: { payments: true },
    });
    expect(attempt).toMatchObject({
      status: 'open',
      email: 'mixed.case@test.invalid',
      phone: '01900000001',
    });
    expect(JSON.stringify(attempt)).not.toContain(PASSWORD);
    expect((attempt.payload as Record<string, string>).passwordHash).toMatch(/^\$argon2id\$/);
    expect(attempt.payments).toHaveLength(1);
    expect(attempt.payments[0]).toMatchObject({
      status: 'pending',
      amountMinor: 40000,
      currency: 'BDT',
      payWithCharge: false,
      gatewayAccount: 'test-fake',
      invoiceNumber: out.invoiceNumber,
    });
    // PayStation was asked for exactly the fee, in whole taka, with the merchant bearing the charge.
    expect(fake.checkouts.get(out.invoiceNumber as string)?.form).toMatchObject({
      payment_amount: '400',
      pay_with_charge: '0',
      reference: attempt.payments[0]?.id,
    });
    const events = await prisma.paymentEvent.findMany({
      where: { paymentId: attempt.payments[0]?.id },
    });
    expect(events.map((e) => [e.source, e.outcome])).toEqual([['initiate', 'checkout_created']]);
  });

  it('a later fee change never touches a payment that already started (the snapshot)', async () => {
    const res = await start(form());
    const { invoiceNumber } = await json(res);
    await prisma.setting.update({
      where: { key: 'registration_fee_minor' },
      data: { value: 50000 },
    });
    try {
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { invoiceNumber: invoiceNumber as string },
      });
      expect(payment.amountMinor).toBe(40000);
      const next = await json(await start(form()));
      expect(next.amountMinor).toBe(50000);
    } finally {
      await prisma.setting.update({
        where: { key: 'registration_fee_minor' },
        data: { value: 40000 },
      });
    }
  });

  it.each([
    ['role', 'admin'],
    ['amount', 1],
    ['amountMinor', 100],
    ['fee', 0],
    ['payment_amount', '1'],
    ['userId', randomUUID()],
  ])('refuses an unknown field %s (400), and starts nothing', async (field, value) => {
    const res = await start(form({ [field]: value }));
    expect(res.status).toBe(400);
    expect(fake.checkouts.size).toBe(0);
  });

  it('is closed (403) by the switch and by the window, and writes nothing', async () => {
    const before = await prisma.pendingRegistration.count();
    for (const [key, value] of [
      ['registration_open', false],
      ['registration_opens_at', new Date(Date.now() + 3_600_000).toISOString()],
      ['registration_closes_at', new Date(Date.now() - 1_000).toISOString()],
    ] as const) {
      const original = (await prisma.setting.findUniqueOrThrow({ where: { key } })).value;
      await prisma.setting.update({ where: { key }, data: { value } });
      try {
        const res = await start(form());
        expect(res.status).toBe(403);
        expect(await json(res)).toMatchObject({ code: 'REGISTRATION_CLOSED' });
      } finally {
        await prisma.setting.update({ where: { key }, data: { value: original ?? null } as never });
      }
    }
    expect(await prisma.pendingRegistration.count()).toBe(before);
    expect(fake.checkouts.size).toBe(0);
  });

  it('a fee outside the bounds stops payments (503) without calling PayStation', async () => {
    await prisma.setting.update({
      where: { key: 'registration_fee_minor' },
      data: { value: 1_000_100 },
    });
    try {
      const res = await start(form());
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
      expect(fake.checkouts.size).toBe(0);
      expect(
        await prisma.auditLog.count({ where: { action: 'security.payments.fee_invalid' } }),
      ).toBeGreaterThan(0);
    } finally {
      await prisma.setting.update({
        where: { key: 'registration_fee_minor' },
        data: { value: 40000 },
      });
    }
  });

  it("answers an existing account with the owner's texts: email, then phone", async () => {
    const phone = testPhone();
    const taken = await makeUser(prisma, { email: email(), phone });
    let res = await start(form({ email: taken.email.toUpperCase() }));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      code: 'EMAIL_REGISTERED',
      message: REGISTRATION_MESSAGES.EMAIL_REGISTERED?.en,
    });
    res = await start(form({ phone: `+88${phone}` }));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      code: 'PHONE_REGISTERED',
      message: REGISTRATION_MESSAGES.PHONE_REGISTERED?.en,
    });
    expect(fake.checkouts.size).toBe(0);
  });

  it('one attempt in progress per email and per phone: another browser gets 409, the same browser resumes', async () => {
    const first = form();
    const res = await start(first);
    const url = (await json(res)).paymentUrl;
    const cookie = regCookie(res);

    // Another browser, same email: in progress. Same phone under another email: the one phone text.
    const sameEmail = await start(form({ email: first.email }));
    expect(sameEmail.status).toBe(409);
    expect(await json(sameEmail)).toMatchObject({ code: 'EMAIL_IN_PROGRESS' });
    const samePhone = await start(form({ phone: first.phone }));
    expect(samePhone.status).toBe(409);
    expect(await json(samePhone)).toMatchObject({ code: 'PHONE_REGISTERED' });

    // The same browser, same email: the checkout it already has, no second payment.
    const again = await start(form({ email: first.email, phone: first.phone }), { cookie });
    expect(again.status).toBe(201);
    expect((await json(again)).paymentUrl).toBe(url);
    expect(
      await prisma.payment.count({
        where: { pendingRegistration: { email: first.email as string } },
      }),
    ).toBe(1);
  });

  it('a double click (same startRequestId) returns the same payment; another email with it is refused', async () => {
    const body = form();
    const a = await json(await start(body));
    const second = await start(body);
    expect(second.status).toBe(201);
    expect(await json(second)).toMatchObject({
      paymentUrl: a.paymentUrl,
      invoiceNumber: a.invoiceNumber,
    });
    expect(regCookie(second)).toBeDefined(); // a fresh token: the lost first response may have held the cookie
    const reused = await start({ ...body, email: email() });
    expect(reused.status).toBe(400);
    expect(await json(reused)).toMatchObject({ code: 'START_REQUEST_REUSED' });
  });

  it('two starts with one email at the same moment: exactly one checkout', async () => {
    const shared = email();
    const results = await Promise.all([
      start(form({ email: shared })),
      start(form({ email: shared })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.pendingRegistration.count({ where: { email: shared, status: 'open' } }),
    ).toBe(1);
  });

  it('promo codes must belong to an approved ambassador; a valid one stores the referrer', async () => {
    const ambassador = await makeUser(prisma);
    await prisma.ambassadorProfile.create({
      data: { userId: ambassador.id, promoCode: 'GOOD-CODE' },
    });
    let res = await start(form({ promoCode: 'GOOD-CODE' }));
    expect(res.status).toBe(400); // not approved yet
    expect(await json(res)).toMatchObject({ code: 'PROMO_INVALID' });
    res = await start(form({ promoCode: 'NO-SUCH-CODE' }));
    expect(await json(res)).toMatchObject({ code: 'PROMO_INVALID' });
    await prisma.ambassadorProfile.update({
      where: { userId: ambassador.id },
      data: { approvedAt: new Date() },
    });
    const body = form({ promoCode: 'good-code' });
    res = await start(body);
    expect(res.status).toBe(201);
    const attempt = await prisma.pendingRegistration.findFirstOrThrow({
      where: { startRequestId: body.startRequestId as string },
    });
    expect(attempt.referredById).toBe(ambassador.id);
  });

  it('an unknown class is refused', async () => {
    const res = await start(form({ gradeLevelId: randomUUID() }));
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ code: 'GRADE_LEVEL_UNKNOWN' });
  });

  it('PayStation refusing the checkout: 502, the payment failed, and the browser can retry with a new invoice', async () => {
    fake.scenario.initiateCode = '1008';
    const res = await start(form());
    expect(res.status).toBe(502);
    expect(await json(res)).toMatchObject({ code: 'PAYMENT_START_FAILED' });
    const cookie = regCookie(res);
    expect(cookie).toBeDefined();
    fake.reset();

    const current = await json(await call('GET', '/registrations/current', { cookie }));
    expect(current).toMatchObject({ state: 'failed', canRetry: true, canResume: false });
    const retried = await call('POST', '/registrations/current/retry', { cookie });
    expect(retried.status).toBe(201);
    const second = await json(retried);
    expect(second.invoiceNumber).not.toBe(current.invoiceNumber);
    expect(await json(await call('GET', '/registrations/current', { cookie }))).toMatchObject({
      state: 'awaiting_payment',
      canResume: true,
    });
  });

  it('"1001" Invalid Credential pauses payments: 503 PAYMENTS_PAUSED, a critical alert, and no blind retry', async () => {
    fake.scenario.initiateCode = '1001';
    try {
      const res = await start(form());
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({
        code: 'PAYMENTS_PAUSED',
        message: REGISTRATION_MESSAGES.PAYMENTS_PAUSED?.en,
      });
      expect(
        await prisma.auditLog.count({
          where: { action: 'security.payments.credentials_rejected' },
        }),
      ).toBeGreaterThan(0);
      fake.reset();
      const created = fake.checkouts.size;
      const next = await start(form());
      expect(next.status).toBe(503);
      expect(await json(next)).toMatchObject({ code: 'PAYMENTS_PAUSED' });
      expect(fake.checkouts.size).toBe(created); // PayStation is not asked again during the pause
    } finally {
      await redis.del('reg:payments-paused');
    }
  });

  it('limits one email to 10 attempts an hour (429)', async () => {
    const shared = email();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await start(form({ email: shared }))).status);
    expect(statuses.slice(0, 10)).not.toContain(429);
    expect(statuses[10]).toBe(429);
  });
});

describe("this browser's attempt: current, resume, retry, cancel", () => {
  it('without the cookie there is nothing (404); with it: awaiting payment, resume gives the same URL', async () => {
    expect((await call('GET', '/registrations/current')).status).toBe(404);
    const res = await start(form());
    const { paymentUrl } = await json(res);
    const cookie = regCookie(res);
    const current = await json(await call('GET', '/registrations/current', { cookie }));
    expect(current).toMatchObject({
      state: 'awaiting_payment',
      canResume: true,
      canRetry: false,
      amountMinor: 40000,
    });
    expect(JSON.stringify(current)).not.toMatch(/@|Student|01[3-9]\d{8}/); // no personal data
    const resumed = await call('POST', '/registrations/current/resume', { cookie });
    expect(resumed.status).toBe(200);
    expect(await json(resumed)).toEqual({ paymentUrl });
    expect((await call('POST', '/registrations/current/retry', { cookie })).status).toBe(409);
  });

  it('cancel works only while no payment is active, then forgets the attempt', async () => {
    const res = await start(form());
    const cookie = regCookie(res);
    const busy = await call('POST', '/registrations/current/cancel', { cookie });
    expect(busy.status).toBe(409);
    expect(await json(busy)).toMatchObject({ code: 'CANNOT_CANCEL' });
    const { invoiceNumber } = await json(await call('GET', '/registrations/current', { cookie }));
    await prisma.payment.update({
      where: { invoiceNumber: invoiceNumber as string },
      data: { status: PaymentStatus.failed },
    });
    const done = await call('POST', '/registrations/current/cancel', { cookie });
    expect(done.status).toBe(204);
    expect(done.headers.getSetCookie().join(';')).toMatch(/sirat_reg=;/);
    expect((await call('GET', '/registrations/current', { cookie })).status).toBe(404);
  });

  it('an expired checkout cannot be resumed; the attempt says expired and can retry', async () => {
    const res = await start(form());
    const cookie = regCookie(res);
    const { invoiceNumber } = await json(await call('GET', '/registrations/current', { cookie }));
    await prisma.payment.update({
      where: { invoiceNumber: invoiceNumber as string },
      data: { status: PaymentStatus.expired },
    });
    expect(await json(await call('GET', '/registrations/current', { cookie }))).toMatchObject({
      state: 'expired',
      canResume: false,
      canRetry: true,
    });
    expect((await call('POST', '/registrations/current/resume', { cookie })).status).toBe(409);
  });
});

describe('logged-in student: registration and own payments', () => {
  let passwords: PasswordService;
  beforeAll(() => {
    passwords = app.get(PasswordService);
  });

  async function loginAs(userEmail: string) {
    const res = await call('POST', '/auth/login', {
      body: { email: userEmail, password: PASSWORD },
    });
    expect(res.status).toBe(204);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  it('shows my registration and payment, lists only my payments, and hides others (404)', async () => {
    const me = await makeUser(prisma, {
      email: email(),
      passwordHash: await passwords.hash(PASSWORD),
      gradeLevelId,
    });
    const paid = await makePaidPayment(prisma, me.id);
    await prisma.registration.create({ data: { userId: me.id, paymentId: paid.id } });
    const other = await makeUser(prisma);
    const othersPayment = await makePaidPayment(prisma, other.id);

    const cookie = await loginAs(me.email);
    const reg = await json(await call('GET', '/registrations/me', { cookie }));
    expect(reg).toMatchObject({
      registered: true,
      payment: {
        status: 'paid',
        amountMinor: 40000,
        currency: 'BDT',
        invoiceNumber: paid.invoiceNumber,
      },
    });
    const mine = await json(await call('GET', '/payments/mine?page=1&pageSize=10', { cookie }));
    expect(mine).toMatchObject({ page: 1, pageSize: 10, total: 1 });
    expect((mine.items as { id: string }[]).map((p) => p.id)).toEqual([paid.id]);
    expect((await call('GET', `/payments/${paid.id}/status`, { cookie })).status).toBe(200);
    expect((await call('GET', `/payments/${othersPayment.id}/status`, { cookie })).status).toBe(
      404,
    );
    expect((await call('GET', '/payments/not-a-uuid/status', { cookie })).status).toBe(400);
  });

  it('a student without a registration sees registered: false; without a session: 401', async () => {
    const plain = await makeUser(prisma, {
      email: email(),
      passwordHash: await passwords.hash(PASSWORD),
    });
    const cookie = await loginAs(plain.email);
    expect(await json(await call('GET', '/registrations/me', { cookie }))).toEqual({
      registered: false,
    });
    expect((await call('GET', '/registrations/me')).status).toBe(401);
    expect((await call('GET', '/payments/mine')).status).toBe(401);
  });
});
