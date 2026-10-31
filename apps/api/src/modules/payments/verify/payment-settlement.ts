import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  RegistrationAttemptStatus,
  type Payment,
  type PendingRegistration,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecurityAlerts } from '../../audit/security-alerts.service';
import type { GatewayRaw } from '../gateway/payment-gateway';
import type { Decision } from '../payment-decision';
import { RegistrationEmails } from './registration-emails';

/** What gets written to payment_events with the change (one row per check or admin action). */
export type PaymentEventInput = {
  source: 'status_v1' | 'admin';
  statusCode: string | null;
  trxStatus: string | null;
  trxId: string | null;
  payload: GatewayRaw;
  actorId?: string | null;
};

/** Decides under the payment's row lock (the row as it is now, not as it was before the PayStation call). */
export type Decider = (
  locked: Payment,
  tx: Prisma.TransactionClient,
) => Decision | Promise<Decision>;

export type SettleResult = {
  /** The outcome recorded in payment_events. */
  outcome: string;
  status: PaymentStatus;
  /** True when this call changed the payment's status. */
  applied: boolean;
  reviewReason: string | null;
  alert: 'critical' | 'warn' | null;
  /** The account this call created, if any. */
  userId: string | null;
};

type NewAccount = { id: string; email: string; name: string };
type Clash = 'email' | 'phone' | 'trx_id';

/** The form stored on the attempt at start (registration.service.ts createAttempt). */
type AttemptForm = {
  district: string;
  institution: string;
  educationType: string;
  gradeLevelId: string;
  passwordHash: string;
};

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/**
 * Applies a decision about one payment (plan 6.3 step 4; RULEBOOK §8, §18). The only code that marks a payment paid
 * or failed, used by the worker's verify job and by the admin reconcile. Each call is one transaction under
 * `SELECT … FOR UPDATE`, so a callback, an IPN and a reconciliation run on the same payment make one transition.
 *
 * On paid, the attempt is consumed in the same transaction: an open attempt becomes the student's account (role
 * always student), its registration and the payment's user; the stored form, password hash included, is cleared.
 * Money taken always wins: when the account cannot be made (the email or phone got an account meanwhile), or the
 * attempt was already completed or abandoned, the payment is still paid, set aside for an admin with a reason, and a
 * critical alert goes out. Never a refund path (owner: no refund handling).
 */
