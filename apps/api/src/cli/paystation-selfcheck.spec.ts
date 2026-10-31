import type {
  InitiateRequest,
  InitiateResult,
  PaymentGateway,
} from '../modules/payments/gateway/payment-gateway';
import { runSelfcheck } from './paystation-selfcheck';

const MERCHANT = '123-4567890123';
const PASSWORD = 'Sx9Lk2Qw7Zt4';
const env = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  PAYSTATION_ENV: 'sandbox',
  PAYSTATION_MERCHANT_ID: MERCHANT,
  PAYSTATION_PASSWORD: PASSWORD,
  PAYSTATION_ACCOUNT_LABEL: 'rasel-sandbox',
  PAYSTATION_INVOICE_PREFIX: 'T',
  PAYSTATION_CALLBACK_URL: 'http://localhost:4100/api/payments/paystation/callback',
  PAYSTATION_IPN_URL: '',
  PAYSTATION_PAY_WITH_CHARGE: '0',
  ...over,
});

function run(result: InitiateResult, over: NodeJS.ProcessEnv = {}) {
  const lines: string[] = [];
  const sent: InitiateRequest[] = [];
  const gateway: PaymentGateway = {
    initiate: (req) => {
      sent.push(req);
      return Promise.resolve(result);
    },
    statusByInvoice: () => Promise.reject(new Error('not used')),
  };
  return runSelfcheck(
    env(over),
    () => gateway,
    (l) => lines.push(l),
    new Date('2026-11-04T10:00:00Z'),
  ).then((code) => ({ code, lines, sent }));
}

describe('paystation:selfcheck', () => {
  it('starts one 10 BDT checkout with an X invoice and exits 0 when the link is created', async () => {
    const { code, lines, sent } = await run({
      kind: 'created',
      paymentUrl: 'https://pay.test/checkout/abc',
      raw: null,
    });
    expect(code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ amountMinor: 1000, reference: 'paystation-selfcheck' });
    expect(sent[0]?.invoiceNumber).toMatch(/^X261104[0-9A-Z]{10}$/);
    expect(lines.join('\n')).toMatch(/env=sandbox host=sandbox\.\S+ account=rasel-sandbox/);
    expect(lines.join('\n')).toMatch(/initiate: created \(payment link host=pay\.test\)/);
  });

  it.each([
    [
      { kind: 'credentials_rejected', statusCode: '1001', raw: null },
      /credentials rejected \(status_code 1001\)/,
    ],
    [{ kind: 'refused', statusCode: '1008', raw: null }, /refused \(status_code 1008\)/],
    [{ kind: 'unavailable', reason: 'timeout', raw: null }, /unavailable \(timeout\)/],
  ] as [InitiateResult, RegExp][])('exits 1 and names the problem: %p', async (result, message) => {
    const { code, lines } = await run(result);
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(message);
  });

  it('exits 2 without calling PayStation when payments are disabled or the settings are wrong', async () => {
    let r = await run(
      { kind: 'created', paymentUrl: 'https://x', raw: null },
      { PAYSTATION_ENV: '' },
    );
    expect(r.code).toBe(2);
    expect(r.sent).toHaveLength(0);
    r = await run(
      { kind: 'created', paymentUrl: 'https://x', raw: null },
      { PAYSTATION_PAY_WITH_CHARGE: '1' },
    );
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/settings: PAYSTATION_PAY_WITH_CHARGE must be 0/);
    expect(r.sent).toHaveLength(0);
  });

  it('never prints a credential or any part of one', async () => {
    for (const result of [
      { kind: 'created', paymentUrl: 'https://pay.test/checkout/abc', raw: null },
      { kind: 'credentials_rejected', statusCode: '1001', raw: null },
    ] as InitiateResult[]) {
      const text = (await run(result)).lines.join('\n');
      for (const secret of [MERCHANT, PASSWORD, MERCHANT.slice(-4), PASSWORD.slice(-4)])
        expect(text).not.toContain(secret);
    }
  });
});
