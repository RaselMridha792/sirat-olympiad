import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import type { PaymentConfig } from '../payment.config';
import { PayStationGateway } from './paystation.gateway';
import { redactGatewayBody } from './redact';

// Shaped like real values, obviously not real ones.
const MERCHANT = '123-4567890123';
const PASSWORD = 'Sx9Lk2Qw7Zt4';

type Seen = { path: string; headers: IncomingMessage['headers']; form: URLSearchParams };
type Reply = { status?: number; body: unknown; delayMs?: number; raw?: string };

let server: Server;
let base: string;
let seen: Seen[] = [];
let reply: (path: string) => Reply = () => ({ body: {} });

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, form: new URLSearchParams(text) });
      const r = reply(req.url ?? '');
      setTimeout(() => {
        res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
        res.end(r.raw ?? JSON.stringify(r.body));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let logs: unknown[];
beforeEach(() => {
  seen = [];
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const)
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => void logs.push(args));
});
afterEach(() => jest.restoreAllMocks());

const config = (over: Partial<Extract<PaymentConfig, { enabled: true }>> = {}) =>
  ({
    enabled: true,
    env: 'fake',
    baseUrl: base,
    merchantId: MERCHANT,
    password: PASSWORD,
    accountLabel: 'test-account',
    invoicePrefix: 'T',
    callbackUrl: 'http://localhost:4100/api/payments/paystation/callback',
    ipnUrl: null,
    payWithCharge: 0,
    timeoutMs: 1_000,
    ...over,
  }) as Extract<PaymentConfig, { enabled: true }>;

const request = {
  invoiceNumber: 'T261104ABCDEFGHJK',
  amountMinor: 40000,
  reference: '0190f0d0-0000-7000-8000-000000000001',
  customer: { name: 'Ayesha Rahman', phone: '01712345678', email: 'ayesha@test.invalid' },
};