@Injectable()
export class PaymentSettlement {
  private readonly logger = new Logger('PaymentSettlement');

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SecurityAlerts,
    private readonly audit: AuditService,
    private readonly emails: RegistrationEmails,
  ) {}

  async apply(
    paymentId: string,
    decider: Decider,
    event: PaymentEventInput,
    now: Date,
  ): Promise<SettleResult> {
    let result: SettleResult & { account?: NewAccount };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const locked = await lockPayment(tx, paymentId);
        const decision = await decider(locked, tx);
        if (decision.action === 'mark_paid')
          return this.settlePaid(tx, locked, decision, event, now);
        const status =
          decision.action === 'mark_failed'
            ? PaymentStatus.failed
            : decision.action === 'mark_expired'
              ? PaymentStatus.expired
              : undefined;
        const row = await tx.payment.update({
          where: { id: locked.id },
          data: { ...bookkeeping(decision, event, now), ...(status ? { status } : {}) },
        });
        await recordEvent(tx, locked, event, decision.outcome);
        return {
          outcome: decision.outcome,
          status: row.status,
          applied: status !== undefined,
          reviewReason: decision.reviewReason ?? null,
          alert: decision.alert,
          userId: null,
        };
      }, TX_OPTIONS);
    } catch (e) {
      const clash = uniqueClash(e);
      if (!clash) throw e;
      result = await this.afterClash(paymentId, decider, event, now, clash);
    }
    await this.afterCommit(paymentId, result);
    return {
      outcome: result.outcome,
      status: result.status,
      applied: result.applied,
      reviewReason: result.reviewReason,
      alert: result.alert,
      userId: result.userId,
    };
  }

  private async settlePaid(
    tx: Prisma.TransactionClient,
    locked: Payment,
    decision: Decision,
    event: PaymentEventInput,
    now: Date,
  ): Promise<SettleResult & { account?: NewAccount }> {
    const paid = await moveToPaid(tx, locked, decision, event, now);
    await tx.$queryRaw`SELECT id FROM pending_registrations WHERE id = ${locked.pendingRegistrationId}::uuid FOR UPDATE`;
    const attempt = await tx.pendingRegistration.findUniqueOrThrow({
      where: { id: locked.pendingRegistrationId },
    });
    const form = attempt.status === RegistrationAttemptStatus.open ? formOf(attempt) : null;

    if (!form) {
      // Money taken, but this attempt cannot become an account: another payment completed it (paid twice), the student
      // gave it up and started again, or its stored form is unusable. An admin decides (RUNBOOK §11).
      const reason =
        attempt.status === RegistrationAttemptStatus.abandoned
          ? 'abandoned_attempt_paid'
          : attempt.status === RegistrationAttemptStatus.open
            ? 'attempt_invalid'
            : 'duplicate_payment';
      await tx.payment.update({
        where: { id: locked.id },
        data: { ...paid, reviewReason: reason, userId: attempt.userId },
      });
      if (attempt.status === RegistrationAttemptStatus.open)
        await tx.pendingRegistration.update({
          where: { id: attempt.id },
          data: { status: RegistrationAttemptStatus.conflict },
        });
      await recordEvent(tx, locked, event, reason);
      return {
        outcome: reason,
        status: PaymentStatus.paid,
        applied: true,
        reviewReason: reason,
        alert: 'critical',
        userId: null,
      };
    }

    const grade = await tx.gradeLevel.findUnique({ where: { id: form.gradeLevelId } });
    const user = await tx.user.create({
      data: {
        email: attempt.email,
        passwordHash: form.passwordHash,
        name: attempt.name,
        phone: attempt.phone,
        district: form.district,
        institution: form.institution,
        educationType: form.educationType,
        gradeLevelId: grade?.id ?? null,
        category: grade?.category ?? null,
        role: 'student', // never from the form (RULEBOOK §5)
        signupSource: 'registration',
        referredById: attempt.referredById,
      },
      select: { id: true, email: true, name: true },
    });
    await tx.pendingRegistration.update({
      where: { id: attempt.id },
      data: {
        status: RegistrationAttemptStatus.completed,
        userId: user.id,
        completedAt: now,
        payload: Prisma.DbNull, // the password hash and the form are not kept (plan 4.3)
      },
    });
    await tx.payment.update({ where: { id: locked.id }, data: { ...paid, userId: user.id } });
    await tx.registration.create({ data: { userId: user.id, paymentId: locked.id } });
    await tx.auditLog.create({
      data: {
        action: 'registration.completed',
        actorId: event.actorId ?? null,
        entityType: 'user',
        entityId: user.id,
        meta: { paymentId: locked.id, invoiceNumber: locked.invoiceNumber, source: event.source },
      },
    });
    await recordEvent(tx, locked, event, decision.outcome);
    return {
      outcome: decision.outcome,
      status: PaymentStatus.paid,
      applied: true,
      reviewReason: decision.reviewReason ?? null,
      alert: decision.alert,
      userId: user.id,
      account: user,
    };
  }

  /**
   * The paid transaction was rolled back by a UNIQUE index. Users' email or phone: an account was made meanwhile, so
   * the payment is paid without an account (`email_taken`/`phone_taken`) and the attempt becomes `conflict`. trx_id:
   * another payment already holds it, so this one is never paid (`trx_id_reused`); an admin entering it is refused.
   */
  private async afterClash(
    paymentId: string,
    decider: Decider,
    event: PaymentEventInput,
    now: Date,
    clash: Clash,
  ): Promise<SettleResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockPayment(tx, paymentId);
      const decision = await decider(locked, tx);
      if (decision.action !== 'mark_paid') {
        // Settled by another run in between: record what this one saw.
        await tx.payment.update({
          where: { id: locked.id },
          data: bookkeeping(decision, event, now),
        });
        await recordEvent(tx, locked, event, decision.outcome);
        return {
          outcome: decision.outcome,
          status: locked.status,
          applied: false,
          reviewReason: decision.reviewReason ?? null,
          alert: decision.alert,
          userId: null,
        };
      }
      if (clash === 'trx_id') {
        if (event.source === 'admin') throw new TrxIdInUse();
        await tx.payment.update({
          where: { id: locked.id },
          data: { ...bookkeeping(decision, event, now), reviewReason: 'trx_id_reused' },
        });
        await recordEvent(tx, locked, event, 'trx_id_reused');
        return {
          outcome: 'trx_id_reused',
          status: locked.status,
          applied: false,
          reviewReason: 'trx_id_reused',
          alert: 'critical',
          userId: null,
        };
      }
      const reason = clash === 'email' ? 'email_taken' : 'phone_taken';
      const paid = await moveToPaid(tx, locked, decision, event, now);
      await tx.payment.update({
        where: { id: locked.id },
        data: { ...paid, reviewReason: reason },
      });
      await tx.pendingRegistration.updateMany({
        where: { id: locked.pendingRegistrationId, status: RegistrationAttemptStatus.open },
        data: { status: RegistrationAttemptStatus.conflict },
      });
      await recordEvent(tx, locked, event, reason);
      return {
        outcome: reason,
        status: PaymentStatus.paid,
        applied: true,
        reviewReason: reason,
        alert: 'critical',
        userId: null,
      };
    }, TX_OPTIONS);
  }

  /** Alerts and the verification email go out only after the commit; neither can undo or fail the change. */
  private async afterCommit(
    paymentId: string,
    result: SettleResult & { account?: NewAccount },
  ): Promise<void> {
    this.logger.log({
      msg: 'payment checked',
      paymentId,
      outcome: result.outcome,
      status: result.status,
      applied: result.applied,
    });
    const meta = {
      paymentId,
      outcome: result.outcome,
      status: result.status,
      ...(result.reviewReason ? { reviewReason: result.reviewReason } : {}),
    };
    try {
      if (result.alert === 'critical')
        await this.alerts.raise('payments.needs_review', { actorId: null, meta });
      else if (result.alert === 'warn') {
        this.logger.warn({ msg: 'payment warning', ...meta });
        await this.audit.record({
          action: 'payments.warning',
          entityType: 'payment',
          entityId: paymentId,
          meta,
        });
      }
    } catch {
      this.logger.error({ msg: 'could not raise the payment alert', paymentId });
    }
    if (result.account) await this.emails.welcome(result.account);
  }
}

