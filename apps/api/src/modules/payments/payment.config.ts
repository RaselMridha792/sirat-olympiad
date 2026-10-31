import { PLACEHOLDER, type EnvVars } from '../../config/env';

/**
 * PayStation account settings (docs/plans/PAYMENTS-PLAN.md section 3.5, DECISIONS 2026-10-31).
 *
 * The host is the same for every merchant, so it is NOT free in .env: this allow-list is the only place in the
 * source that names a PayStation host (a unit test scans the repo), and PAYSTATION_ENV picks the entry. With a free
 * URL, a dev machine with PAYSTATION_ENV=sandbox, the live host and live credentials would take real money and no
 * guard would notice. Sandbox credentials are refused on the live host ("1001", S11 checked 2026-10-31).
 * Credentials, account label, invoice prefix, callback and IPN URL come from .env, so an account switch is .env only.
 */
export const PAYSTATION_HOSTS = {
  sandbox: 'https://sandbox.paystation.com.bd', // S11 (2026-10-31): sandbox credentials work only here
  live: 'https://api.paystation.com.bd',
} as const;

export const PAYSTATION_CALLBACK_PATH = '/api/payments/paystation/callback';
export const PAYSTATION_IPN_PATH = '/api/payments/paystation/ipn';
/** Our invoice numbers never exceed 20 characters (payments_invoice_number_check). */
export const MAX_INVOICE_LENGTH = 20;
/** PayStation's documented callback_url limit; the invoice is appended as `/<invoice>`. */
export const MAX_CALLBACK_URL_LENGTH = 200;
/** `X…` is the selfcheck's never-stored invoice, `FX…` the dev fixtures'. */
const RESERVED_PREFIX = /^(X|FX)/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type PaystationEnv = 'sandbox' | 'live' | 'fake';

export type PaymentConfig =
  | { enabled: false }
  | {
      enabled: true;
      env: PaystationEnv;
      baseUrl: string;
      merchantId: string;
      password: string;
      accountLabel: string;
      invoicePrefix: string;
      /** Without the invoice; the gateway client appends `/<invoice>`. */
      callbackUrl: string;
      ipnUrl: string | null;
      /** The merchant bears the charge (owner, 2026-10-31); nothing else is built. */
      payWithCharge: 0;
      timeoutMs: number;
    };

export type PaymentEnv = Pick<
  EnvVars,
  | 'NODE_ENV'
  | 'PAYSTATION_ENV'
  | 'PAYSTATION_BASE_URL'
  | 'PAYSTATION_MERCHANT_ID'
  | 'PAYSTATION_PASSWORD'
  | 'PAYSTATION_ACCOUNT_LABEL'
  | 'PAYSTATION_INVOICE_PREFIX'
  | 'PAYSTATION_CALLBACK_URL'
  | 'PAYSTATION_IPN_URL'
  | 'PAYSTATION_PAY_WITH_CHARGE'
  | 'PAYSTATION_TIMEOUT_MS'
>;

/** A configuration error. The message names the variable and the rule, never a value. */
export class PaymentConfigError extends Error {}

const fail = (message: string): never => {
  throw new PaymentConfigError(message);
};

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    return fail(`${name} is not a valid URL`);
  }
}

/** Our route on our side: exact path, no query or fragment; https unless allowed otherwise. */
function ownRoute(value: string, name: string, path: string, allowHttp: boolean): URL {
  const url = parseUrl(value, name);
  if (url.pathname !== path || url.search || url.hash)
    fail(`${name} must end with ${path}, without a query or fragment`);
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
    fail(`${name} must use https`);
  return url;
}

/**
 * Builds the payment settings, or throws PaymentConfigError. PAYSTATION_ENV unset means payments are disabled
 * (registration cannot start a payment), so other environments and sessions without these variables still boot.
 * Once it is set, every rule applies.
 */
