import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { errorLogFields } from '../../../common/all-exceptions.filter';
import { PrismaService } from '../../../prisma/prisma.service';
import { redactGatewayBody } from '../gateway/redact';
import { isWatched } from '../verify/payment-timing';
import { VerifyRequests } from '../verify/verify-requests';

/** Our invoice format (CHECK payments_invoice_number_check). Anything else is never looked up. */
const INVOICE = /^[A-Z0-9]{10,20}$/;
const SUCCESS = new Set(['success', 'successful']);
/** The IPN fields PayStation documents; an IPN for an unknown invoice keeps only these, short. */
const IPN_FIELDS = [
  'invoice_number',
  'trx_status',
  'trx_id',
  'trx_amount',
  'payment_method',
  'order_date_time',
];
const MAX_QUERY_KEYS = 10;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) || null : null;

const PAYMENT_FIELDS = {
  id: true,
  status: true,
  trxId: true,
  expiresAt: true,
  paymentUrl: true,
} as const;

/**
 * PayStation's two signals (plan 6.2, 6.4; DECISIONS "PayStation, from the official docs"). Neither is trusted: both
 * are unsigned, so each only records what arrived and asks the worker for a v1 status check, which alone decides.
 * - Callback: the student's browser returning by GET to `/callback/:invoice`, with `status`, `invoice_number`,
 *   `trx_id` (empty on failure) and `message` (failure only) appended (sandbox, 2026-10-31).
 * - IPN: a server-to-server POST with a JSON body, sent only for a success.
 */
@Injectable()
export class PayStationHooks {
  private readonly logger = new Logger('PayStationHooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly verifies: VerifyRequests,
  ) {}

  /** Never throws: the student is redirected to the result page whatever happens here. */
  async callback(invoice: string, query: unknown, now = new Date()): Promise<string> {
    if (!INVOICE.test(invoice)) return 'bad_invoice';
    const q = isRecord(query) ? query : {};
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { invoiceNumber: invoice },
        select: PAYMENT_FIELDS,
      });
      const outcome = !payment
        ? 'unknown_invoice'
        : isWatched(payment, now)
          ? `verify_${await this.verifies.request(payment.id, 'callback')}`
          : 'no_check_needed';
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment?.id ?? null,
          source: 'callback',
          invoiceNumber: invoice,
          trxId: text(q.trx_id, 100),
          trxStatus: text(q.status, 40)?.toLowerCase() ?? null,
          outcome,
          payload: json(redactGatewayBody(boundedQuery(q))),
        },
      });
      return outcome;
    } catch (e) {
      this.logger.error({ msg: 'callback not recorded', ...errorLogFields(e) });
      return 'error';
    }
  }

  /**
   * Answers 200 for processed, duplicate and unknown IPNs (PayStation retries anything else); 503 when the database
   * cannot record it, so PayStation retries later. An IPN never marks anything itself.
   */
  async ipn(body: unknown): Promise<string> {
    const b = isRecord(body) ? body : {};
    const invoice = text(b.invoice_number, 40);
    const trxId = text(b.trx_id, 100);
    const trxStatus = text(b.trx_status, 40)?.toLowerCase() ?? null;
    let paymentId: string | null = null;
    let outcome: string;
    try {
      const payment =
        invoice && INVOICE.test(invoice)
          ? await this.prisma.payment.findUnique({
              where: { invoiceNumber: invoice },
              select: PAYMENT_FIELDS,
            })
          : null;
      paymentId = payment?.id ?? null;
      if (!payment) outcome = 'unknown_invoice';
      else if (
        trxStatus &&
        SUCCESS.has(trxStatus) &&
        payment.status === PaymentStatus.paid &&
        trxId !== null &&
        payment.trxId === trxId
      )
        outcome = 'duplicate';
      // Any other IPN for our payment is a success signal: checked even outside the late watch, and for a paid
      // payment with another trx_id (the verify job flags paid_trx_mismatch).
      else outcome = `verify_${await this.verifies.request(payment.id, 'ipn')}`;
      await this.prisma.paymentEvent.create({
        data: {
          paymentId,
          source: 'ipn',
          invoiceNumber: invoice,
          trxId,
          trxStatus,
          outcome,
          payload: json(redactGatewayBody(paymentId ? b : pick(b))),
        },
      });
    } catch (e) {
      this.logger.error({ msg: 'IPN not recorded', ...errorLogFields(e) });
      throw new ServiceUnavailableException('Try again later');
    }
    if (outcome === 'unknown_invoice')
      this.logger.warn({ msg: 'IPN for an unknown invoice', outcome });
    return outcome;
  }
}

function json(
  raw: ReturnType<typeof redactGatewayBody>,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return raw === null ? Prisma.DbNull : (raw as Prisma.InputJsonValue);
}

/** At most 10 query keys of 40 characters, string values of 200: a callback is kept, but cannot bloat the log. */
function boundedQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(q).slice(0, MAX_QUERY_KEYS)) {
    const v = text(value, 200);
    if (v !== null) out[key.slice(0, 40)] = v;
  }
  return out;
}

function pick(b: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of IPN_FIELDS) {
    const v = text(b[key], 100);
    if (v !== null) out[key] = v;
  }
  return out;
}
