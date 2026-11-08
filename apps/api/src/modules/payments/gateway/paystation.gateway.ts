import { Logger } from '@nestjs/common';
import { minorToWholeTaka, parseAmountToMinor } from '../amount';
import type { PaymentConfig, PaystationEnv } from '../payment.config';
import type {
  GatewayRaw,
  InitiateRequest,
  InitiateResult,
  PaymentGateway,
  StatusResult,
  UnavailableReason,
} from './payment-gateway';
import { redactGatewayBody } from './redact';

type EnabledConfig = Extract<PaymentConfig, { enabled: true }>;
type Answer =
  | { ok: true; body: Record<string, unknown>; raw: GatewayRaw }
  | { ok: false; reason: UnavailableReason; httpStatus?: number; raw: GatewayRaw };

/** The status_code PayStation sends for a wrong merchant id or password on initiate (S11; not in the docs). */
export const INVALID_CREDENTIAL_CODE = '1001';

export type StatusData = Omit<Extract<StatusResult, { kind: 'found' }>, 'kind' | 'raw'>;

/**
 * A checkout link the student's browser will follow: https for sandbox and live, as the browser requires for a
 * 'paystation' checkout (web checkout.ts). Only the dev/CI fake may answer http. Anything else is a bad response, so
 * start fails at once (the payment is marked failed) instead of leaving a pending payment no browser can open. The
 * link's host is not checked yet: the live account's checkout host is confirmed at the switch (PAYMENTS-PLAN §13.4).
 */
export function isCheckoutUrl(url: unknown, env: PaystationEnv): url is string {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' || (env === 'fake' && parsed.protocol === 'http:');
}

/**
 * The fields of a v1 transaction-status `data` object. Also reads a stored answer (payment_events.payload.data) for
 * the admin reconcile, so a stored answer and a live one are read the same way.
 */
export function readStatusData(d: Record<string, unknown>): StatusData {
  const text = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  return {
    invoiceNumber: text(d.invoice_number),
    trxStatus: text(d.trx_status).toLowerCase(),
    trxId: text(d.trx_id) || null,
    paymentMinor: parseAmountToMinor(d.payment_amount),
    reference: text(d.reference) || null,
    paymentMethod: text(d.payment_method) || null,
  };
}

/**
 * PayStation over HTTP (docs/paystation/PAYSTATION-NOTES.md). Host, credentials and URLs come only from
 * PaymentConfig. The password is sent only with initiate-payment; status calls carry only the merchantId header.
 * Logs carry the operation, the failure kind and an HTTP status: never a body, a credential or a customer field.
 */
export class PayStationGateway implements PaymentGateway {
  private readonly logger = new Logger('PayStation');

  constructor(
    private readonly config: EnabledConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async initiate(request: InitiateRequest): Promise<InitiateResult> {
    const form = new URLSearchParams({
      merchantId: this.config.merchantId,
      password: this.config.password,
      invoice_number: request.invoiceNumber,
      currency: 'BDT',
      payment_amount: String(minorToWholeTaka(request.amountMinor)),
      pay_with_charge: String(this.config.payWithCharge),
      reference: request.reference,
      cust_name: request.customer.name,
      cust_phone: request.customer.phone,
      cust_email: request.customer.email,
      callback_url: `${this.config.callbackUrl}/${request.invoiceNumber}`,
    });
    const answer = await this.post('initiate', '/initiate-payment', form, {});
    if (!answer.ok)
      return {
        kind: 'unavailable',
        reason: answer.reason,
        httpStatus: answer.httpStatus,
        raw: answer.raw,
      };
    const code = String(answer.body.status_code ?? '');
    if (code === '200') {
      const url = answer.body.payment_url;
      if (isCheckoutUrl(url, this.config.env))
        return { kind: 'created', paymentUrl: url, raw: answer.raw };
      this.logger.warn({
        msg: 'paystation answered 200 without a usable payment_url',
        op: 'initiate',
      });
      return { kind: 'unavailable', reason: 'bad_response', raw: answer.raw };
    }
    if (code === INVALID_CREDENTIAL_CODE) {
      this.logger.error({
        msg: 'paystation refused the merchant credentials',
        op: 'initiate',
        statusCode: code,
      });
      return { kind: 'credentials_rejected', statusCode: code, raw: answer.raw };
    }
    return { kind: 'refused', statusCode: code || 'missing', raw: answer.raw };
  }

  async statusByInvoice(invoiceNumber: string): Promise<StatusResult> {
    const form = new URLSearchParams({ invoice_number: invoiceNumber });
    const answer = await this.post('status_v1', '/transaction-status', form, {
      merchantId: this.config.merchantId,
    });
    if (!answer.ok)
      return {
        kind: 'unavailable',
        reason: answer.reason,
        httpStatus: answer.httpStatus,
        raw: answer.raw,
      };
    const code = String(answer.body.status_code ?? '');
    if (code === '200') {
      const data = answer.body.data;
      if (!data || typeof data !== 'object') {
        this.logger.warn({ msg: 'paystation answered 200 without data', op: 'status_v1' });
        return { kind: 'unavailable', reason: 'bad_response', raw: answer.raw };
      }
      return {
        kind: 'found',
        ...readStatusData(data as Record<string, unknown>),
        raw: answer.raw,
      };
    }
    if (code === '2001') return { kind: 'not_found_or_auth', statusCode: code, raw: answer.raw };
    return { kind: 'other', statusCode: code || 'missing', raw: answer.raw };
  }

  private async post(
    op: 'initiate' | 'status_v1',
    path: string,
    form: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<Answer> {
    // The signal itself says whether the time limit ended the call: the error shape differs between fetch versions.
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    const failure = (): UnavailableReason => (signal.aborted ? 'timeout' : 'network');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body: form,
        signal,
      });
    } catch {
      const reason = failure();
      this.logger.warn({ msg: 'paystation call failed', op, reason });
      return { ok: false, reason, raw: null };
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      const reason = failure();
      this.logger.warn({ msg: 'paystation call failed', op, reason, httpStatus: res.status });
      return { ok: false, reason, httpStatus: res.status, raw: null };
    }
    if (!res.ok) {
      this.logger.warn({
        msg: 'paystation call failed',
        op,
        reason: 'http',
        httpStatus: res.status,
      });
      return { ok: false, reason: 'http', httpStatus: res.status, raw: redactGatewayBody(text) };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      this.logger.warn({
        msg: 'paystation call failed',
        op,
        reason: 'bad_response',
        httpStatus: res.status,
      });
      return {
        ok: false,
        reason: 'bad_response',
        httpStatus: res.status,
        raw: redactGatewayBody(text),
      };
    }
    return { ok: true, body: body as Record<string, unknown>, raw: redactGatewayBody(body) };
  }
}
