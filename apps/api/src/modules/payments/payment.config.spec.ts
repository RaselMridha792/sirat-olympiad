import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  PAYSTATION_HOSTS,
  PaymentConfigError,
  buildPaymentConfig,
  describePaymentConfig,
  type PaymentEnv,
} from './payment.config';

// Values shaped like real ones but obviously not real: never a real credential in a test.
const MERCHANT = '123-4567890123';
const PASSWORD = 'Sx9Lk2Qw7Zt4';

const sandbox = (over: Partial<PaymentEnv> = {}): PaymentEnv => ({
  NODE_ENV: 'development',
  PAYSTATION_ENV: 'sandbox',
  PAYSTATION_MERCHANT_ID: MERCHANT,
  PAYSTATION_PASSWORD: PASSWORD,
  PAYSTATION_ACCOUNT_LABEL: 'rasel-sandbox',
  PAYSTATION_INVOICE_PREFIX: 'T',
  PAYSTATION_CALLBACK_URL: 'http://localhost:4100/api/payments/paystation/callback',
  PAYSTATION_PAY_WITH_CHARGE: '0',
  PAYSTATION_TIMEOUT_MS: 10_000,
  ...over,
});
const live = (over: Partial<PaymentEnv> = {}): PaymentEnv =>
  sandbox({
    NODE_ENV: 'production',
    PAYSTATION_ENV: 'live',
    PAYSTATION_ACCOUNT_LABEL: 'client-live',
    PAYSTATION_INVOICE_PREFIX: 'S',
    PAYSTATION_CALLBACK_URL: 'https://olympiad.example.org/api/payments/paystation/callback',
    PAYSTATION_IPN_URL: 'https://olympiad.example.org/api/payments/paystation/ipn',
    ...over,
  });

const refused = (env: PaymentEnv, message: RegExp) => {
  expect(() => buildPaymentConfig(env)).toThrow(PaymentConfigError);
  expect(() => buildPaymentConfig(env)).toThrow(message);
};

