import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type StatusResult,
} from '../gateway/payment-gateway';
import { decide } from '../payment-decision';
import type { PaymentConfig } from '../payment.config';
import { PAYMENT_CONFIG } from '../payments-boot-check';
import type { VerifyReason } from './payment-queue';
import { PaymentSettlement, type PaymentEventInput } from './payment-settlement';

/**
 * The verify job (plan 6.3), run only in the worker: one v1 status call by invoice, then decide() and the settlement
 * under the row lock. PayStation is called outside every transaction. The callback, the IPN and a recheck are only
 * reasons to run this; none of them is ever read as a payment result.
 */
@Injectable()
export class PaymentVerifier {
  private readonly logger = new Logger('PaymentVerifier');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    private readonly settlement: PaymentSettlement,
    private readonly audit: AuditService,
  ) {}

  /** Returns the recorded outcome. `at` fixes the clock for tests; otherwise the time after the status call. */
  async verify(paymentId: string, reason: VerifyReason, at?: Date): Promise<string> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return 'not_found';
    if (!this.config.enabled || !this.gateway) return 'disabled';
    if (payment.gatewayAccount !== this.config.accountLabel) return this.accountMismatch(payment);

    const result = await this.gateway.statusByInvoice(payment.invoiceNumber);
    const now = at ?? new Date();
    const trxId = result.kind === 'found' ? result.trxId : null;
    const trxIdUsedElsewhere =
      !!trxId &&
      (await this.prisma.payment.count({ where: { trxId, NOT: { id: payment.id } } })) > 0;
    const settled = await this.settlement.apply(
      payment.id,
      (locked) =>
        decide(
          {
            id: locked.id,
            status: locked.status,
            invoiceNumber: locked.invoiceNumber,
            amountMinor: locked.amountMinor,
            trxId: locked.trxId,
            expiresAt: locked.expiresAt,
          },
          result,
          { now, trxIdUsedElsewhere },
        ),
      eventOf(result),
      now,
    );
    this.logger.log({ msg: 'payment verified', paymentId, reason, outcome: settled.outcome });
    return settled.outcome;
  }

  /**
   * The payment was started with another PayStation account (plan 6.3 step 0, section 13): asking the current one
   * would answer 2001 and could expire a real payment. No call; recorded and alerted, an admin decides.
   */
  private async accountMismatch(payment: Payment): Promise<string> {
    await this.prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        source: 'status_v1',
        invoiceNumber: payment.invoiceNumber,
        outcome: 'account_mismatch',
      },
    });
    const meta = {
      paymentId: payment.id,
      outcome: 'account_mismatch',
      paymentAccount: payment.gatewayAccount,
      currentAccount: this.config.enabled ? this.config.accountLabel : '',
    };
    this.logger.warn({ msg: 'payment warning', ...meta });
    await this.audit.record({
      action: 'payments.warning',
      entityType: 'payment',
      entityId: payment.id,
      meta,
    });
    return 'account_mismatch';
  }
}

function eventOf(result: StatusResult): PaymentEventInput {
  switch (result.kind) {
    case 'found':
      return {
        source: 'status_v1',
        statusCode: '200',
        trxStatus: result.trxStatus || null,
        trxId: result.trxId,
        payload: result.raw,
      };
    case 'unavailable':
      return {
        source: 'status_v1',
        statusCode: result.httpStatus ? `http_${result.httpStatus}` : result.reason,
        trxStatus: null,
        trxId: null,
        payload: result.raw,
      };
    default:
      return {
        source: 'status_v1',
        statusCode: result.statusCode,
        trxStatus: null,
        trxId: null,
        payload: result.raw,
      };
  }
}
