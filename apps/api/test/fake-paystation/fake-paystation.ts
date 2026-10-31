/**
 * A fake PayStation for integration tests and local development (plan D5, section 7). DEV/TEST ONLY: it lives under
 * apps/api/test, which no Docker image contains (.dockerignore; CI checks the image contents), and
 * PAYSTATION_ENV=fake is refused with NODE_ENV=production.
 *
 * It speaks the shapes of the official docs and of what the sandbox answered (S11): initiate-payment (form;
 * "200" with payment_url, "1001" for wrong credentials, "1008" for a reused invoice) and v1 transaction-status
 * (merchantId header; "200" with data, "2001" when not found or the merchant id is wrong). A checkout page has
 * Pay / Fail / Cancel, which redirect to the callback with plugin-style query parameters and, on Pay, POST the IPN.
 * Scenarios (delays, odd casing and amounts, broken answers) are set in-process or with POST /__fake/scenario.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeScenario = {
  /** Answer initiate with this status_code instead of creating a checkout. */
  initiateCode?: string;
  /** Answer every status query with this status_code (e.g. "2001", "5000"). */
  statusCode?: string;
  /** Delay before every answer, in ms (timeouts). */
  delayMs?: number;
  /** Answer with an HTML page instead of JSON. */
  nonJson?: boolean;
  /** The trx_status text used for a paid checkout (casing varies: "Success", "Successful", "success"). */
  successText?: string;
  /** How payment_amount is written: "400.00" (default), "400", or the number 400. */
  amountFormat?: 'decimal' | 'integer' | 'number';
  /** Report this many paisa more (or less) than the checkout amount, as a charge would. */
  amountDeltaMinor?: number;
  /** Echo our reference in the status answer (S19 is open). Default true. */
  echoReference?: boolean;
};

export type FakeCheckout = {
  invoiceNumber: string;
  amountMinor: number;
  reference: string;
  callbackUrl: string;
  status: 'processing' | 'success' | 'failed' | 'refund';
  trxId: string;
  form: Record<string, string>;
};

export type FakePaystation = {
  url: string;
  checkouts: Map<string, FakeCheckout>;
  scenario: FakeScenario;
  /** Marks the checkout paid (as the payer would) and sends the IPN if an IPN URL is set; returns its HTTP status. */
  pay(invoiceNumber: string): Promise<number | null>;
  fail(invoiceNumber: string): void;
  refund(invoiceNumber: string): void;
  reset(): void;
  close(): Promise<void>;
};

export type FakeOptions = {
  port?: number;
  host?: string;
  /** When set, initiate and status check these; otherwise any credentials are accepted. */
  merchantId?: string;
  password?: string;
  ipnUrl?: string;
};

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => resolve(text));
  });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function amountText(minor: number, format: FakeScenario['amountFormat']): string | number {
  if (format === 'number') return minor / 100;
  if (format === 'integer') return String(Math.round(minor / 100));
  return (minor / 100).toFixed(2);
}

function dhakaDateTime(now: Date): string {
  const d = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}

