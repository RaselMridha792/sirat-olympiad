/**
 * Contract test: the real PayStation adapter against the fake PayStation (plan section 7). The same calls run by hand
 * against the sandbox with `paystation:selfcheck` (SANDBOX-CHECKLIST S11). No database is involved.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PayStationGateway } from '../src/modules/payments/gateway/paystation.gateway';
import { newInvoiceNumber } from '../src/modules/payments/invoice';
import type { PaymentConfig } from '../src/modules/payments/payment.config';
import { startFakePaystation, type FakePaystation } from './fake-paystation/fake-paystation';

const MERCHANT = '123-4567890123';
const PASSWORD = 'Sx9Lk2Qw7Zt4';
let fake: FakePaystation;
let ipnServer: Server;
const ipns: Record<string, unknown>[] = [];

const config = (over: Partial<Extract<PaymentConfig, { enabled: true }>> = {}) =>
  ({
    enabled: true,
    env: 'fake',
    baseUrl: fake.url,
    merchantId: MERCHANT,
    password: PASSWORD,
    accountLabel: 'fake-local',
    invoicePrefix: 'T',
    callbackUrl: 'http://localhost:4100/api/payments/paystation/callback',
    ipnUrl: null,
    payWithCharge: 0,
    timeoutMs: 1_000,
    ...over,
  }) as Extract<PaymentConfig, { enabled: true }>;
const gateway = (over = {}) => new PayStationGateway(config(over));
const checkout = (invoiceNumber = newInvoiceNumber('T'), amountMinor = 40000) => ({
  invoiceNumber,
  amountMinor,
  reference: `ref-${invoiceNumber}`,
  customer: { name: 'TEST Student', phone: '01900000001', email: 'test@test.invalid' },
});

beforeAll(async () => {
  ipnServer = createServer((req, res) => {
    let text = '';
    req.on('data', (c) => (text += c));
    req.on('end', () => {
      ipns.push(JSON.parse(text) as Record<string, unknown>);
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => ipnServer.listen(0, '127.0.0.1', resolve));
  const ipnUrl = `http://127.0.0.1:${(ipnServer.address() as AddressInfo).port}/api/payments/paystation/ipn`;
  fake = await startFakePaystation({ merchantId: MERCHANT, password: PASSWORD, ipnUrl });
});
afterAll(async () => {
  await fake.close();
  await new Promise<void>((resolve) => ipnServer.close(() => resolve()));
});
beforeEach(() => fake.reset());

describe('PayStation contract (adapter <-> fake)', () => {
  it('initiate creates a checkout; status says processing with no trx_id until it is paid', async () => {
    const req = checkout();
    const created = await gateway().initiate(req);
    expect(created).toMatchObject({ kind: 'created' });
    expect(created.kind === 'created' && created.paymentUrl).toContain(
      `/checkout/${req.invoiceNumber}`,
    );
    expect(fake.checkouts.get(req.invoiceNumber)?.form).toMatchObject({
      payment_amount: '400',
      pay_with_charge: '0',
      callback_url: `http://localhost:4100/api/payments/paystation/callback/${req.invoiceNumber}`,
    });
    expect(await gateway().statusByInvoice(req.invoiceNumber)).toMatchObject({
      kind: 'found',
      trxStatus: 'processing',
      trxId: null,
      paymentMinor: 40000,
      reference: req.reference,
    });
  });

  it('after payment: success, a trx_id, the exact amount, and an IPN with the official fields', async () => {
    const req = checkout();
    await gateway().initiate(req);
    expect(await fake.pay(req.invoiceNumber)).toBe(200);
    const status = await gateway().statusByInvoice(req.invoiceNumber);
    expect(status).toMatchObject({ kind: 'found', trxStatus: 'success', paymentMinor: 40000 });
    expect(status.kind === 'found' && status.trxId).toMatch(/^FKTRX/);
    expect(ipns.at(-1)).toEqual({
      invoice_number: req.invoiceNumber,
      trx_status: 'Success',
      trx_id: status.kind === 'found' ? status.trxId : '',
      trx_amount: 400,
      order_date_time: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      payment_method: 'bKash',
    });
  });

  it('casing and amount formats come through normalised', async () => {
    const req = checkout();
    await gateway().initiate(req);
    await fake.pay(req.invoiceNumber);
    for (const [successText, amountFormat] of [
      ['Successful', 'integer'],
      ['SUCCESS', 'number'],
      ['success', 'decimal'],
    ] as const) {
      Object.assign(fake.scenario, { successText, amountFormat });
      expect(await gateway().statusByInvoice(req.invoiceNumber)).toMatchObject({
        trxStatus: successText.toLowerCase(),
        paymentMinor: 40000,
      });
    }
  });

  it('a charge on top shows up as a different amount (the decision then refuses it)', async () => {
    const req = checkout();
    await gateway().initiate(req);
    await fake.pay(req.invoiceNumber);
    fake.scenario.amountDeltaMinor = 740;
    expect(await gateway().statusByInvoice(req.invoiceNumber)).toMatchObject({
      paymentMinor: 40740,
    });
  });

  it('failed and refund are reported as such', async () => {
    const a = checkout();
    const b = checkout();
    await gateway().initiate(a);
    await gateway().initiate(b);
    fake.fail(a.invoiceNumber);
    await fake.pay(b.invoiceNumber);
    fake.refund(b.invoiceNumber);
    expect(await gateway().statusByInvoice(a.invoiceNumber)).toMatchObject({ trxStatus: 'failed' });
    expect(await gateway().statusByInvoice(b.invoiceNumber)).toMatchObject({ trxStatus: 'refund' });
  });

  it('wrong credentials: initiate says credentials_rejected (1001), status says 2001', async () => {
    const req = checkout();
    expect(await gateway({ password: 'Wrong-password-1' }).initiate(req)).toMatchObject({
      kind: 'credentials_rejected',
      statusCode: '1001',
    });
    await gateway().initiate(req);
    expect(
      await gateway({ merchantId: '123-0000000000' }).statusByInvoice(req.invoiceNumber),
    ).toMatchObject({
      kind: 'not_found_or_auth',
    });
  });

  it('a reused invoice is refused (1008); an unknown one is 2001', async () => {
    const req = checkout();
    await gateway().initiate(req);
    expect(await gateway().initiate(req)).toMatchObject({ kind: 'refused', statusCode: '1008' });
    expect(await gateway().statusByInvoice(newInvoiceNumber('T'))).toMatchObject({
      kind: 'not_found_or_auth',
    });
  });

  it('slow and broken answers are "unavailable"', async () => {
    fake.scenario.delayMs = 1_500;
    expect(await gateway().statusByInvoice('T1')).toMatchObject({
      kind: 'unavailable',
      reason: 'timeout',
    });
    fake.reset();
    fake.scenario.nonJson = true;
    expect(await gateway().initiate(checkout())).toMatchObject({
      kind: 'unavailable',
      reason: 'bad_response',
    });
  });

  it('the checkout page shows the amount and Pay redirects to our callback with the invoice', async () => {
    const req = checkout(undefined, 40000);
    const created = await gateway().initiate(req);
    const pageUrl = created.kind === 'created' ? created.paymentUrl : '';
    expect(await (await fetch(pageUrl)).text()).toContain('BDT 400.00');
    const res = await fetch(`${pageUrl}/pay`, { method: 'POST', redirect: 'manual' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe(`/api/payments/paystation/callback/${req.invoiceNumber}`);
    expect(location.searchParams.get('status')).toBe('Successful');
  });
});