describe('buildPaymentConfig', () => {
  it('is disabled while PAYSTATION_ENV is unset, whatever else is set (other sessions keep booting)', () => {
    expect(buildPaymentConfig(sandbox({ PAYSTATION_ENV: undefined }))).toEqual({ enabled: false });
    expect(
      buildPaymentConfig({ ...sandbox({ PAYSTATION_ENV: '' }), PAYSTATION_MERCHANT_ID: 'fake' }),
    ).toEqual({ enabled: false });
  });

  it('builds the sandbox settings: the host comes from the allow-list, credentials exactly as issued', () => {
    const config = buildPaymentConfig(sandbox());
    expect(config).toMatchObject({
      enabled: true,
      env: 'sandbox',
      baseUrl: PAYSTATION_HOSTS.sandbox,
      merchantId: MERCHANT, // the "-" stays (S11)
      accountLabel: 'rasel-sandbox',
      invoicePrefix: 'T',
      callbackUrl: 'http://localhost:4100/api/payments/paystation/callback',
      ipnUrl: null,
      payWithCharge: 0,
    });
  });

  it('builds live only in production, with https callback and IPN', () => {
    expect(buildPaymentConfig(live())).toMatchObject({
      env: 'live',
      baseUrl: PAYSTATION_HOSTS.live,
    });
    refused(live({ NODE_ENV: 'development' }), /live is allowed only with NODE_ENV=production/);
    refused(live({ NODE_ENV: 'test' }), /live is allowed only with NODE_ENV=production/);
  });

  it('refuses the fake server in production, and needs its URL otherwise', () => {
    const fake = sandbox({ PAYSTATION_ENV: 'fake', PAYSTATION_BASE_URL: 'http://127.0.0.1:18090' });
    expect(buildPaymentConfig(fake)).toMatchObject({ baseUrl: 'http://127.0.0.1:18090' });
    expect(
      buildPaymentConfig({ ...fake, PAYSTATION_MERCHANT_ID: '', PAYSTATION_PASSWORD: '' }),
    ).toMatchObject({ env: 'fake' });
    refused(
      { ...fake, PAYSTATION_BASE_URL: undefined },
      /BASE_URL is required with PAYSTATION_ENV=fake/,
    );
    refused(
      {
        ...fake,
        NODE_ENV: 'production',
        PAYSTATION_IPN_URL: 'https://x.org/api/payments/paystation/ipn',
      },
      /fake .* is refused with NODE_ENV=production/,
    );
  });

  it('never lets PAYSTATION_BASE_URL move sandbox or live to another host', () => {
    expect(
      buildPaymentConfig(sandbox({ PAYSTATION_BASE_URL: PAYSTATION_HOSTS.sandbox })),
    ).toMatchObject({ baseUrl: PAYSTATION_HOSTS.sandbox });
    expect(
      buildPaymentConfig(sandbox({ PAYSTATION_BASE_URL: `${PAYSTATION_HOSTS.sandbox}/` })),
    ).toMatchObject({ baseUrl: PAYSTATION_HOSTS.sandbox });
    for (const other of [
      PAYSTATION_HOSTS.live, // the dangerous one: sandbox label, live host
      'https://evil.example.net',
      PAYSTATION_HOSTS.sandbox.replace('https:', 'http:'),
      `${PAYSTATION_HOSTS.sandbox}/v2`,
      `${PAYSTATION_HOSTS.sandbox}?x=1`,
    ]) {
      refused(sandbox({ PAYSTATION_BASE_URL: other }), /must be blank or equal the sandbox host/);
    }
    refused(live({ PAYSTATION_BASE_URL: PAYSTATION_HOSTS.sandbox }), /equal the live host/);
  });

  it('refuses missing or placeholder credentials outside the fake server', () => {
    for (const [name, value] of [
      ['PAYSTATION_MERCHANT_ID', ''],
      ['PAYSTATION_MERCHANT_ID', 'fake'],
      ['PAYSTATION_MERCHANT_ID', '123 456'],
      ['PAYSTATION_PASSWORD', ''],
      ['PAYSTATION_PASSWORD', 'change-me'],
    ] as const) {
      refused(
        sandbox({ [name]: value }),
        new RegExp(`${name} is missing or looks like a placeholder`),
      );
    }
  });

  it('needs an account label and an invoice prefix; X and FX are reserved', () => {
    for (const label of [undefined, 'ab', 'Rasel', 'rasel sandbox', 'a'.repeat(33)])
      refused(sandbox({ PAYSTATION_ACCOUNT_LABEL: label }), /PAYSTATION_ACCOUNT_LABEL is required/);
    for (const prefix of [undefined, '', 't', 'ABCD', 'T-'])
      refused(
        sandbox({ PAYSTATION_INVOICE_PREFIX: prefix }),
        /PAYSTATION_INVOICE_PREFIX is required/,
      );
    for (const prefix of ['X', 'XA', 'FX', 'FX1'])
      refused(sandbox({ PAYSTATION_INVOICE_PREFIX: prefix }), /must not start with X or FX/);
    expect(buildPaymentConfig(sandbox({ PAYSTATION_INVOICE_PREFIX: 'S2' }))).toMatchObject({
      invoicePrefix: 'S2',
    });
  });

  it('checks the callback: our route, https except localhost outside production, room for an invoice', () => {
    refused(sandbox({ PAYSTATION_CALLBACK_URL: undefined }), /PAYSTATION_CALLBACK_URL is required/);
    for (const url of [
      'http://localhost:4100/api/payments/paystation/callback/',
      'http://localhost:4100/api/payments/callback',
      'http://localhost:4100/api/payments/paystation/callback?x=1',
    ])
      refused(
        sandbox({ PAYSTATION_CALLBACK_URL: url }),
        /must end with \/api\/payments\/paystation\/callback/,
      );
    refused(
      sandbox({
        PAYSTATION_CALLBACK_URL: 'http://tunnel.example.net/api/payments/paystation/callback',
      }),
      /http only for localhost/,
    );
    refused(
      live({ PAYSTATION_CALLBACK_URL: 'http://localhost/api/payments/paystation/callback' }),
      /must use https/,
    );
    const long = `https://${'a'.repeat(150)}.org/api/payments/paystation/callback`;
    refused(sandbox({ PAYSTATION_CALLBACK_URL: long }), /too long/);
  });

  it('checks the IPN: our route over https; required only in production', () => {
    expect(
      buildPaymentConfig(
        sandbox({
          PAYSTATION_IPN_URL: 'https://abc.trycloudflare.com/api/payments/paystation/ipn',
        }),
      ),
    ).toMatchObject({ ipnUrl: 'https://abc.trycloudflare.com/api/payments/paystation/ipn' });
    refused(
      sandbox({ PAYSTATION_IPN_URL: 'http://localhost:4100/api/payments/paystation/ipn' }),
      /PAYSTATION_IPN_URL must use https/,
    );
    refused(
      sandbox({ PAYSTATION_IPN_URL: 'https://abc.example.net/api/payments/ipn' }),
      /must end with \/api\/payments\/paystation\/ipn/,
    );
    refused(
      live({ PAYSTATION_IPN_URL: undefined }),
      /IPN_URL is required with NODE_ENV=production/,
    );
  });

  it('accepts only pay_with_charge 0 (the merchant bears the charge)', () => {
    for (const value of [undefined, '', '1', 'true', '00'])
      refused(
        sandbox({ PAYSTATION_PAY_WITH_CHARGE: value }),
        /PAYSTATION_PAY_WITH_CHARGE must be 0/,
      );
  });

  it('never puts a credential, or any part of one, into an error or the boot line', () => {
    const line = describePaymentConfig(buildPaymentConfig(sandbox()));
    expect(line).toContain('account=rasel-sandbox');
    expect(line).toContain(`host=${new URL(PAYSTATION_HOSTS.sandbox).host}`);
    for (const secret of [MERCHANT, PASSWORD, MERCHANT.slice(-4), PASSWORD.slice(-4)])
      expect(line).not.toContain(secret);
    try {
      buildPaymentConfig(sandbox({ PAYSTATION_BASE_URL: PAYSTATION_HOSTS.live }));
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(MERCHANT);
      expect(message).not.toContain(PASSWORD);
    }
    expect(describePaymentConfig({ enabled: false })).toMatch(/disabled/);
  });
});

describe('source scan: the PayStation hosts live only in payment.config.ts', () => {
  const repo = join(__dirname, '..', '..', '..', '..', '..');
  const needle = ['paystation', 'com', 'bd'].join('.'); // built here so this file never matches itself
  const SKIP = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo', '.git']);
  const SCANNED = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sh|conf)$|(^|[\\/])\.env\.example$/;
  const ROOTS = ['apps', 'packages', 'infra', 'scripts', '.github', '.env.example'];

  function* files(path: string): Generator<string> {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isFile()) {
      yield path;
      return;
    }
    for (const entry of readdirSync(path)) {
      if (!SKIP.has(entry)) yield* files(join(path, entry));
    }
  }

  it('finds the host nowhere else in apps, packages, infra, scripts, CI or the env examples', () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(join(repo, root))) {
        if (!SCANNED.test(file)) continue;
        if (readFileSync(file, 'utf8').toLowerCase().includes(needle))
          hits.push(relative(repo, file).split(sep).join('/'));
      }
    }
    expect(hits).toEqual(['apps/api/src/modules/payments/payment.config.ts']);
  });
});
