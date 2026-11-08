import { randomUUID } from 'node:crypto';
import { PaymentStatus, Prisma, RegistrationAttemptStatus } from '@prisma/client';
import { BD_DISTRICTS, DEMO_ACCOUNT_LABEL, DEMO_INVOICE_PREFIX } from '@sirat/shared';
import type { DemoContext, DemoGenerator, DemoUser } from '../../demo/demo.types';

/*
 * Payments' demo data (DECISIONS 2026-11-08 "Demo payments stay out of the money flow"): registration attempts,
 * payments, registrations and free-book orders for the demo students, so the admin payments page shows every state
 * and the dashboards have registered students. Rows go in through ctx.tx in bulk, never through the services (no audit
 * rows, no emails, no PayStation call), and every row is registered for demo_clear. No payment_events: that table is
 * append-only and could never be cleared.
 */

const FEE_MINOR = 40000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DHAKA_OFFSET_MS = 6 * 60 * MINUTE;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const UPAZILAS = [
  'Mirpur',
  'Savar',
  'Uttara',
  'Kotwali',
  'Sadar',
  'Tongi',
  'Sonargaon',
  'Chandina',
];
const NOTES = ['Call before delivery', 'Leave it with the school office', null, null, null];
const BOOK_TITLE_KEY = 'book_title';
const BOOK_TITLE_FALLBACK = 'Sirat Leadership Olympiad book';

/** What a demo student gets. 'refund' is a paid payment with review_reason refund_reported (no refunded status). */
type Plan = 'paid' | 'refund' | 'failed' | 'expired' | 'pending' | 'none';

/** Shares of the demo students (exam's volumes); the rest ('none') never paid, so the students list shows them too. */
const SHARES: ReadonlyArray<readonly [Plan, number]> = [
  ['paid', 0.8],
  ['failed', 0.05],
  ['expired', 0.05],
  ['pending', 0.03],
  ['refund', 0.02],
];
/** Free-book orders for this share of the paid students (not the refunded); all unshipped (lead). */
const ORDER_SHARE = 0.6;

const yymmdd = (d: Date) =>
  new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().slice(2, 10).replace(/-/g, '');

/**
 * The plan per demo account. Every ambassador is a paid, registered student (approval needs a registration:
 * ambassadors.service), and the students share SHARES. Jury members never register.
 */
function plans(ctx: DemoContext): Map<string, Plan> {
  const out = new Map<string, Plan>(ctx.users.ambassadors.map((a) => [a.id, 'paid']));
  const order = ctx.rng.shuffle(ctx.users.students.filter((s) => !out.has(s.id)));
  let at = 0;
  for (const [kind, share] of SHARES) {
    const n = Math.round(order.length * share);
    for (const s of order.slice(at, at + n)) out.set(s.id, kind);
    at += n;
  }
  for (const s of order.slice(at)) out.set(s.id, 'none');
  return out;
}