export function buildPaymentConfig(env: PaymentEnv): PaymentConfig {
  const mode = env.PAYSTATION_ENV as PaystationEnv | undefined;
  if (!mode) return { enabled: false };
  const production = env.NODE_ENV === 'production';
  if (mode === 'live' && !production)
    fail('PAYSTATION_ENV=live is allowed only with NODE_ENV=production');
  if (mode === 'fake' && production)
    fail('PAYSTATION_ENV=fake (the dev/CI fake server) is refused with NODE_ENV=production');

  // Host: from the allow-list; an explicit PAYSTATION_BASE_URL must equal it. Only the fake server is free.
  let baseUrl: string;
  if (mode === 'fake') {
    if (!env.PAYSTATION_BASE_URL)
      fail('PAYSTATION_BASE_URL is required with PAYSTATION_ENV=fake (the fake server)');
    const url = parseUrl(env.PAYSTATION_BASE_URL as string, 'PAYSTATION_BASE_URL');
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      fail('PAYSTATION_BASE_URL must be http(s)');
    baseUrl = url.origin;
  } else {
    baseUrl = PAYSTATION_HOSTS[mode];
    if (env.PAYSTATION_BASE_URL) {
      const url = parseUrl(env.PAYSTATION_BASE_URL, 'PAYSTATION_BASE_URL');
      if (url.origin !== baseUrl || (url.pathname !== '/' && url.pathname !== '') || url.search)
        fail(
          `PAYSTATION_BASE_URL must be blank or equal the ${mode} host of the allow-list in payment.config.ts`,
        );
    }
  }

  // Credentials: used exactly as issued (the merchant id keeps its "-", S11). Never logged.
  const merchantId = env.PAYSTATION_MERCHANT_ID ?? '';
  const password = env.PAYSTATION_PASSWORD ?? '';
  if (mode !== 'fake') {
    if (!merchantId || /\s/.test(merchantId) || PLACEHOLDER.test(merchantId))
      fail('PAYSTATION_MERCHANT_ID is missing or looks like a placeholder');
    if (!password || PLACEHOLDER.test(password))
      fail('PAYSTATION_PASSWORD is missing or looks like a placeholder');
  }

  const accountLabel = env.PAYSTATION_ACCOUNT_LABEL ?? '';
  if (!/^[a-z0-9-]{3,32}$/.test(accountLabel))
    fail('PAYSTATION_ACCOUNT_LABEL is required: 3-32 lowercase letters, digits or "-"');
  const invoicePrefix = env.PAYSTATION_INVOICE_PREFIX ?? '';
  if (!/^[A-Z0-9]{1,3}$/.test(invoicePrefix))
    fail('PAYSTATION_INVOICE_PREFIX is required: 1-3 uppercase letters or digits');
  if (RESERVED_PREFIX.test(invoicePrefix))
    fail('PAYSTATION_INVOICE_PREFIX must not start with X or FX (selfcheck and dev fixtures)');

  // Callback: a browser redirect, so plain http is fine for this machine outside production.
  if (!env.PAYSTATION_CALLBACK_URL) return fail('PAYSTATION_CALLBACK_URL is required');
  const callback = ownRoute(
    env.PAYSTATION_CALLBACK_URL,
    'PAYSTATION_CALLBACK_URL',
    PAYSTATION_CALLBACK_PATH,
    mode === 'fake' || !production,
  );
  if (callback.protocol === 'http:' && !LOCAL_HOSTS.has(callback.hostname) && mode !== 'fake')
    fail('PAYSTATION_CALLBACK_URL may use http only for localhost');
  const callbackUrl = `${callback.origin}${callback.pathname}`;
  if (callbackUrl.length + 1 + MAX_INVOICE_LENGTH > MAX_CALLBACK_URL_LENGTH)
    fail(
      `PAYSTATION_CALLBACK_URL is too long: with an invoice it must stay within ${MAX_CALLBACK_URL_LENGTH} characters`,
    );

  // IPN: registered by hand in PayStation's panel (not sent with the payment). Required in production.
  let ipnUrl: string | null = null;
  if (env.PAYSTATION_IPN_URL) {
    const ipn = ownRoute(
      env.PAYSTATION_IPN_URL,
      'PAYSTATION_IPN_URL',
      PAYSTATION_IPN_PATH,
      mode === 'fake',
    );
    ipnUrl = `${ipn.origin}${ipn.pathname}`;
  } else if (production) {
    fail('PAYSTATION_IPN_URL is required with NODE_ENV=production');
  }

  if (env.PAYSTATION_PAY_WITH_CHARGE !== '0')
    fail('PAYSTATION_PAY_WITH_CHARGE must be 0: the merchant bears the charge (owner, 2026-10-31)');

  return {
    enabled: true,
    env: mode,
    baseUrl,
    merchantId,
    password,
    accountLabel,
    invoicePrefix,
    callbackUrl,
    ipnUrl,
    payWithCharge: 0,
    timeoutMs: env.PAYSTATION_TIMEOUT_MS,
  };
}

/** One boot-log line: what the server will use. Never a credential, not even part of one. */
export function describePaymentConfig(config: PaymentConfig): string {
  if (!config.enabled) return 'PayStation disabled (PAYSTATION_ENV unset): no payment can start';
  return [
    `PayStation env=${config.env}`,
    `host=${new URL(config.baseUrl).host}`,
    `account=${config.accountLabel}`,
    `invoicePrefix=${config.invoicePrefix}`,
    `callback=${config.callbackUrl}`,
    `ipn=${config.ipnUrl ?? 'none'}`,
    'payWithCharge=0',
  ].join(' ');
}
