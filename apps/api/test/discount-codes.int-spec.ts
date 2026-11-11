/**
 * Discount codes (DECISIONS "Discount codes"; payments D1): the admin API (create with Generate, list, edit with the
 * lock after a paid use, delete only unused, the uses page, audit, admin only) and the price at registration (the
 * snapshot on the attempt and payments, rounding and the 10 BDT floor, the limit under the code's row lock, retry
 * keeping the snapshot, the linked ambassador's referral, the public quote with one miss answer and its counter).
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  EDUCATION_TYPES,
  isParticipantId,
  MASKED_PARTICIPANT_ID_PATTERN,
  MIN_PAYABLE_MINOR,
} from '@sirat/shared';
import { quoteMissKey, readQuoteMissFacts } from '../src/modules/payments/discount/quote-misses';
import { makeUser, testPhone } from './helpers';
import {
  bootPaymentsApp,
  caller,
  checkout,
  email,
  loginAs,
  PASSWORD,
  regCookie,
  startRegistration,
  type PaymentsApp,
} from './payments-app';

let env: PaymentsApp;
let admin: { id: string; cookie: string };
const FEE = 40000;

beforeAll(async () => {
  env = await bootPaymentsApp();
  admin = await loginAs(env, 'admin');
}, 60_000);

afterAll(async () => {
  // Demo rows this file made (one batch at a time: exam's demo_batches_one_at_a_time) go the normal way.
  for (const { id } of await env.prisma.demoBatch.findMany({ select: { id: true } })) {
    await env.prisma.demoBatch.update({ where: { id }, data: { status: 'loaded' } });
    await env.prisma.$queryRaw`SELECT demo_clear(${id}::uuid)`;
  }
  await setFee(FEE);
  await env?.close();
});

const call = (...args: Parameters<ReturnType<typeof caller>>) => caller(env.base)(...args);
/** Reads as the one admin; every write as a fresh admin (the admin write tier also counts per user, 20 a minute). */
const asAdmin = async (method: string, path: string, body?: unknown) =>
  call(method, path, {
    cookie: method === 'GET' ? admin.cookie : (await loginAs(env, 'admin')).cookie,
    body,
  });
const setFee = (minor: number) =>
  env.prisma.setting.update({ where: { key: 'registration_fee_minor' }, data: { value: minor } });
const uniqueCode = (prefix = 'T') =>
  `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

type CodeAnswer = {
  id: string;
  code: string;
  kind: string;
  value: number;
  locked: boolean;
  uses: { paid: number; live: number };
  ambassador: { userId: string } | null;
};
/** Answers as the tests read them (fields checked by the expectations themselves). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
const asBody = (v: unknown) => v as Body;

/** A fresh admin per create: the admin write tier also counts per user (20 a minute), and tests make many codes. */
async function newCode(
  body: Record<string, unknown>,
  by?: { cookie: string },
): Promise<CodeAnswer> {
  const actor = by ?? (await loginAs(env, 'admin'));
  const res = await call('POST', '/admin/discount-codes', {
    cookie: actor.cookie,
    body: { kind: 'amount', value: 5000, ...body },
  });
  if (res.status !== 201) throw new Error(`create answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as CodeAnswer;
}

async function approvedAmbassador(over: Record<string, unknown> = {}) {
  const user = await makeUser(env.prisma, { role: 'ambassador', ...over });
  const profile = await env.prisma.ambassadorProfile.create({
    data: { userId: user.id, promoCode: uniqueCode('SR-'), approvedAt: new Date() },
  });
  return { user, profile };
}

function startBody(over: Record<string, unknown> = {}) {
  return {
    startRequestId: randomUUID(),
    name: 'TEST Payer',
    phone: testPhone(),
    email: email(),
    password: PASSWORD,
    district: 'Dhaka',
    institution: 'Sirat Test School',
    educationType: EDUCATION_TYPES[0],
    gradeLevelId: env.gradeLevelId,
    ...over,
  };
}
const rawStart = (over: Record<string, unknown> = {}) =>
  call('POST', '/registrations/start', { body: startBody(over) });
const quote = (promoCode?: string) =>
  call('POST', '/registrations/quote', { body: promoCode === undefined ? {} : { promoCode } });