/** The admin typed a trx_id that another payment already holds. */
export class TrxIdInUse extends Error {
  constructor() {
    super('trx_id already belongs to another payment');
    this.name = 'TrxIdInUse';
  }
}

async function lockPayment(tx: Prisma.TransactionClient, id: string): Promise<Payment> {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.payment.findUniqueOrThrow({ where: { id } });
}

/** Every check counts (reconciliation backs off by check_count); an admin action is not a check. */
function bookkeeping(
  decision: Decision,
  event: PaymentEventInput,
  now: Date,
): Prisma.PaymentUncheckedUpdateInput {
  return {
    ...(event.source === 'status_v1' ? { lastCheckedAt: now, checkCount: { increment: 1 } } : {}),
    ...(decision.gatewayStatus ? { gatewayStatus: decision.gatewayStatus.slice(0, 40) } : {}),
    ...(decision.reviewReason ? { reviewReason: decision.reviewReason } : {}),
  };
}

/** initiated -> pending first (the trigger allows only the state machine's steps); returns the paid columns. */
async function moveToPaid(
  tx: Prisma.TransactionClient,
  locked: Payment,
  decision: Decision,
  event: PaymentEventInput,
  now: Date,
): Promise<Prisma.PaymentUncheckedUpdateInput> {
  if (locked.status === PaymentStatus.initiated)
    await tx.payment.update({
      where: { id: locked.id },
      data: { status: PaymentStatus.pending },
    });
  return {
    ...bookkeeping(decision, event, now),
    status: PaymentStatus.paid,
    trxId: decision.trxId,
    paidAmountMinor: decision.paidAmountMinor,
    paidAt: now,
  };
}

async function recordEvent(
  tx: Prisma.TransactionClient,
  payment: Payment,
  event: PaymentEventInput,
  outcome: string,
): Promise<void> {
  await tx.paymentEvent.create({
    data: {
      paymentId: payment.id,
      source: event.source,
      invoiceNumber: payment.invoiceNumber,
      trxId: event.trxId?.slice(0, 100) ?? null,
      outcome,
      statusCode: event.statusCode?.slice(0, 40) ?? null,
      trxStatus: event.trxStatus?.slice(0, 40) ?? null,
      payload: event.payload === null ? Prisma.DbNull : (event.payload as Prisma.InputJsonValue),
      actorId: event.actorId ?? null,
    },
  });
}

function formOf(attempt: PendingRegistration): AttemptForm | null {
  const p = attempt.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const f = p as Record<string, unknown>;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  return str(f.passwordHash) &&
    str(f.district) &&
    str(f.institution) &&
    str(f.educationType) &&
    str(f.gradeLevelId)
    ? (f as AttemptForm)
    : null;
}

/** Which UNIQUE index refused the paid transaction, when it is one this file handles. */
function uniqueClash(e: unknown): Clash | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  const target = JSON.stringify(e.meta?.target ?? '');
  const model = typeof e.meta?.modelName === 'string' ? e.meta.modelName : null;
  if (target.includes('trx_id')) return 'trx_id';
  if (model && model !== 'User') return null;
  if (target.includes('phone')) return 'phone';
  if (target.includes('email')) return 'email';
  return null;
}
