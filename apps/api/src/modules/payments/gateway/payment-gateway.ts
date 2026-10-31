/**
 * What the payment code needs from PayStation (plan section 7). Adapters only translate HTTP; the decision on what a
 * status means lives in payment-decision.ts. Every result carries the gateway's answer, redacted, for payment_events.
 * v2 (/v2/transaction-status) is not used: the merchant bears the charge, so v1's payment_amount must equal the fee.
 */
export type GatewayRaw = Record<string, unknown> | string | null;

export type InitiateRequest = {
  invoiceNumber: string;
  amountMinor: number; // a whole-taka amount in paisa; sent as an integer number of taka
  reference: string; // our payment id, echoed back by the status API
  customer: { name: string; phone: string; email: string };
};

export type UnavailableReason = 'timeout' | 'network' | 'http' | 'bad_response';

export type InitiateResult =
  | { kind: 'created'; paymentUrl: string; raw: GatewayRaw }
  /** "1001" Invalid Credential: a configuration error (plan 6.1), never a failed payment. */
  | { kind: 'credentials_rejected'; statusCode: string; raw: GatewayRaw }
  /** "1008" (duplicate invoice) and every other non-200 code. */
  | { kind: 'refused'; statusCode: string; raw: GatewayRaw }
  | { kind: 'unavailable'; reason: UnavailableReason; httpStatus?: number; raw: GatewayRaw };

export type StatusResult =
  | {
      kind: 'found';
      invoiceNumber: string;
      /** Lowercased and trimmed; the decision maps it. */
      trxStatus: string;
      /** '' becomes null, so UNIQUE(trx_id) never collides on empty strings. */
      trxId: string | null;
      /** v1 payment_amount in paisa; null when missing or not an amount. */
      paymentMinor: number | null;
      reference: string | null;
      paymentMethod: string | null;
      raw: GatewayRaw;
    }
  /** "2001": not found OR wrong merchant id; the two cannot be told apart (S17). Never treated as failed. */
  | { kind: 'not_found_or_auth'; statusCode: string; raw: GatewayRaw }
  | { kind: 'other'; statusCode: string; raw: GatewayRaw }
  | { kind: 'unavailable'; reason: UnavailableReason; httpStatus?: number; raw: GatewayRaw };

export interface PaymentGateway {
  initiate(request: InitiateRequest): Promise<InitiateResult>;
  /** v1 transaction-status by our invoice number. */
  statusByInvoice(invoiceNumber: string): Promise<StatusResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