/** The quote from one fixed address (caller() gives every request a new one), for the per-IP miss count. */
const quoteFrom = (address: string, promoCode: string) =>
  fetch(`${env.base}/api/registrations/quote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': address,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({ promoCode }),
  });

/** A start with this code that PayStation then pays: the registration exists. */
async function paidUse(code: string) {
  const s = await startRegistration(env, { promoCode: code });
  await env.fake.pay(s.invoiceNumber);
  await env.verifier.verify(s.paymentId, 'callback');
  return s;
}

describe('admin: discount codes', () => {
  it('creates a typed code (upper-cased) and a generated one, audits both, lists and reads them', async () => {
    const typed = uniqueCode('eid');
    const a = await newCode(
      { code: typed.toLowerCase(), kind: 'percent', value: 20, note: 'Eid offer' },
      admin,
    );
    expect(a).toMatchObject({
      code: typed.toUpperCase(),
      kind: 'percent',
      value: 20,
      locked: false,
    });
    const g = await newCode({ kind: 'amount', value: 10000, maxUses: 50 }, admin);
    expect(g.code).toMatch(/^DC-[0-9A-HJKMNP-TV-Z]{8}$/);

    const audits = await env.prisma.auditLog.findMany({
      where: { action: 'discount_codes.created', entityId: { in: [a.id, g.id] } },
    });
    expect(audits).toHaveLength(2);
    expect(audits.find((x) => x.entityId === g.id)?.meta).toMatchObject({
      code: g.code,
      kind: 'amount',
      value: 10000,
      maxUses: 50,
      generated: true,
    });
    expect(audits.every((x) => x.actorId === admin.id)).toBe(true);

    const one = await (await asAdmin('GET', `/admin/discount-codes/${a.id}`)).json().then(asBody);
    expect(one).toMatchObject({
      id: a.id,
      uses: { paid: 0, live: 0 },
      demo: false,
      status: 'active',
    });
    const list = await (
      await asAdmin('GET', `/admin/discount-codes?q=${typed.slice(0, 6)}`)
    )
      .json()
      .then(asBody);
    expect(list.items.map((x: CodeAnswer) => x.id)).toContain(a.id);
  });

  it('refuses a bad code, a reserved prefix, a bad value, a backwards window, an unknown field, a duplicate, an ambassador code and a bad link', async () => {
    const status = async (body: Record<string, unknown>) =>
      (await asAdmin('POST', '/admin/discount-codes', { kind: 'amount', value: 5000, ...body }))
        .status;
    expect(await status({ code: 'AB' })).toBe(400);
    expect(await status({ code: 'EID 26' })).toBe(400);
    expect(await status({ code: 'SR-ABC12345' })).toBe(400);
    expect(await status({ code: 'TM-ABC12345' })).toBe(400);
    expect(await status({ kind: 'amount', value: 5050 })).toBe(400); // not whole taka
    expect(await status({ kind: 'percent', value: 100 })).toBe(400);
    expect(await status({ kind: 'percent', value: 0 })).toBe(400);
    expect(await status({ kind: 'free' })).toBe(400);
    expect(
      await status({ startsAt: '2026-12-02T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' }),
    ).toBe(400);
    expect(await status({ demoBatchId: randomUUID() })).toBe(400);
    const taken = await newCode({});
    expect(await status({ code: taken.code })).toBe(409);
    // The code of an ambassador whose code is not SR- (the DB allows it): never a discount code too.
    const odd = await approvedAmbassador();
    const oddCode = uniqueCode('AMB');
    await env.prisma.ambassadorProfile.update({
      where: { userId: odd.user.id },
      data: { promoCode: oddCode },
    });
    expect(await status({ code: oddCode })).toBe(409);
    // A link: an approved, real ambassador only.
    const plain = await makeUser(env.prisma, { role: 'student' });
    expect(await status({ ambassadorUserId: plain.id })).toBe(400);
    const unapproved = await makeUser(env.prisma, { role: 'ambassador' });
    await env.prisma.ambassadorProfile.create({
      data: { userId: unapproved.id, promoCode: uniqueCode('SR-') },
    });
    expect(await status({ ambassadorUserId: unapproved.id })).toBe(400);
    const batch = await env.prisma.demoBatch.create({
      data: { status: 'loaded', reason: 'Discount test' },
    });
    const demo = await approvedAmbassador({
      email: `amb-${randomUUID().slice(0, 8)}@demo.sirat.invalid`,
      demoBatchId: batch.id,
    });
    await env.prisma.demoRecord.create({
      data: { batchId: batch.id, tableName: 'users', rowId: demo.user.id },
    });
    expect(await status({ ambassadorUserId: demo.user.id })).toBe(400);
    const { user: real } = await approvedAmbassador();
    expect(await status({ ambassadorUserId: real.id })).toBe(201);
  });

  it('filters by status, link and part of the code', async () => {
    const now = Date.now();
    const off = await newCode({ active: false });
    const expired = await newCode({
      startsAt: new Date(now - 2 * 86_400_000).toISOString(),
      endsAt: new Date(now - 86_400_000).toISOString(),
    });
    const later = await newCode({ startsAt: new Date(now + 86_400_000).toISOString() });
    const live = await newCode({});
    const { user } = await approvedAmbassador();
    const linked = await newCode({ ambassadorUserId: user.id });
    const ids = async (query: string) =>
      (
        (
          await (
            await asAdmin('GET', `/admin/discount-codes?pageSize=50&${query}`)
          )
            .json()
            .then(asBody)
        ).items as CodeAnswer[]
      ).map((x) => x.id);
    const active = await ids('status=active');
    expect(active).toEqual(expect.arrayContaining([live.id, linked.id]));
    expect(active).not.toEqual(expect.arrayContaining([off.id]));
    expect(active).not.toContain(expired.id);
    expect(active).not.toContain(later.id);
    expect(await ids('status=inactive')).toContain(off.id);
    const byId = async (id: string) =>
      ((await (await asAdmin('GET', `/admin/discount-codes/${id}`)).json().then(asBody)) as Body)
        .status;
    expect([
      await byId(off.id),
      await byId(expired.id),
      await byId(later.id),
      await byId(live.id),
    ]).toEqual(['inactive', 'expired', 'scheduled', 'active']);
    expect(await ids('status=expired')).toContain(expired.id);
    expect(await ids('status=scheduled')).toContain(later.id);
    const withLink = await ids('linked=1');
    expect(withLink).toContain(linked.id);
    expect(withLink).not.toContain(live.id);
    expect(await ids(`q=${live.code.slice(3, 9)}`)).toContain(live.id);
    expect((await asAdmin('GET', '/admin/discount-codes?status=all')).status).toBe(400);
  });

  it('edits limits and notes freely; kind, value and the ambassador lock after a paid use; a used code is only switched off', async () => {
    const c = await newCode({ kind: 'amount', value: 5000 });
    // Before any use: everything editable, and an unused code can be deleted.
    let res = await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, {
      value: 6000,
      note: 'Raised',
    });
    expect(res.status).toBe(200);
    expect(await res.json().then(asBody)).toMatchObject({ value: 6000, note: 'Raised' });
    const updated = await env.prisma.auditLog.findFirstOrThrow({
      where: { action: 'discount_codes.updated', entityId: c.id },
    });
    expect(updated.meta).toMatchObject({
      changed: { value: { from: 5000, to: 6000 }, note: { from: null, to: 'Raised' } },
    });

    await paidUse(c.code);
    const view = (await (
      await asAdmin('GET', `/admin/discount-codes/${c.id}`)
    )
      .json()
      .then(asBody)) as CodeAnswer;
    expect(view).toMatchObject({ locked: true, uses: { paid: 1, live: 0 } });
    res = await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, { value: 7000 });
    expect([res.status, (await res.json().then(asBody)).code]).toEqual([409, 'CODE_LOCKED']);
    res = await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, { kind: 'percent', value: 10 });
    expect(res.status).toBe(409);
    res = await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, {
      maxUses: 10,
      active: false,
      note: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json().then(asBody)).toMatchObject({
      maxUses: 10,
      active: false,
      note: null,
      value: 6000,
    });
    res = await asAdmin('DELETE', `/admin/discount-codes/${c.id}`);
    expect([res.status, (await res.json().then(asBody)).code]).toEqual([409, 'CODE_IN_USE']);

    const unused = await newCode({});
    expect((await asAdmin('DELETE', `/admin/discount-codes/${unused.id}`)).status).toBe(204);
    expect(await env.prisma.discountCode.count({ where: { id: unused.id } })).toBe(0);
    expect(
      await env.prisma.auditLog.count({
        where: { action: 'discount_codes.deleted', entityId: unused.id },
      }),
    ).toBe(1);
    expect((await asAdmin('DELETE', `/admin/discount-codes/${unused.id}`)).status).toBe(404);
  });

  it('lists the paid uses with the participant ID and the totals', async () => {
    const c = await newCode({ kind: 'amount', value: 8000 });
    const a = await paidUse(c.code);
    await paidUse(c.code);
    await startRegistration(env, { promoCode: c.code }); // a checkout in progress: reserved, not paid
    const res = await asAdmin('GET', `/admin/discount-codes/${c.id}/uses?pageSize=1`);
    const body = await res.json().then(asBody);
    expect(body).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totals: { uses: 2, discountMinor: 16000, collectedMinor: 2 * (FEE - 8000) },
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      listAmountMinor: FEE,
      discountMinor: 8000,
      amountMinor: FEE - 8000,
    });
    // Masked by the server: no full participant ID (a login) anywhere in the admin payload.
    expect(body.items[0].participantIdMasked).toMatch(MASKED_PARTICIPANT_ID_PATTERN);
    const registrations = await env.prisma.registration.findMany({
      where: { payment: { discountCodeId: c.id } },
      select: { participantId: true },
    });
    expect(registrations.length).toBeGreaterThan(0);
    const payload = JSON.stringify(body);
    for (const r of registrations) {
      expect(isParticipantId(r.participantId)).toBe(true);
      expect(payload).not.toContain(r.participantId);
      expect(payload).not.toContain(r.participantId.slice(2, 12));
    }
    const user = await env.prisma.user.findUniqueOrThrow({ where: { email: a.email } });
    const all = await (
      await asAdmin('GET', `/admin/discount-codes/${c.id}/uses`)
    )
      .json()
      .then(asBody);
    expect(all.items.map((i: { userId: string }) => i.userId)).toContain(user.id);
    expect(
      (
        (await (
          await asAdmin('GET', `/admin/discount-codes/${c.id}`)
        )
          .json()
          .then(asBody)) as CodeAnswer
      ).uses,
    ).toEqual({
      paid: 2,
      live: 1,
    });
  });

  it('is for admins only', async () => {
    const c = await newCode({});
    for (const role of ['manager', 'student', 'ambassador', 'jury'] as const) {
      const someone = await loginAs(env, role);
      for (const [method, path] of [
        ['GET', '/admin/discount-codes'],
        ['GET', `/admin/discount-codes/${c.id}`],
        ['POST', '/admin/discount-codes'],
        ['PATCH', `/admin/discount-codes/${c.id}`],
        ['DELETE', `/admin/discount-codes/${c.id}`],
      ] as const) {
        const res = await call(method, path, {
          cookie: someone.cookie,
          body:
            method === 'POST' || method === 'PATCH' ? { kind: 'amount', value: 100 } : undefined,
        });
        expect([role, method, path, res.status]).toEqual([role, method, path, 403]);
      }
    }
    expect((await call('GET', '/admin/discount-codes')).status).toBe(401);
  });
});

describe('the price at registration', () => {
  it('an amount code: the attempt and the payment carry list, discount and amount, and PayStation is asked for the discounted amount', async () => {
    const c = await newCode({ kind: 'amount', value: 7500 });
    const s = await startRegistration(env, { promoCode: c.code.toLowerCase() });
    const payment = await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } });
    expect(payment).toMatchObject({
      amountMinor: FEE - 7500,
      listAmountMinor: FEE,
      discountMinor: 7500,
      discountCodeId: c.id,
    });
    const attempt = await env.prisma.pendingRegistration.findUniqueOrThrow({
      where: { id: s.attemptId },
    });
    expect(attempt).toMatchObject({
      listAmountMinor: FEE,
      discountMinor: 7500,
      amountMinor: FEE - 7500,
      discountCodeId: c.id,
    });
    expect(checkout(env, s.invoiceNumber).amountMinor).toBe(FEE - 7500);
    // Without a code: the snapshot is the fee, no discount, no code.
    const plain = await startRegistration(env);
    expect(
      await env.prisma.payment.findUniqueOrThrow({ where: { id: plain.paymentId } }),
    ).toMatchObject({
      amountMinor: FEE,
      listAmountMinor: FEE,
      discountMinor: 0,
      discountCodeId: null,
    });
  });

  it('rounds a percentage down to whole taka, and no code takes the price below 10 BDT', async () => {
    await setFee(41500);
    try {
      const pct = await newCode({ kind: 'percent', value: 33 });
      const s = await startRegistration(env, { promoCode: pct.code });
      expect(
        await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } }),
      ).toMatchObject({
        listAmountMinor: 41500,
        discountMinor: 13600,
        amountMinor: 27900,
      });
      const deep = await newCode({ kind: 'percent', value: 99 });
      const d = await startRegistration(env, { promoCode: deep.code });
      expect(
        (await env.prisma.payment.findUniqueOrThrow({ where: { id: d.paymentId } })).amountMinor,
      ).toBe(MIN_PAYABLE_MINOR);
      const big = await newCode({ kind: 'amount', value: 1_000_000 });
      const b = await startRegistration(env, { promoCode: big.code });
      expect(
        await env.prisma.payment.findUniqueOrThrow({ where: { id: b.paymentId } }),
      ).toMatchObject({
        amountMinor: MIN_PAYABLE_MINOR,
        discountMinor: 41500 - MIN_PAYABLE_MINOR,
      });
    } finally {
      await setFee(FEE);
    }
  });

  it("a linked code is also the ambassador's referral; a plain code refers nobody", async () => {
    const { user } = await approvedAmbassador();
    const linked = await newCode({ ambassadorUserId: user.id });
    const s = await startRegistration(env, { promoCode: linked.code });
    expect(
      (await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: s.attemptId } }))
        .referredById,
    ).toBe(user.id);
    const plain = await newCode({});
    const p = await startRegistration(env, { promoCode: plain.code });
    expect(
      (await env.prisma.pendingRegistration.findUniqueOrThrow({ where: { id: p.attemptId } }))
        .referredById,
    ).toBeNull();
  });

  it('an inactive, expired, scheduled, demo or unknown code is PROMO_INVALID and starts nothing; the quote answers the same and counts the miss', async () => {
    const now = Date.now();
    const off = await newCode({ active: false });
    const expired = await newCode({
      startsAt: new Date(now - 2 * 86_400_000).toISOString(),
      endsAt: new Date(now - 60_000).toISOString(),
    });
    const later = await newCode({ startsAt: new Date(now + 3_600_000).toISOString() });
    const batch =
      (await env.prisma.demoBatch.findFirst()) ??
      (await env.prisma.demoBatch.create({ data: { status: 'loaded', reason: 'Discount test' } }));
    const demo = await env.prisma.discountCode.create({
      data: {
        code: uniqueCode('DEMO'),
        kind: 'amount',
        value: 5000,
        createdById: admin.id,
        demoBatchId: batch.id,
      },
    });
    await env.prisma.demoRecord.create({
      data: { batchId: batch.id, tableName: 'discount_codes', rowId: demo.id },
    });
    const guesser = `2001:db8:feed::${randomUUID().slice(0, 4)}`;
    const misses = [off.code, expired.code, later.code, demo.code, 'NO-SUCH-CODE'];
    for (const code of misses) {
      const body = startBody({ promoCode: code });
      const res = await call('POST', '/registrations/start', { body });
      expect([code, res.status, (await res.json().then(asBody)).code]).toEqual([
        code,
        400,
        'PROMO_INVALID',
      ]);
      expect(
        await env.prisma.pendingRegistration.count({
          where: { startRequestId: body.startRequestId },
        }),
      ).toBe(0);
      const q = await quoteFrom(guesser, code);
      expect([code, q.status, await q.json().then(asBody)]).toEqual([
        code,
        400,
        expect.objectContaining({
          code: 'PROMO_INVALID',
          message: 'This promo code is not valid. Check it or remove it.',
        }),
      ]);
    }
    // Counted per hashed address, never the address itself; ops-check sees this address at the top.
    const key = quoteMissKey(Math.floor(Date.now() / 3_600_000));
    const hashed = createHash('sha256').update(guesser).digest('hex').slice(0, 16);
    expect(Number(await env.cache.zscore(key, hashed))).toBe(misses.length);
    expect(await env.cache.zscore(key, guesser)).toBeNull();
    expect((await readQuoteMissFacts(env.cache, Date.now())).maxMissesPerIp).toBeGreaterThanOrEqual(
      misses.length,
    );
  });

  it('the limit: a checkout in progress reserves a use, two starts at once take the last use once, an expired checkout frees it', async () => {
    const c = await newCode({ maxUses: 1 });
    const first = await startRegistration(env, { promoCode: c.code });
    const res = await rawStart({ promoCode: c.code });
    expect([res.status, (await res.json().then(asBody)).code]).toEqual([400, 'PROMO_INVALID']);
    expect((await quote(c.code)).status).toBe(400);
    // The first checkout expires: its reserved use is free again.
    await env.prisma.payment.update({
      where: { id: first.paymentId },
      data: { status: 'expired' },
    });
    expect((await quote(c.code)).status).toBe(200);
    const racing = await Promise.all([
      rawStart({ promoCode: c.code }),
      rawStart({ promoCode: c.code }),
    ]);
    expect(racing.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(
      await env.prisma.payment.count({
        where: { discountCodeId: c.id, status: { in: ['initiated', 'pending'] } },
      }),
    ).toBe(1);
  });

  it('retry keeps the price after a fee or code change; a code used up meanwhile is PROMO_USED_UP', async () => {
    const c = await newCode({ kind: 'amount', value: 9000, maxUses: 1 });
    const a = await startRegistration(env, { promoCode: c.code });
    await env.prisma.payment.update({ where: { id: a.paymentId }, data: { status: 'failed' } });
    await setFee(50000);
    try {
      // Switched off and the fee raised: the retry still charges the price quoted at start.
      await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, { active: false });
      let res = await call('POST', '/registrations/current/retry', { cookie: a.cookie });
      expect(res.status).toBe(201);
      const retried = await env.prisma.payment.findFirstOrThrow({
        where: { pendingRegistrationId: a.attemptId, NOT: { id: a.paymentId } },
      });
      expect(retried).toMatchObject({
        amountMinor: FEE - 9000,
        listAmountMinor: FEE,
        discountMinor: 9000,
        discountCodeId: c.id,
      });

      // That checkout fails too; meanwhile another student takes the only use.
      await env.prisma.payment.update({ where: { id: retried.id }, data: { status: 'failed' } });
      await asAdmin('PATCH', `/admin/discount-codes/${c.id}`, { active: true });
      const b = await startRegistration(env, { promoCode: c.code });
      expect(
        (await env.prisma.payment.findUniqueOrThrow({ where: { id: b.paymentId } })).amountMinor,
      ).toBe(50000 - 9000);
      res = await call('POST', '/registrations/current/retry', { cookie: a.cookie });
      const body = await res.json().then(asBody);
      expect([res.status, body.code]).toEqual([409, 'PROMO_USED_UP']);
      expect(body.message).toBe(
        'This code has reached its limit. Start again without it or with another code.',
      );
    } finally {
      await setFee(FEE);
    }
  });

  it('an attempt from before discount codes (no snapshot) retries at the current fee', async () => {
    const s = await startRegistration(env);
    await env.prisma.payment.update({ where: { id: s.paymentId }, data: { status: 'failed' } });
    await env.prisma.pendingRegistration.update({
      where: { id: s.attemptId },
      data: { listAmountMinor: null, discountMinor: null, amountMinor: null },
    });
    await setFee(45000);
    try {
      const res = await call('POST', '/registrations/current/retry', { cookie: s.cookie });
      expect(res.status).toBe(201);
      const retried = await env.prisma.payment.findFirstOrThrow({
        where: { pendingRegistrationId: s.attemptId, NOT: { id: s.paymentId } },
      });
      expect(retried).toMatchObject({
        amountMinor: 45000,
        listAmountMinor: 45000,
        discountMinor: 0,
      });
    } finally {
      await setFee(FEE);
    }
  });

  it('the quote prices exactly as the start does: no code, an ambassador code, a discount code', async () => {
    expect(await (await quote()).json().then(asBody)).toEqual({
      listAmountMinor: FEE,
      discountMinor: 0,
      amountMinor: FEE,
      currency: 'BDT',
      kind: null,
    });
    const { profile } = await approvedAmbassador();
    expect(await (await quote(profile.promoCode)).json().then(asBody)).toMatchObject({
      amountMinor: FEE,
      kind: null,
    });
    const c = await newCode({ kind: 'percent', value: 25 });
    const q = await quote(c.code);
    expect(q.status).toBe(200);
    const quoted = await q.json().then(asBody);
    expect(quoted).toEqual({
      listAmountMinor: FEE,
      discountMinor: 10000,
      amountMinor: 30000,
      currency: 'BDT',
      kind: 'percent',
    });
    const s = await startRegistration(env, { promoCode: c.code });
    expect(
      (await env.prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).amountMinor,
    ).toBe(quoted.amountMinor);
    expect((await quote('bad code!')).status).toBe(400); // the start's format rule
    const res = await rawStart({ promoCode: c.code });
    expect(regCookie(res)).toBeDefined();
  });
});