export const paymentsDemoGenerator: DemoGenerator = {
  area: 'payments',
  dependsOn: ['users'],

  async load(ctx: DemoContext): Promise<void> {
    await ctx.progress('payments');
    const { tx, rng, now } = ctx;
    const plan = plans(ctx);
    const used = new Set<string>();
    const unique = (make: () => string): string => {
      for (;;) {
        const value = make();
        if (!used.has(value)) {
          used.add(value);
          return value;
        }
      }
    };
    const invoice = (at: Date) =>
      unique(
        () =>
          `${DEMO_INVOICE_PREFIX}${yymmdd(at)}${Array.from({ length: 8 }, () => CROCKFORD[rng.int(32)]).join('')}`,
      );

    const attempts: Prisma.PendingRegistrationCreateManyInput[] = [];
    const payments: Prisma.PaymentCreateManyInput[] = [];
    const byPlan = new Map<Plan, string[]>();
    const registrations: Prisma.RegistrationCreateManyInput[] = [];
    const paidStudents: Array<{ student: DemoUser; registrationId: string; paidAt: Date }> = [];

    // One row set per account, even if a later users generator listed someone in both lists.
    const accounts = new Map(
      [...ctx.users.ambassadors, ...ctx.users.students].map((u) => [u.id, u]),
    );
    for (const student of accounts.values()) {
      const kind = plan.get(student.id) ?? 'none';
      if (kind === 'none') continue;
      // A pending one started minutes ago; the rest over the last three weeks. Every date lies before the load's clock.
      const created =
        kind === 'pending'
          ? new Date(now.getTime() - (2 + rng.int(7)) * MINUTE)
          : new Date(now.getTime() - (1 + rng.int(21)) * DAY - rng.int(DAY));
      const paidAt = new Date(created.getTime() + (1 + rng.int(5)) * MINUTE);
      const settled = kind === 'paid' || kind === 'refund';

      const attemptId = randomUUID();
      attempts.push({
        id: attemptId,
        // An open attempt has no user (CHECK: completed exactly when user_id and completed_at are set).
        status: settled ? RegistrationAttemptStatus.completed : RegistrationAttemptStatus.open,
        email: student.email,
        phone: student.phone,
        name: student.name,
        startRequestId: randomUUID(),
        resumeTokenHash: `demo-${randomUUID()}`,
        userId: settled ? student.id : null,
        completedAt: settled ? paidAt : null,
        createdAt: created,
      });

      const paymentId = randomUUID();
      // Inserted as 'initiated' with the final values (no CHECK forbids them there), then moved along the legal path.
      payments.push({
        id: paymentId,
        pendingRegistrationId: attemptId,
        userId: settled ? student.id : null,
        invoiceNumber: invoice(created),
        amountMinor: FEE_MINOR,
        currency: 'BDT',
        payWithCharge: false,
        gatewayAccount: DEMO_ACCOUNT_LABEL,
        gatewayEnv: 'demo',
        paymentUrl: null, // never a checkout: nothing can resume or watch it
        paidAmountMinor: settled ? FEE_MINOR : null,
        trxId: settled ? unique(() => `DEMO${rng.digits(18)}`) : null,
        paidAt: settled ? paidAt : null,
        gatewayStatus: settled
          ? 'successful'
          : kind === 'failed'
            ? 'failed'
            : kind === 'expired'
              ? 'processing'
              : null,
        reviewReason: kind === 'refund' ? 'refund_reported' : null,
        checkCount: kind === 'pending' ? 0 : kind === 'expired' ? 4 : 1,
        lastCheckedAt: kind === 'pending' ? null : paidAt,
        expiresAt: new Date(created.getTime() + 10 * MINUTE),
        createdAt: created,
      });
      byPlan.set(kind, [...(byPlan.get(kind) ?? []), paymentId]);

      if (settled) {
        const registrationId = randomUUID();
        registrations.push({
          id: registrationId,
          userId: student.id,
          paymentId,
          createdAt: paidAt,
        });
        if (kind === 'paid') paidStudents.push({ student, registrationId, paidAt });
      }
    }

    await tx.pendingRegistration.createMany({ data: attempts });
    await ctx.register(
      'pending_registrations',
      attempts.map((a) => a.id as string),
    );
    await tx.payment.createMany({ data: payments });
    const paymentIds = payments.map((p) => p.id as string);
    await ctx.register('payments', paymentIds);

    // The status trigger allows only initiated -> pending -> paid | failed | expired: status-only moves by group.
    const move = (ids: readonly string[], status: PaymentStatus) =>
      ids.length
        ? tx.payment.updateMany({ where: { id: { in: [...ids] } }, data: { status } })
        : null;
    await move(paymentIds, PaymentStatus.pending);
    await move(
      [...(byPlan.get('paid') ?? []), ...(byPlan.get('refund') ?? [])],
      PaymentStatus.paid,
    );
    await move(byPlan.get('failed') ?? [], PaymentStatus.failed);
    await move(byPlan.get('expired') ?? [], PaymentStatus.expired);

    // A registration needs a paid payment of the same user (trigger): after the moves.
    await tx.registration.createMany({ data: registrations });
    await ctx.register(
      'registrations',
      registrations.map((r) => r.id as string),
    );

    const title = await tx.setting.findUnique({ where: { key: BOOK_TITLE_KEY } });
    const bookTitle =
      typeof title?.value === 'string' && title.value.trim() ? title.value : BOOK_TITLE_FALLBACK;
    const orders: Prisma.BookOrderCreateManyInput[] = rng
      .shuffle(paidStudents)
      .slice(0, Math.round(paidStudents.length * ORDER_SHARE))
      .map(({ student, registrationId, paidAt }) => ({
        id: randomUUID(),
        userId: student.id,
        registrationId,
        recipientName: student.name,
        recipientPhone: student.phone,
        district: (BD_DISTRICTS as readonly string[]).includes(student.district)
          ? student.district
          : rng.pick(BD_DISTRICTS),
        upazila: rng.pick(UPAZILAS),
        addressLine: `House ${1 + rng.int(200)}, Road ${1 + rng.int(30)}, Demo Para`,
        note: rng.pick(NOTES),
        bookTitle,
        confirmedAt: new Date(paidAt.getTime() + (5 + rng.int(60 * 24)) * MINUTE),
        createdAt: new Date(paidAt.getTime() + 5 * MINUTE),
      }));
    // An order confirmed after the load's clock would look like the future: keep every date before `now`.
    for (const o of orders)
      if ((o.confirmedAt as Date).getTime() >= now.getTime()) o.confirmedAt = o.createdAt;
    await tx.bookOrder.createMany({ data: orders });
    await ctx.register(
      'book_orders',
      orders.map((o) => o.id as string),
    );
  },
};
