/**
 * Proves the PayStation credentials and host of this server (plan section 7, RUNBOOK). A status query cannot: "2001"
 * means "not found" or "wrong credentials". So it starts ONE checkout of 10 BDT with an `X…` invoice that is never
 * stored or paid, and expects a payment link. It leaves one unpaid invoice in the merchant panel.
 *
 *   Local: pnpm --filter @sirat/api paystation:selfcheck
 *   VPS:   docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps -T api \
 *            node dist/cli/paystation-selfcheck.js
 *
 * Prints the settings line (never any part of a credential) and the result kind. Exit 0 only when the link was
 * created; 1 for any gateway answer; 2 when payments are disabled or the settings are wrong.
 */
import { PayStationGateway } from '../modules/payments/gateway/paystation.gateway';
import type { InitiateResult, PaymentGateway } from '../modules/payments/gateway/payment-gateway';
import { newInvoiceNumber } from '../modules/payments/invoice';
import {
  PaymentConfigError,
  buildPaymentConfig,
  describePaymentConfig,
  paymentEnvFromProcess,
  type PaymentConfig,
} from '../modules/payments/payment.config';

/** The invoice prefix only this check uses; PaymentConfig refuses it for real accounts. */
export const SELFCHECK_PREFIX = 'X';
const SELFCHECK_AMOUNT_MINOR = 1_000; // 10 BDT

type EnabledConfig = Extract<PaymentConfig, { enabled: true }>;

export function describeInitiate(result: InitiateResult): string {
  switch (result.kind) {
    case 'created': {
      let host = 'unparsable';
      try {
        host = new URL(result.paymentUrl).host;
      } catch {
        /* keep 'unparsable' */
      }
      return `initiate: created (payment link host=${host})`;
    }
    case 'credentials_rejected':
      return `initiate: credentials rejected (status_code ${result.statusCode}): check the merchant id (exactly as issued, with any "-") and the password, and that PAYSTATION_ENV matches the account`;
    case 'refused':
      return `initiate: refused (status_code ${result.statusCode})`;
    case 'unavailable':
      return `initiate: unavailable (${result.reason}${result.httpStatus ? ` ${result.httpStatus}` : ''})`;
  }
}

export async function runSelfcheck(
  env: NodeJS.ProcessEnv,
  makeGateway: (config: EnabledConfig) => PaymentGateway = (config) =>
    new PayStationGateway(config),
  print: (line: string) => void = (line) => console.log(line),
  now: Date = new Date(),
): Promise<number> {
  let config: PaymentConfig;
  try {
    config = buildPaymentConfig(paymentEnvFromProcess(env));
  } catch (err) {
    print(err instanceof PaymentConfigError ? `settings: ${err.message}` : 'settings: unreadable');
    return 2;
  }
  print(describePaymentConfig(config));
  if (!config.enabled) return 2;
  const invoiceNumber = newInvoiceNumber(SELFCHECK_PREFIX, now);
  print(`selfcheck invoice: ${invoiceNumber} (10 BDT, never stored or paid)`);
  const result = await makeGateway(config).initiate({
    invoiceNumber,
    amountMinor: SELFCHECK_AMOUNT_MINOR,
    reference: 'paystation-selfcheck',
    customer: { name: 'SELFCHECK', phone: '01700000000', email: 'selfcheck@example.com' },
  });
  print(describeInitiate(result));
  return result.kind === 'created' ? 0 : 1;
}

if (require.main === module) {
  runSelfcheck(process.env)
    .then((code) => process.exit(code))
    .catch(() => {
      console.error('selfcheck failed unexpectedly');
      process.exit(1);
    });
}
