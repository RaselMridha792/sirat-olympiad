// Registration surge (payments plan step 13, DoD #17). k6 only, no other dependency or remote import.
//
// One iteration is one student, as the browser would do it:
//   1. GET  /api/registrations/info: the register page (cached 30 s on the server).
//   2. POST /api/registrations/start: the argon2 hash and the PayStation initiate run inside this request.
//   3. PAY_SHARE of the students open the checkout and pay. Pay posts the IPN to the API; the browser then comes
//      back through the callback, twice (a refresh, S14).
//   4. The result page polls GET /api/registrations/current on its own schedule (web poll.ts: 2 s, then 5 s,
//      then 10 s, stop at 2 min) until "completed": the worker verified the payment and created the account.
//   The others leave the checkout open; reconciliation settles them later.
//
// The FAKE PayStation only (never load-test PayStation). setup() makes one start before any load; its checkout
// must be the fake's page, or the test stops there. The load phase begins only after that, and a checkout on any
// other host stops it too.
//
// Needs: an API with PAYSTATION_ENV=fake, the fake PayStation (apps/api/test/fake-paystation/run.ts) with
// FAKE_PAYSTATION_IPN_URL pointing at that API, its worker, and registration open. Never production. RUNBOOK §0.
//
//   k6 run -e BASE_URL=http://127.0.0.1:4100 loadtests/registration-surge.js
//
// Options (-e): RATE starts per second at the peak (default 4), RAMP (default 1m), HOLD (default 5m), PAY_SHARE
// (default 0.8), PAY_DELAY seconds on the checkout before paying (default 3, plus up to 2 s jitter).
// SPREAD_IPS=1 (default) sends X-Forwarded-For with one address per student. The API trusts one proxy hop, so this
// stands in for many students behind nginx when k6 talks to the API directly. Through nginx it has no effect: nginx
// appends the generator's own address, and the per-IP limits (start: 300/min) then apply to the generator.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const RATE = Number(__ENV.RATE || 4);
const PAY_SHARE = Number(__ENV.PAY_SHARE ?? 0.8);
const PAY_DELAY = Number(__ENV.PAY_DELAY ?? 3);
const SPREAD_IPS = (__ENV.SPREAD_IPS ?? '1') === '1';