export async function startFakePaystation(options: FakeOptions = {}): Promise<FakePaystation> {
  const checkouts = new Map<string, FakeCheckout>();
  const scenario: FakeScenario = {};
  let url = '';

  const sendIpn = async (c: FakeCheckout): Promise<number | null> => {
    if (!options.ipnUrl) return null;
    try {
      const res = await fetch(options.ipnUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoice_number: c.invoiceNumber,
          trx_status: scenario.successText ?? 'Success',
          trx_id: c.trxId,
          trx_amount: (c.amountMinor + (scenario.amountDeltaMinor ?? 0)) / 100,
          order_date_time: dhakaDateTime(new Date()),
          payment_method: 'bKash',
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.status;
    } catch {
      return 0;
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const text = await readBody(req);
    if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs));

    if (req.method === 'POST' && path === '/__fake/scenario') {
      Object.assign(scenario, JSON.parse(text || '{}') as FakeScenario);
      return json(res, { ok: true, scenario });
    }
    if (req.method === 'POST' && path === '/__fake/reset') {
      checkouts.clear();
      for (const key of Object.keys(scenario)) delete scenario[key as keyof FakeScenario];
      return json(res, { ok: true });
    }
    if (scenario.nonJson && !path.startsWith('/checkout')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body>Service temporarily unavailable</body></html>');
    }

    if (req.method === 'POST' && path === '/initiate-payment') {
      const form = Object.fromEntries(new URLSearchParams(text));
      if (scenario.initiateCode)
        return json(res, {
          status_code: scenario.initiateCode,
          status: 'failed',
          message: 'Scenario',
        });
      if (
        (options.merchantId && form.merchantId !== options.merchantId) ||
        (options.password && form.password !== options.password)
      )
        return json(res, { status_code: '1001', status: 'failed', message: 'Invalid Credential.' });
      const required = [
        'invoice_number',
        'payment_amount',
        'cust_name',
        'cust_phone',
        'cust_email',
        'callback_url',
      ];
      if (required.some((key) => !form[key]) || !/^\d+$/.test(form.payment_amount ?? ''))
        return json(res, { status_code: '1002', status: 'failed', message: 'Invalid request' });
      const invoiceNumber = form.invoice_number as string;
      if (checkouts.has(invoiceNumber))
        return json(res, {
          status_code: '1008',
          status: 'failed',
          message: 'Duplicate invoice number',
        });
      checkouts.set(invoiceNumber, {
        invoiceNumber,
        amountMinor: Number(form.payment_amount) * 100,
        reference: form.reference ?? '',
        callbackUrl: form.callback_url as string,
        status: 'processing',
        trxId: `FKTRX${randomBytes(6).toString('hex').toUpperCase()}`,
        form,
      });
      return json(res, {
        status_code: '200',
        status: 'success',
        message: 'Payment Link Created Successfully.',
        payment_url: `${url}/checkout/${encodeURIComponent(invoiceNumber)}`,
      });
    }

    if (req.method === 'POST' && path === '/transaction-status') {
      const invoiceNumber = new URLSearchParams(text).get('invoice_number') ?? '';
      const merchantId = req.headers.merchantid;
      const c = checkouts.get(invoiceNumber);
      if (scenario.statusCode)
        return json(res, {
          status_code: scenario.statusCode,
          status: 'failed',
          message: 'Scenario',
        });
      if (!c || (options.merchantId && merchantId !== options.merchantId))
        return json(res, {
          status_code: '2001',
          status: 'failed',
          message: 'Transaction not found in system',
        });
      const statusText = c.status === 'success' ? (scenario.successText ?? 'Success') : c.status;
      return json(res, {
        status_code: '200',
        status: 'success',
        message: 'Transaction found',
        data: {
          invoice_number: c.invoiceNumber,
          trx_status: statusText,
          trx_id: c.status === 'processing' ? '' : c.trxId,
          payment_amount: amountText(
            c.amountMinor + (scenario.amountDeltaMinor ?? 0),
            scenario.amountFormat,
          ),
          ...(scenario.echoReference === false ? {} : { reference: c.reference }),
          payment_method: c.status === 'processing' ? '' : 'bKash',
          order_date_time: dhakaDateTime(new Date()),
        },
      });
    }

    const checkout = /^\/checkout\/([^/]+)(?:\/(pay|fail|cancel))?$/.exec(path);
    if (checkout) {
      const c = checkouts.get(decodeURIComponent(checkout[1] ?? ''));
      if (!c) return json(res, { message: 'Unknown checkout' }, 404);
      const action = checkout[2];
      if (req.method === 'GET' && !action) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        const amount = (c.amountMinor / 100).toFixed(2);
        const button = (a: string, label: string) =>
          `<form method="post" action="/checkout/${encodeURIComponent(c.invoiceNumber)}/${a}"><button>${label}</button></form>`;
        return res.end(
          `<!doctype html><html><body><h1>FAKE PayStation</h1><p>Invoice ${escapeHtml(c.invoiceNumber)}</p>` +
            `<p id="amount">BDT ${amount}</p>${button('pay', 'Pay')}${button('fail', 'Fail')}${button('cancel', 'Cancel')}</body></html>`,
        );
      }
      if (req.method === 'POST' && action) {
        if (action === 'pay') {
          c.status = 'success';
          await sendIpn(c);
        } else if (action === 'fail') c.status = 'failed';
        const query = new URLSearchParams({
          status: action === 'pay' ? 'Successful' : action === 'fail' ? 'Failed' : 'Canceled',
          invoice_number: c.invoiceNumber,
          trx_id: action === 'pay' ? c.trxId : '',
        });
        res.writeHead(303, { location: `${c.callbackUrl}?${query.toString()}` });
        return res.end();
      }
    }
    return json(res, { message: 'Not found' }, 404);
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => json(res, { message: 'fake error' }, 500));
  });
  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve),
  );
  url = `http://${options.host ?? '127.0.0.1'}:${(server.address() as AddressInfo).port}`;

  const get = (invoiceNumber: string) => {
    const c = checkouts.get(invoiceNumber);
    if (!c) throw new Error(`fake PayStation: no checkout ${invoiceNumber}`);
    return c;
  };
  return {
    url,
    checkouts,
    scenario,
    pay: async (invoiceNumber) => {
      const c = get(invoiceNumber);
      c.status = 'success';
      return sendIpn(c);
    },
    fail: (invoiceNumber) => void (get(invoiceNumber).status = 'failed'),
    refund: (invoiceNumber) => void (get(invoiceNumber).status = 'refund'),
    reset: () => {
      checkouts.clear();
      for (const key of Object.keys(scenario)) delete scenario[key as keyof FakeScenario];
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // idle keep-alive sockets would otherwise hold the close open
      }),
  };
}
