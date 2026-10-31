import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus, type Payment } from '@prisma/client';
import type { Paginated } from '@sirat/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { readStatusData } from '../gateway/paystation.gateway';
import type { Decision } from '../payment-decision';
import { PaymentSettlement, TrxIdInUse } from '../verify/payment-settlement';
import { VerifyRequests } from '../verify/verify-requests';
import type { AdminPaymentsQueryDto, ReconcilePaymentDto } from './admin-payments.dto';

export type Actor = { id: string; ip: string | null };

const ADMIN_PAYMENT = {
  id: true,
  invoiceNumber: true,
  amountMinor: true,
  currency: true,
  status: true,
  trxId: true,
  paidAmountMinor: true,
  gatewayStatus: true,
  gatewayAccount: true,
  reviewReason: true,
  checkCount: true,
  lastCheckedAt: true,
  expiresAt: true,
  paidAt: true,
  createdAt: true,
  userId: true,
  pendingRegistration: { select: { id: true, status: true, email: true, phone: true, name: true } },
} as const satisfies Prisma.PaymentSelect;
type AdminPaymentRow = Prisma.PaymentGetPayload<{ select: typeof ADMIN_PAYMENT }>;

export type AdminPaymentView = Omit<
  AdminPaymentRow,
  'lastCheckedAt' | 'expiresAt' | 'paidAt' | 'createdAt'
> & {
  lastCheckedAt: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
};

const view = (p: AdminPaymentRow): AdminPaymentView => ({
  ...p,
  lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null,
  expiresAt: p.expiresAt.toISOString(),
  paidAt: p.paidAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
});

const SUCCESS = new Set(['success', 'successful']);
const RECONCILABLE: PaymentStatus[] = [
  PaymentStatus.pending,
  PaymentStatus.failed,
  PaymentStatus.expired,
];
const EVENTS_SHOWN = 100;

/**
 * Admin payments (plan 6.7; Role admin only). Reads are paginated; every write is audited. No refund action exists
 * (owner: no refund handling); everything outside the reconcile rule below is the manual path in RUNBOOK §11.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settlement: PaymentSettlement,
    private readonly verifies: VerifyRequests,
  ) {}

  async list(q: AdminPaymentsQueryDto): Promise<Paginated<AdminPaymentView>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.PaymentWhereInput = {
      ...(q.invoice ? { invoiceNumber: q.invoice } : {}),
      ...(q.trx ? { trxId: q.trx } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.review ? { reviewReason: { not: null } } : {}),
      ...(q.account ? { gatewayAccount: q.account } : {}),
      ...(q.phone || q.email
        ? {
            pendingRegistration: {
              ...(q.phone ? { phone: q.phone } : {}),
              ...(q.email ? { email: q.email } : {}), // citext: case-insensitive
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ADMIN_PAYMENT,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: items.map(view), page, pageSize, total };
  }

  /** One payment with its last 100 events (gateway answers are stored redacted). */
  async get(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, select: ADMIN_PAYMENT });
    if (!payment) throw new NotFoundException('Payment not found');
    const events = await this.prisma.paymentEvent.findMany({
      where: { paymentId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EVENTS_SHOWN,
      select: {
        id: true,
        source: true,
        outcome: true,
        statusCode: true,
        trxStatus: true,
        trxId: true,
        actorId: true,
        payload: true,
        createdAt: true,
      },
    });
    return {
      payment: view(payment),
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  }

  /** Asks the worker for a status check now (any status, e.g. to see a reported refund). 10 s per payment. */
  async recheck(actor: Actor, id: string): Promise<{ requested: boolean }> {
    const payment = await this.prisma.payment.findUnique({ where: { id }, select: { id: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    const result = await this.verifies.request(id, 'admin');
    await this.audit.record({
      action: 'payments.recheck_requested',
      actorId: actor.id,
      ip: actor.ip,
      entityType: 'payment',
      entityId: id,
      meta: { result },
    });
    return { requested: result === 'requested' };
  }

  /**
   * Manual reconcile (lead, 2026-10-31; a technical safety valve, not a money-policy change: it only confirms what
   * PayStation already reported). Allowed only when, under the row lock:
   * - the payment is pending, failed or expired, and the automatic rule stopped on `success_without_trx_id`;
   * - its latest status_v1 answer shows a success with our invoice, our reference (when echoed) and exactly our
   *   amount, but no trx_id.
   * The admin types the trx_id from PayStation's panel (UNIQUE still applies) and a reason; then the settlement runs
   * exactly as the automatic path. A payment already paid answers its current state: never a second settle.
   * trx_id reuse, amount or invoice mismatches and refunds are not here: RUNBOOK §11.
   */
  async reconcile(
    actor: Actor,
    id: string,
    dto: ReconcilePaymentDto,
  ): Promise<{ applied: boolean; payment: AdminPaymentView }> {
    const exists = await this.prisma.payment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Payment not found');
    let outcome: string;
    let applied: boolean;
    try {
      ({ outcome, applied } = await this.settlement.apply(
        id,
        async (locked, tx): Promise<Decision> => {
          if (locked.status === PaymentStatus.paid)
            return { action: 'none', outcome: 'duplicate', alert: null };
          await assertReconcilable(locked, tx);
          return {
            action: 'mark_paid',
            outcome: 'manual_paid',
            alert: null,
            reviewReason: 'manually_reconciled',
            trxId: dto.trxId,
            paidAmountMinor: locked.amountMinor,
          };
        },
        {
          source: 'admin',
          statusCode: null,
          trxStatus: null,
          trxId: dto.trxId,
          payload: { action: 'reconcile', reason: dto.reason },
          actorId: actor.id,
        },
        new Date(),
      ));
    } catch (e) {
      if (e instanceof TrxIdInUse)
        throw new ConflictException({
          code: 'TRX_ID_IN_USE',
          message: 'This trx_id already belongs to another payment',
        });
      throw e;
    }
    if (applied)
      await this.audit.record({
        action: 'payments.reconciled',
        actorId: actor.id,
        ip: actor.ip,
        entityType: 'payment',
        entityId: id,
        meta: { outcome, trxId: dto.trxId, reason: dto.reason },
      });
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      select: ADMIN_PAYMENT,
    });
    return { applied, payment: view(payment) };
  }
}

const notAllowed = (message: string) =>
  new ConflictException({ code: 'RECONCILE_NOT_ALLOWED', message });

async function assertReconcilable(locked: Payment, tx: Prisma.TransactionClient): Promise<void> {
  if (!RECONCILABLE.includes(locked.status))
    throw notAllowed('Only a pending, failed or expired payment can be reconciled');
  if (locked.reviewReason !== 'success_without_trx_id')
    throw notAllowed('Reconcile is only for a success PayStation reported without a trx_id');
  const last = await tx.paymentEvent.findFirst({
    where: { paymentId: locked.id, source: 'status_v1' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { payload: true },
  });
  const p = last?.payload;
  const data =
    p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>).data : null;
  const answer =
    data && typeof data === 'object' && !Array.isArray(data)
      ? readStatusData(data as Record<string, unknown>)
      : null;
  if (
    !answer ||
    !SUCCESS.has(answer.trxStatus) ||
    answer.trxId !== null ||
    answer.invoiceNumber !== locked.invoiceNumber ||
    (answer.reference !== null && answer.reference !== locked.id) ||
    answer.paymentMinor !== locked.amountMinor
  )
    throw notAllowed(
      "PayStation's latest answer does not show a success without a trx_id for our invoice and amount. Recheck first.",
    );
}