export const options = {
  scenarios: {
    surge: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(20, RATE * 20),
      maxVUs: Math.max(100, RATE * 150),
      stages: [
        { target: RATE, duration: __ENV.RAMP || '1m' },
        { target: RATE, duration: __ENV.HOLD || '5m' },
        { target: 0, duration: '10s' },
      ],
      gracefulStop: '2m30s', // a student who paid near the end still polls up to 2 minutes
    },
  },
  thresholds: {
    // DoD #17 (RULEBOOK §13): p95 < 500 ms and errors < 0.5 % on our API. The fake gateway is not ours.
    'http_req_duration{kind:api}': ['p(95)<500'],
    'http_req_failed{kind:api}': ['rate<0.005'],
    // Per endpoint, so the summary shows each one.
    'http_req_duration{name:start}': ['p(95)<500'],
    'http_req_duration{name:info}': ['p(95)<500'],
    'http_req_duration{name:callback}': ['p(95)<500'],
    'http_req_duration{name:current}': ['p(95)<500'],
    checks: ['rate>0.995'],
    // Every paid student sees "completed" while the result page still polls (no growing queue).
    registration_completed: ['rate>0.995'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const settleTime = new Trend('registration_settle_ms', true);
const completed = new Rate('registration_completed');
const started = new Counter('registrations_started');
const throttled = new Counter('responses_429');
/** Starts answered 503 SERVICE_BUSY (a busy database), and those still busy after the wizard's one retry. */
const busyRetried = new Counter('start_busy_retried');
const busyAgain = new Counter('start_busy_after_retry');

/** As the wizard (components/registration/start-retry.ts): Retry-After capped at 5 s, plus up to 1 s of jitter. */
const busyAnswer = (r) => r.status === 503 && r.json('code') === 'SERVICE_BUSY';
const busyWait = (r) => Math.min(Number(r.headers['Retry-After']) || 2, 5) + Math.random();

const api = (name) => ({ tags: { name, kind: 'api' } });

function uuid() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    const v =
      i === 12 ? 4 : i === 16 ? 8 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 16);
    out += hex[v];
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

function ipFor(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

const originOf = (url) => (/^https?:\/\/[^/]+/i.exec(String(url)) ?? [''])[0].toLowerCase();

/** The student opens the checkout; true when it is the fake PayStation's page (it says so). */
function openCheckout(paymentUrl, headers) {
  const page = http.get(paymentUrl, { headers, tags: { name: 'fake_checkout', kind: 'fake' } });
  return page.status === 200 && String(page.body).includes('FAKE PayStation');
}

export function setup() {
  const info = http.get(`${BASE}/api/registrations/info`, api('info'));
  if (info.status !== 200) exec.test.abort(`GET /api/registrations/info answered ${info.status}`);
  const body = info.json();
  if (!body.open || !body.fee)
    exec.test.abort('registration is not open (or PayStation is not configured)');
  if (!body.gradeLevels.length) exec.test.abort('no grade levels (run the config seed)');
  // Distinct per run, so a rerun on the same database gets new emails and phones.
  const runId = String(Date.now() % 1_000_000).padStart(6, '0');
  const data = {
    runId,
    fee: body.fee.amountMinor,
    districts: body.districts,
    educationTypes: body.educationTypes,
    gradeLevelIds: body.gradeLevels.map((g) => g.id),
  };

  // The gateway guard, before any load: one start, whose checkout must be the fake's page. A misconfigured API
  // (sandbox or live) gets this one initiate and nothing more; the load phase never begins.
  const probe = http.post(
    `${BASE}/api/registrations/start`,
    JSON.stringify({
      ...student(data, 0),
      name: 'Load Test setup',
      phone: `018${runId.padStart(8, '0')}`,
      email: `load-${runId}-setup@load.invalid`,
    }),
    { headers: { 'content-type': 'application/json', 'x-requested-with': 'k6' }, ...api('setup') },
  );
  if (probe.status !== 201) exec.test.abort(`the setup start answered ${probe.status}`);
  const paymentUrl = probe.json('paymentUrl');
  if (!openCheckout(paymentUrl, {}))
    exec.test.abort(
      `the checkout at ${originOf(paymentUrl)} is not the fake PayStation; no load was sent`,
    );
  return { ...data, fakeOrigin: originOf(paymentUrl) };
}

function student(data, n) {
  return {
    startRequestId: uuid(),
    name: `Load Test ${n}`,
    phone: `019${String((Number(data.runId) * 1000 + n) % 100_000_000).padStart(8, '0')}`,
    email: `load-${data.runId}-${n}@load.invalid`,
    password: `Load-${data.runId}-${n}-kq7W`,
    district: data.districts[n % data.districts.length],
    institution: 'Load Test School',
    educationType: data.educationTypes[n % data.educationTypes.length],
    gradeLevelId: data.gradeLevelIds[n % data.gradeLevelIds.length],
  };
}

/** The result page's schedule (apps/web/src/components/registration/poll.ts). */
function nextPollDelay(elapsedMs) {
  if (elapsedMs >= 120_000) return null;
  if (elapsedMs < 20_000) return 2;
  if (elapsedMs < 60_000) return 5;
  return 10;
}

export default function (data) {
  const n = exec.scenario.iterationInTest;
  const headers = SPREAD_IPS ? { 'x-forwarded-for': ipFor(n) } : {};
  const write = { ...headers, 'content-type': 'application/json', 'x-requested-with': 'k6' };

  http.get(`${BASE}/api/registrations/info`, { headers, ...api('info') });

  const body = JSON.stringify(student(data, n));
  const send = () =>
    http.post(`${BASE}/api/registrations/start`, body, { headers: write, ...api('start') });
  let res = send();
  if (busyAnswer(res)) {
    // The wizard's one automatic retry: the same body, so the same startRequestId.
    busyRetried.add(1);
    sleep(busyWait(res));
    res = send();
    if (busyAnswer(res)) busyAgain.add(1);
  }
  if (res.status === 429) throttled.add(1, { name: 'start' });
  const ok = check(res, {
    'start 201': (r) => r.status === 201,
    'start has a checkout and the fee': (r) => {
      const b = r.status === 201 ? r.json() : null;
      return !!b && !!b.paymentUrl && !!b.invoiceNumber && b.amountMinor === data.fee;
    },
  });
  if (!ok) return;
  started.add(1);
  const { paymentUrl } = res.json();
  // The API cannot switch gateways mid-run; a checkout on another host than setup's fake stops the test anyway.
  if (originOf(paymentUrl) !== data.fakeOrigin)
    exec.test.abort(`a checkout at ${originOf(paymentUrl)}, not the fake at ${data.fakeOrigin}`);

  const fake = openCheckout(paymentUrl, headers);
  check(fake, { 'the checkout is the fake': (f) => f });
  // Leaves at the checkout: the page is opened, nothing is paid.
  if (!fake || Math.random() >= PAY_SHARE) return;

  sleep(PAY_DELAY + Math.random() * 2);
  const paid = http.post(`${paymentUrl}/pay`, null, {
    redirects: 0,
    tags: { name: 'fake_pay', kind: 'fake' },
  });
  const paidAt = Date.now();
  const back = paid.headers.Location;
  if (!check(paid, { 'fake pay redirects to the callback': (r) => r.status === 303 && !!back }))
    return;

  for (let i = 0; i < 2; i += 1) {
    const cb = http.get(back, { headers, redirects: 0, ...api('callback') });
    if (cb.status === 429) throttled.add(1, { name: 'callback' });
    check(cb, { 'callback 303': (r) => r.status === 303 });
  }

  const pollStart = Date.now();
  for (;;) {
    const cur = http.get(`${BASE}/api/registrations/current`, { headers, ...api('current') });
    if (cur.status === 429) throttled.add(1, { name: 'current' });
    check(cur, { 'current 200': (r) => r.status === 200 });
    if (cur.status === 200 && cur.json('state') === 'completed') {
      settleTime.add(Date.now() - paidAt);
      completed.add(true);
      return;
    }
    const wait = nextPollDelay(Date.now() - pollStart);
    if (wait === null) {
      completed.add(false);
      return;
    }
    sleep(wait);
  }
}