describe('PayStationGateway.initiate', () => {
  it('posts the documented form: credentials only here, whole taka, pay_with_charge 0, invoice in the callback path', async () => {
    reply = () => ({
      body: {
        status_code: '200',
        status: 'success',
        message: 'Payment Link Created Successfully.',
        payment_url: 'https://pay.test/checkout/abc',
      },
    });
    const result = await new PayStationGateway(config()).initiate(request);
    expect(result).toMatchObject({ kind: 'created', paymentUrl: 'https://pay.test/checkout/abc' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/initiate-payment');
    expect(seen[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(seen[0]?.form ?? [])).toEqual({
      merchantId: MERCHANT, // exactly as issued, "-" kept (S11)
      password: PASSWORD,
      invoice_number: request.invoiceNumber,
      currency: 'BDT',
      payment_amount: '400',
      pay_with_charge: '0',
      reference: request.reference,
      cust_name: 'Ayesha Rahman',
      cust_phone: '01712345678',
      cust_email: 'ayesha@test.invalid',
      callback_url: `http://localhost:4100/api/payments/paystation/callback/${request.invoiceNumber}`,
    });
  });

  it('maps "1001" to credentials_rejected (a configuration error), "1008" and others to refused', async () => {
    reply = () => ({
      body: { status_code: '1001', status: 'failed', message: 'Invalid Credential.' },
    });
    expect(await new PayStationGateway(config()).initiate(request)).toMatchObject({
      kind: 'credentials_rejected',
      statusCode: '1001',
    });
    for (const code of ['1008', '1002', 1008]) {
      reply = () => ({ body: { status_code: code, status: 'failed', message: 'x' } });
      expect(await new PayStationGateway(config()).initiate(request)).toMatchObject({
        kind: 'refused',
        statusCode: String(code),
      });
    }
  });

  it('a 200 without a usable payment_url is a bad response, never a created checkout', async () => {
    for (const payment_url of [undefined, '', 'javascript:alert(1)', 42]) {
      reply = () => ({ body: { status_code: '200', payment_url } });
      expect(await new PayStationGateway(config()).initiate(request)).toMatchObject({
        kind: 'unavailable',
        reason: 'bad_response',
      });
    }
  });

  it('sandbox and live take an https checkout only; the dev/CI fake may also answer http', async () => {
    const created = async (env: 'sandbox' | 'live' | 'fake', payment_url: string) => {
      reply = () => ({ body: { status_code: '200', payment_url } });
      return (await new PayStationGateway(config({ env })).initiate(request)).kind;
    };
    for (const env of ['sandbox', 'live'] as const) {
      expect(await created(env, 'https://sandbox.paystation.com.bd/checkout/abc')).toBe('created');
      // The browser would refuse it (web checkout.ts): start fails now instead of leaving a dead pending payment.
      expect(await created(env, 'http://sandbox.paystation.com.bd/checkout/abc')).toBe(
        'unavailable',
      );
      expect(await created(env, 'ftp://sandbox.paystation.com.bd/checkout/abc')).toBe(
        'unavailable',
      );
    }
    expect(await created('fake', 'http://127.0.0.1:18090/checkout/abc')).toBe('created');
    expect(await created('fake', 'https://fake.test/checkout/abc')).toBe('created');
    expect(await created('fake', 'ftp://127.0.0.1:18090/checkout/abc')).toBe('unavailable');
    expect(logs.flat()).toContainEqual(
      expect.objectContaining({ msg: 'paystation answered 200 without a usable payment_url' }),
    );
  });

  it('refuses to send an amount that is not whole taka', async () => {
    await expect(
      new PayStationGateway(config()).initiate({ ...request, amountMinor: 40050 }),
    ).rejects.toThrow(/whole-taka/);
    expect(seen).toHaveLength(0);
  });
});

describe('PayStationGateway.statusByInvoice (v1)', () => {
  it('sends only the merchantId header and the invoice; never the password', async () => {
    reply = () => ({
      body: { status_code: '2001', status: 'failed', message: 'Transaction not found in system' },
    });
    expect(
      await new PayStationGateway(config()).statusByInvoice('T261104ABCDEFGHJK'),
    ).toMatchObject({
      kind: 'not_found_or_auth',
      statusCode: '2001',
    });
    expect(seen[0]?.path).toBe('/transaction-status');
    expect(seen[0]?.headers.merchantid).toBe(MERCHANT);
    expect(Object.fromEntries(seen[0]?.form ?? [])).toEqual({
      invoice_number: 'T261104ABCDEFGHJK',
    });
    expect(JSON.stringify(seen[0]?.headers)).not.toContain(PASSWORD);
  });

  it.each([
    ['Success', '400.00', 'success', 40000],
    ['Successful', '400', 'successful', 40000],
    [' PROCESSING ', '10.00', 'processing', 1000],
    ['refund', 400, 'refund', 40000],
  ])('reads trx_status %p and payment_amount %p', async (trx, amount, trxStatus, paymentMinor) => {
    reply = () => ({
      body: {
        status_code: '200',
        status: 'success',
        message: 'Transaction found',
        data: {
          invoice_number: 'T1',
          trx_status: trx,
          trx_id: 'TRX1',
          payment_amount: amount,
          reference: 'ref-1',
          payment_method: 'bKash',
        },
      },
    });
    expect(await new PayStationGateway(config()).statusByInvoice('T1')).toMatchObject({
      kind: 'found',
      invoiceNumber: 'T1',
      trxStatus,
      trxId: 'TRX1',
      paymentMinor,
      reference: 'ref-1',
      paymentMethod: 'bKash',
    });
  });

  it('an empty trx_id becomes null; an unreadable amount becomes null', async () => {
    reply = () => ({
      body: {
        status_code: 200,
        data: {
          invoice_number: 'T1',
          trx_status: 'processing',
          trx_id: '',
          payment_amount: '4,00',
        },
      },
    });
    expect(await new PayStationGateway(config()).statusByInvoice('T1')).toMatchObject({
      kind: 'found',
      trxId: null,
      paymentMinor: null,
    });
  });

  it('other codes, and a 200 without data, change nothing', async () => {
    reply = () => ({ body: { status_code: '5000' } });
    expect(await new PayStationGateway(config()).statusByInvoice('T1')).toMatchObject({
      kind: 'other',
      statusCode: '5000',
    });
    reply = () => ({ body: { status_code: '200' } });
    expect(await new PayStationGateway(config()).statusByInvoice('T1')).toMatchObject({
      kind: 'unavailable',
      reason: 'bad_response',
    });
  });
});

describe('PayStationGateway: transport failures are "unavailable", never a decision', () => {
  it.each([
    ['a timeout', { body: {}, delayMs: 1_500 }, 'timeout'],
    ['an HTTP 502', { status: 502, body: { error: 'bad gateway' } }, 'http'],
    ['an HTML page', { raw: '<html>maintenance</html>', body: null }, 'bad_response'],
    ['a JSON array', { raw: '[]', body: null }, 'bad_response'],
  ])('%s', async (_label, r, reason) => {
    reply = () => r as Reply;
    expect(await new PayStationGateway(config()).statusByInvoice('T1')).toMatchObject({
      kind: 'unavailable',
      reason,
    });
    expect(await new PayStationGateway(config()).initiate(request)).toMatchObject({
      kind: 'unavailable',
      reason,
    });
  });

  it('a closed port is a network failure', async () => {
    const gateway = new PayStationGateway(config({ baseUrl: 'http://127.0.0.1:9' }));
    expect(await gateway.statusByInvoice('T1')).toMatchObject({
      kind: 'unavailable',
      reason: 'network',
    });
  });

  it('never logs a credential, a customer field or a body', async () => {
    reply = () => ({ status: 500, body: { echo: PASSWORD, cust_phone: '01712345678' } });
    await new PayStationGateway(config()).initiate(request);
    reply = () => ({ body: { status_code: '1001', message: `bad ${MERCHANT}` } });
    await new PayStationGateway(config()).initiate(request);
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [MERCHANT, PASSWORD, '01712345678', 'ayesha', 'Ayesha', 'echo'])
      expect(text).not.toContain(secret);
  });
});

describe('redactGatewayBody (stored in payment_events)', () => {
  it('drops credentials and tokens, masks phones to the last 3 digits, keeps the rest', () => {
    expect(
      redactGatewayBody({
        status_code: '200',
        merchantId: MERCHANT,
        password: PASSWORD,
        access_token: 'abc',
        data: {
          cust_phone: '01712345678',
          payer_mobile: 8801712345678,
          trx_id: 'TRX1',
          payment_amount: '400.00',
        },
      }),
    ).toEqual({
      status_code: '200',
      data: {
        cust_phone: '***678',
        payer_mobile: '***678',
        trx_id: 'TRX1',
        payment_amount: '400.00',
      },
    });
  });

  it('caps the size (payment_events_payload_size_check) and keeps strings short', () => {
    expect(
      redactGatewayBody({ a: 'x'.repeat(10_000), b: 'y'.repeat(10_000), c: 'z'.repeat(10_000) }),
    ).toMatchObject({
      a: expect.stringMatching(/^x{2000}…$/),
    });
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(1_000)]),
    );
    expect(redactGatewayBody(big)).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(redactGatewayBody('<html>' + 'x'.repeat(1_000))).toHaveLength(500);
    expect(redactGatewayBody(undefined)).toBeNull();
  });
});
